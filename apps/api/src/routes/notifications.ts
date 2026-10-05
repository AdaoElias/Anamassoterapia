import {
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationResendParamsSchema,
  notificationResendResponseSchema,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client.js';
import { enfileirar } from '../lib/notificacoes/fila.js';
import { prisma } from '../lib/prisma.js';

/**
 * Painel de notificacoes: lista o que a clinica avisou e permite reenviar.
 *
 * A leitura responde a pergunta que o celular nao responde: "o cliente
 * recebeu?" A `Notification` carrega `attempts`, `lastError`, `externalId` e
 * `sentAt` justamente para isso -- o painel mostra o texto que foi enviado e o
 * motivo da falha, sem depender do log do worker.
 *
 * O reenvio reusa a mesma linha e zera as tentativas. Isso e deliberado: a
 * linha e a auditoria do que foi pedido, e um aviso reenviado continua sendo o
 * mesmo aviso. Reescrever o texto na mao quebraria essa leitura.
 */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const incluirRelacoes = {
  client: { select: { name: true } },
} as const;

type Linha = Prisma.NotificationGetPayload<{ include: typeof incluirRelacoes }>;

function resposta(linha: Linha) {
  return {
    id: linha.id,
    clientId: linha.clientId,
    clientName: linha.client?.name ?? null,
    appointmentId: linha.appointmentId,
    channel: linha.channel,
    type: linha.type,
    recipient: linha.recipient,
    subject: linha.subject,
    body: linha.body,
    status: linha.status,
    attempts: linha.attempts,
    lastError: linha.lastError,
    scheduledFor: linha.scheduledFor.toISOString(),
    sentAt: linha.sentAt === null ? null : linha.sentAt.toISOString(),
    createdAt: linha.createdAt.toISOString(),
  };
}

export const notificationRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Lista as notificacoes da clinica',
        querystring: notificationListQuerySchema,
        response: {
          200: notificationListResponseSchema,
          401: erroSchema,
          403: erroSchema,
        },
      },
      // A lista traz telefone, e-mail e o texto da mensagem: e dado de contato
      // e operacional, entao fica com o ADMIN, como as demais telas de gestao.
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const { status, channel, type, search, limit, offset } = request.query;

      const where: Prisma.NotificationWhereInput = {
        clinicId: sessao.clinicId,
        ...(status === undefined ? {} : { status }),
        ...(channel === undefined ? {} : { channel }),
        ...(type === undefined ? {} : { type }),
        ...(search === undefined
          ? {}
          : {
              OR: [
                { recipient: { contains: search, mode: 'insensitive' } },
                { client: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }),
      };

      // O resumo e da clinica inteira, nao do filtro: e a contagem que diz
      // "quantos avisos falharam" que faz o painel receber atencao, e ela nao
      // pode sumir porque o filtro esta em "com erro".
      const [items, total, porStatus] = await Promise.all([
        prisma.notification.findMany({
          where,
          include: incluirRelacoes,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.notification.count({ where }),
        prisma.notification.groupBy({
          by: ['status'],
          where: { clinicId: sessao.clinicId },
          _count: { _all: true },
        }),
      ]);

      const contagem = (situacao: string): number =>
        porStatus.find((linha) => linha.status === situacao)?._count._all ?? 0;

      return reply.code(200).send({
        items: items.map(resposta),
        total,
        resumo: {
          total: porStatus.reduce((soma, linha) => soma + linha._count._all, 0),
          pendente: contagem('PENDENTE'),
          enviando: contagem('ENVIANDO'),
          enviado: contagem('ENVIADO'),
          erro: contagem('ERRO'),
          cancelado: contagem('CANCELADO'),
        },
      });
    },
  );

  app.post(
    '/:id/reenviar',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Coloca a notificacao na fila de novo',
        description:
          'Zera as tentativas e reagenda para agora. O texto enviado e o mesmo: ' +
          'a linha registra o aviso que a clinica pediu, e nao uma redacao nova.',
        params: notificationResendParamsSchema,
        response: {
          200: notificationResendResponseSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const atual = await prisma.notification.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        include: incluirRelacoes,
      });

      if (!atual) {
        return reply
          .code(404)
          .send({ error: 'NOTIFICATION_NOT_FOUND', message: 'Notificacao nao encontrada.' });
      }

      // Cancelado e resposta definitiva do dominio: o lembrete foi substituido
      // por outro aviso. Reenviar seria mandar um aviso que ninguem pediu.
      if (atual.status === 'CANCELADO') {
        return reply.code(409).send({
          error: 'NOTIFICATION_CANCELLED',
          message: 'Este aviso foi cancelado e nao pode ser reenviado.',
        });
      }

      const agora = new Date();

      // `updateMany` filtrando o status e a mesma trava do worker: se ele
      // pegou a linha entre a leitura e a escrita, o count volta zero e o
      // painel diz "em envio" em vez de mandar duas mensagens ao cliente.
      const tomada = await prisma.notification.updateMany({
        where: {
          id: atual.id,
          clinicId: sessao.clinicId,
          status: { in: ['PENDENTE', 'ERRO', 'ENVIADO'] },
        },
        data: {
          status: 'PENDENTE',
          attempts: 0,
          lastError: null,
          sentAt: null,
          externalId: null,
          // "Reenviar" e "agora": sem isso a linha voltaria a ser adiada para a
          // data original e o botao pareceria nao fazer nada.
          scheduledFor: agora,
        },
      });

      if (tomada.count === 0) {
        return reply.code(409).send({
          error: 'NOTIFICATION_IN_FLIGHT',
          message: 'Este aviso esta sendo enviado agora. Tente de novo em instantes.',
        });
      }

      enfileirar(atual.id, agora);

      const atualizada = await prisma.notification.findUniqueOrThrow({
        where: { id: atual.id },
        include: incluirRelacoes,
      });

      return reply.code(200).send({ notification: resposta(atualizada) });
    },
  );

  done();
};
