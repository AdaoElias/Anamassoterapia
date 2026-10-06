import {
  buildPageMeta,
  commissionListQuerySchema,
  commissionListResponseSchema,
  commissionSchema,
  financialEntryCancelSchema,
  financialEntryCreateSchema,
  financialEntryListQuerySchema,
  financialEntryListResponseSchema,
  financialEntryPaymentInputSchema,
  financialEntrySchema,
  idSchema,
  packageCreateSchema,
  packageDetailSchema,
  packageListQuerySchema,
  packageListResponseSchema,
  packageSchema,
  packageStatusUpdateSchema,
  paginate,
  resumoFinanceiroSchema,
  resumoQuerySchema,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client.js';
import { ehConflitoUnico, mensagemConflito } from '../lib/cadastros.js';
import {
  dataColuna,
  diaSeguinte,
  hojeCivil,
  respostaComissao,
  respostaLancamento,
  respostaPacote,
} from '../lib/financeiro.js';
import { prisma } from '../lib/prisma.js';

/**
 * Financeiro da clinica: lancamentos (recebido x a receber), pacotes de
 * sessoes, comissoes e o resumo do periodo.
 *
 * Leitura pede `requireAuth` (a equipe toda ve o caixa e o saldo de
 * sessoes); escrita pede ADMIN. Toda query filtra por `clinicId` da sessao
 * e devolve 404 para id de outra clinica -- o mesmo contrato dos cadastros.
 *
 * Recursos vivos seguem o dominio:
 * - Lancamento a receber (PENDENTE/INADIMPENTE) vira PAGO em `/pagar` e
 *   deixa de existir para o resumo em `/cancelar`. Nenhuma rota edita
 *   `amountCents` depois de criado: dinheiro registrado nao some do relatorio.
 * - Pacote ativo tem as sessoes consumidas uma a uma; CONCLUIDO so quando o
 *   saldo zerar.
 * - Comissao caminha PREVISTA -> APROVADA -> PAGA.
 */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const naoAutenticado = { error: 'UNAUTHENTICATED', message: 'Faca login.' };

const paramsSchema = z.object({ id: idSchema });
const sessaoParamsSchema = z.object({ id: idSchema, sessionId: idSchema });

export const financeiroRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  // --- Lancamentos ---------------------------------------------------

  app.get(
    '/lancamentos',
    {
      schema: {
        tags: ['finance'],
        summary: 'Lista os lancamentos financeiros',
        querystring: financialEntryListQuerySchema,
        response: { 200: financialEntryListResponseSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const { page, perPage, kind, status, method, clientId, de, ate } = request.query;

      const where = {
        clinicId: sessao.clinicId,
        ...(kind === undefined ? {} : { kind }),
        ...(status === undefined ? {} : { status }),
        ...(method === undefined ? {} : { method }),
        ...(clientId === undefined ? {} : { clientId }),
        ...(de === undefined && ate === undefined
          ? {}
          : {
              dueDate: {
                ...(de === undefined ? {} : { gte: dataColuna(de) }),
                ...(ate === undefined ? {} : { lt: diaSeguinte(ate) }),
              },
            }),
      };

      const [items, total] = await Promise.all([
        prisma.financialEntry.findMany({
          where,
          include: { client: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          ...paginate({ page, perPage }),
        }),
        prisma.financialEntry.count({ where }),
      ]);

      return reply.code(200).send({
        items: items.map(respostaLancamento),
        meta: buildPageMeta({ page, perPage, total }),
      });
    },
  );

  app.post(
    '/lancamentos',
    {
      schema: {
        tags: ['finance'],
        summary: 'Cria um lancamento financeiro',
        description:
          '`method` presente lanca como PAGO (pagamento na hora); ausente lanca como ' +
          'PENDENTE, para ser liquidado em `/lancamentos/:id/pagar`.',
        body: financialEntryCreateSchema,
        response: {
          201: financialEntrySchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const corpo = request.body;

      if (corpo.clientId !== undefined) {
        const cliente = await prisma.client.findFirst({
          where: { id: corpo.clientId, clinicId: sessao.clinicId },
          select: { id: true },
        });
        if (cliente === null) {
          return reply
            .code(404)
            .send({ error: 'CLIENT_NOT_FOUND', message: 'Cliente nao encontrado.' });
        }
      }

      if (corpo.appointmentId !== undefined) {
        const agendamento = await prisma.appointment.findFirst({
          where: { id: corpo.appointmentId, clinicId: sessao.clinicId },
          select: { clientId: true },
        });
        if (agendamento === null) {
          return reply
            .code(404)
            .send({ error: 'APPOINTMENT_NOT_FOUND', message: 'Agendamento nao encontrado.' });
        }
        if (corpo.clientId !== undefined && agendamento.clientId !== corpo.clientId) {
          return reply.code(422).send({
            error: 'APPOINTMENT_CLIENT_MISMATCH',
            message: 'O agendamento nao pertence a este cliente.',
          });
        }
      }

      if (corpo.packageId !== undefined) {
        const pacote = await prisma.package.findFirst({
          where: { id: corpo.packageId, clinicId: sessao.clinicId },
          select: { id: true },
        });
        if (pacote === null) {
          return reply
            .code(404)
            .send({ error: 'PACKAGE_NOT_FOUND', message: 'Pacote nao encontrado.' });
        }
      }

      const pagoNaHora = corpo.method !== undefined;

      try {
        const lancamento = await prisma.financialEntry.create({
          data: {
            clinicId: sessao.clinicId,
            kind: corpo.kind,
            status: pagoNaHora ? 'PAGO' : 'PENDENTE',
            method: corpo.method ?? null,
            clientId: corpo.clientId ?? null,
            appointmentId: corpo.appointmentId ?? null,
            packageId: corpo.packageId ?? null,
            amountCents: corpo.amountCents,
            dueDate: corpo.dueDate === undefined ? null : dataColuna(corpo.dueDate),
            paidAt: pagoNaHora
              ? corpo.paidAt === undefined
                ? new Date()
                : new Date(corpo.paidAt)
              : null,
            description: corpo.description ?? null,
            notes: corpo.notes ?? null,
            idempotencyKey: corpo.idempotencyKey ?? null,
            createdByUserId: sessao.userId,
          },
          include: { client: { select: { name: true } } },
        });
        return reply.code(201).send(respostaLancamento(lancamento));
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Lancamento repetido'));
        }
        throw error;
      }
    },
  );

  app.post(
    '/lancamentos/:id/pagar',
    {
      schema: {
        tags: ['finance'],
        summary: 'Liquida um lancamento a receber',
        params: paramsSchema,
        body: financialEntryPaymentInputSchema,
        response: {
          200: financialEntrySchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const lancamento = await prisma.financialEntry.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
      });

      if (lancamento === null) {
        return reply
          .code(404)
          .send({ error: 'ENTRY_NOT_FOUND', message: 'Lancamento nao encontrado.' });
      }

      if (lancamento.status !== 'PENDENTE' && lancamento.status !== 'INADIMPENTE') {
        return reply.code(422).send({
          error: 'INVALID_STATUS_TRANSITION',
          message: 'Somente lancamentos a receber podem ser liquidados.',
        });
      }

      const atualizado = await prisma.financialEntry.update({
        where: { id: lancamento.id },
        data: {
          status: 'PAGO',
          method: request.body.method,
          paidAt: request.body.paidAt === undefined ? new Date() : new Date(request.body.paidAt),
          ...(request.body.notes === undefined ? {} : { notes: request.body.notes }),
        },
        include: { client: { select: { name: true } } },
      });

      return reply.code(200).send(respostaLancamento(atualizado));
    },
  );

  app.post(
    '/lancamentos/:id/cancelar',
    {
      schema: {
        tags: ['finance'],
        summary: 'Cancela um lancamento a receber',
        params: paramsSchema,
        body: financialEntryCancelSchema,
        response: {
          200: financialEntrySchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const lancamento = await prisma.financialEntry.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
      });

      if (lancamento === null) {
        return reply
          .code(404)
          .send({ error: 'ENTRY_NOT_FOUND', message: 'Lancamento nao encontrado.' });
      }

      if (lancamento.status !== 'PENDENTE' && lancamento.status !== 'INADIMPENTE') {
        return reply.code(422).send({
          error: 'INVALID_STATUS_TRANSITION',
          message: 'Somente lancamentos a receber podem ser cancelados.',
        });
      }

      const atualizado = await prisma.financialEntry.update({
        where: { id: lancamento.id },
        data: {
          status: 'CANCELADO',
          ...(request.body.notes === undefined ? {} : { notes: request.body.notes }),
        },
        include: { client: { select: { name: true } } },
      });

      return reply.code(200).send(respostaLancamento(atualizado));
    },
  );

  // --- Pacotes ---------------------------------------------------------

  async function saldosDosPacotes(ids: string[]) {
    if (ids.length === 0) return new Map<string, { usadas: number; restantes: number }>();

    const grupos = await prisma.packageSession.groupBy({
      by: ['packageId', 'status'],
      where: { packageId: { in: ids }, status: { in: ['UTILIZADA', 'DISPONIVEL'] } },
      _count: { _all: true },
    });

    const saldo = new Map<string, { usadas: number; restantes: number }>();
    for (const grupo of grupos) {
      const atual = saldo.get(grupo.packageId) ?? { usadas: 0, restantes: 0 };
      if (grupo.status === 'UTILIZADA') atual.usadas += grupo._count._all;
      if (grupo.status === 'DISPONIVEL') atual.restantes += grupo._count._all;
      saldo.set(grupo.packageId, atual);
    }
    return saldo;
  }

  app.get(
    '/pacotes',
    {
      schema: {
        tags: ['finance'],
        summary: 'Lista os pacotes de sessoes',
        querystring: packageListQuerySchema,
        response: { 200: packageListResponseSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const { page, perPage, status, clientId } = request.query;

      const where = {
        clinicId: sessao.clinicId,
        ...(status === undefined ? {} : { status }),
        ...(clientId === undefined ? {} : { clientId }),
      };

      const [items, total] = await Promise.all([
        prisma.package.findMany({
          where,
          include: { client: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          ...paginate({ page, perPage }),
        }),
        prisma.package.count({ where }),
      ]);

      const saldos = await saldosDosPacotes(items.map((p) => p.id));

      const resposta = items.map((pacote) => {
        const saldo = saldos.get(pacote.id) ?? { usadas: 0, restantes: 0 };
        return respostaPacote(pacote, saldo);
      });

      return reply
        .code(200)
        .send({ items: resposta, meta: buildPageMeta({ page, perPage, total }) });
    },
  );

  app.get(
    '/pacotes/:id',
    {
      schema: {
        tags: ['finance'],
        summary: 'Detalhe de um pacote com as sessoes',
        params: paramsSchema,
        response: { 200: packageDetailSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const pacote = await prisma.package.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        include: {
          client: { select: { name: true } },
          sessions: { orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] },
        },
      });

      if (pacote === null) {
        return reply
          .code(404)
          .send({ error: 'PACKAGE_NOT_FOUND', message: 'Pacote nao encontrado.' });
      }

      const usadas = pacote.sessions.filter((s) => s.status === 'UTILIZADA').length;
      const restantes = pacote.sessions.filter((s) => s.status === 'DISPONIVEL').length;

      return reply.code(200).send({
        ...respostaPacote(pacote, { usadas, restantes }),
        sessions: pacote.sessions.map((sessao) => ({
          id: sessao.id,
          status: sessao.status,
          appointmentId: sessao.appointmentId,
          consumedAt: sessao.consumedAt === null ? null : sessao.consumedAt.toISOString(),
          expiresAt: sessao.expiresAt === null ? null : sessao.expiresAt.toISOString().slice(0, 10),
        })),
      });
    },
  );

  app.post(
    '/pacotes',
    {
      schema: {
        tags: ['finance'],
        summary: 'Cria um pacote de sessoes',
        description:
          'Cria o pacote com as sessoes disponiveis e ja gera a receita da venda: PAGO ' +
          'quando `payment` vier preenchido, pendente (a receber) caso contrario.',
        body: packageCreateSchema,
        response: {
          201: packageSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const corpo = request.body;

      const cliente = await prisma.client.findFirst({
        where: { id: corpo.clientId, clinicId: sessao.clinicId },
        select: { id: true, name: true },
      });
      if (cliente === null) {
        return reply
          .code(404)
          .send({ error: 'CLIENT_NOT_FOUND', message: 'Cliente nao encontrado.' });
      }

      try {
        const pacote = await prisma.$transaction(async (tx) => {
          const p = await tx.package.create({
            data: {
              clinicId: sessao.clinicId,
              clientId: cliente.id,
              name: corpo.name,
              totalSessions: corpo.totalSessions,
              priceCents: corpo.priceCents,
              validFrom: dataColuna(corpo.validFrom),
              validUntil: dataColuna(corpo.validUntil),
              notes: corpo.notes ?? null,
              createdByUserId: sessao.userId,
            },
          });

          await tx.packageSession.createMany({
            data: Array.from({ length: p.totalSessions }, () => ({
              clinicId: sessao.clinicId,
              packageId: p.id,
              expiresAt: p.validUntil,
            })),
          });

          await tx.financialEntry.create({
            data: {
              clinicId: sessao.clinicId,
              clientId: cliente.id,
              packageId: p.id,
              kind: 'RECEITA',
              status: corpo.payment === undefined ? 'PENDENTE' : 'PAGO',
              method: corpo.payment?.method ?? null,
              amountCents: p.priceCents,
              dueDate: p.validFrom,
              paidAt:
                corpo.payment === undefined
                  ? null
                  : corpo.payment.paidAt === undefined
                    ? new Date()
                    : new Date(corpo.payment.paidAt),
              description: `${p.name} - ${p.totalSessions} sessoes`,
              createdByUserId: sessao.userId,
            },
          });

          return p;
        });

        return reply
          .code(201)
          .send(
            respostaPacote(
              { ...pacote, client: { name: cliente.name } },
              { usadas: 0, restantes: pacote.totalSessions },
            ),
          );
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Pacote'));
        }
        throw error;
      }
    },
  );

  app.post(
    '/pacotes/:id/status',
    {
      schema: {
        tags: ['finance'],
        summary: 'Altera o status de um pacote',
        description:
          'CONCLUIDO so quando o saldo de sessoes zerar; CANCELADO e EXPIRADO encerram um ' +
          'pacote ativo. A operacao e idempotente: repetir o mesmo status devolve 200.',
        params: paramsSchema,
        body: packageStatusUpdateSchema,
        response: {
          200: packageSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const corpo = request.body;

      const pacote = await prisma.package.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        include: { client: { select: { name: true } } },
      });

      if (pacote === null) {
        return reply
          .code(404)
          .send({ error: 'PACKAGE_NOT_FOUND', message: 'Pacote nao encontrado.' });
      }

      if (pacote.status === corpo.status) {
        const [usadas, restantes] = await Promise.all([
          prisma.packageSession.count({ where: { packageId: pacote.id, status: 'UTILIZADA' } }),
          prisma.packageSession.count({ where: { packageId: pacote.id, status: 'DISPONIVEL' } }),
        ]);
        return reply.code(200).send(respostaPacote(pacote, { usadas, restantes }));
      }

      if (pacote.status !== 'ATIVO') {
        return reply.code(422).send({
          error: 'INVALID_STATUS_TRANSITION',
          message: 'Somente pacotes ativos mudam de status.',
        });
      }

      if (corpo.status === 'CONCLUIDO') {
        const usadas = await prisma.packageSession.count({
          where: { packageId: pacote.id, status: 'UTILIZADA' },
        });
        if (usadas !== pacote.totalSessions) {
          return reply.code(422).send({
            error: 'PACKAGE_SESSIONS_REMAINING',
            message: 'Pacote ainda tem sessoes disponiveis.',
          });
        }
      }

      const atualizado = await prisma.package.update({
        where: { id: pacote.id },
        data: { status: corpo.status },
        include: { client: { select: { name: true } } },
      });

      const [usadas, restantes] = await Promise.all([
        prisma.packageSession.count({ where: { packageId: pacote.id, status: 'UTILIZADA' } }),
        prisma.packageSession.count({ where: { packageId: pacote.id, status: 'DISPONIVEL' } }),
      ]);

      return reply.code(200).send(respostaPacote(atualizado, { usadas, restantes }));
    },
  );

  async function detalheAposAcao(pacoteId: string) {
    const pacote = await prisma.package.findFirst({
      where: { id: pacoteId },
      include: {
        client: { select: { name: true } },
        sessions: { orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (pacote === null) return null;
    const usadas = pacote.sessions.filter((s) => s.status === 'UTILIZADA').length;
    const restantes = pacote.sessions.filter((s) => s.status === 'DISPONIVEL').length;
    return {
      ...respostaPacote(pacote, { usadas, restantes }),
      sessions: pacote.sessions.map((sessao) => ({
        id: sessao.id,
        status: sessao.status,
        appointmentId: sessao.appointmentId,
        consumedAt: sessao.consumedAt === null ? null : sessao.consumedAt.toISOString(),
        expiresAt: sessao.expiresAt === null ? null : sessao.expiresAt.toISOString().slice(0, 10),
      })),
    };
  }

  app.post(
    '/pacotes/:id/sessoes/:sessionId/usar',
    {
      schema: {
        tags: ['finance'],
        summary: 'Consome uma sessao do pacote',
        description:
          'Marca uma sessao disponivel como utilizada. Serve para atender no balcao sem ' +
          'agendamento; consumir via agenda vincula o agendamento a sessao.',
        params: sessaoParamsSchema,
        response: {
          200: packageDetailSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const pacote = await prisma.package.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        select: { id: true },
      });
      if (pacote === null) {
        return reply
          .code(404)
          .send({ error: 'PACKAGE_NOT_FOUND', message: 'Pacote nao encontrado.' });
      }

      const sessaoDoPacote = await prisma.packageSession.findFirst({
        where: { id: request.params.sessionId, packageId: pacote.id, clinicId: sessao.clinicId },
      });
      if (sessaoDoPacote === null) {
        return reply
          .code(404)
          .send({ error: 'SESSION_NOT_FOUND', message: 'Sessao do pacote nao encontrada.' });
      }

      if (sessaoDoPacote.status !== 'DISPONIVEL') {
        return reply.code(422).send({
          error: 'INVALID_STATUS_TRANSITION',
          message: 'Somente sessoes disponiveis podem ser consumidas.',
        });
      }

      await prisma.packageSession.update({
        where: { id: sessaoDoPacote.id },
        data: { status: 'UTILIZADA', consumedAt: new Date() },
      });

      const detalhe = await detalheAposAcao(pacote.id);
      if (detalhe === null) {
        return reply
          .code(404)
          .send({ error: 'PACKAGE_NOT_FOUND', message: 'Pacote nao encontrado.' });
      }
      return reply.code(200).send(detalhe);
    },
  );

  app.post(
    '/pacotes/:id/sessoes/:sessionId/disponibilizar',
    {
      schema: {
        tags: ['finance'],
        summary: 'Devolve uma sessao ao saldo',
        description: 'Desfaz o consumo de uma sessao que nao foi vinculada a agendamento.',
        params: sessaoParamsSchema,
        response: {
          200: packageDetailSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const pacote = await prisma.package.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        select: { id: true },
      });
      if (pacote === null) {
        return reply
          .code(404)
          .send({ error: 'PACKAGE_NOT_FOUND', message: 'Pacote nao encontrado.' });
      }

      const sessaoDoPacote = await prisma.packageSession.findFirst({
        where: { id: request.params.sessionId, packageId: pacote.id, clinicId: sessao.clinicId },
      });
      if (sessaoDoPacote === null) {
        return reply
          .code(404)
          .send({ error: 'SESSION_NOT_FOUND', message: 'Sessao do pacote nao encontrada.' });
      }

      if (sessaoDoPacote.status !== 'UTILIZADA' || sessaoDoPacote.appointmentId !== null) {
        return reply.code(422).send({
          error: 'INVALID_STATUS_TRANSITION',
          message: 'Somente sessoes usadas sem agendamento voltam ao saldo.',
        });
      }

      await prisma.packageSession.update({
        where: { id: sessaoDoPacote.id },
        data: { status: 'DISPONIVEL', consumedAt: null },
      });

      const detalhe = await detalheAposAcao(pacote.id);
      if (detalhe === null) {
        return reply
          .code(404)
          .send({ error: 'PACKAGE_NOT_FOUND', message: 'Pacote nao encontrado.' });
      }
      return reply.code(200).send(detalhe);
    },
  );

  // --- Comissoes -------------------------------------------------------

  app.get(
    '/comissoes',
    {
      schema: {
        tags: ['finance'],
        summary: 'Lista as comissoes dos profissionais',
        querystring: commissionListQuerySchema,
        response: { 200: commissionListResponseSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const { page, perPage, professionalId, status } = request.query;

      const where = {
        clinicId: sessao.clinicId,
        ...(professionalId === undefined ? {} : { professionalId }),
        ...(status === undefined ? {} : { status }),
      };

      const [items, total] = await Promise.all([
        prisma.commission.findMany({
          where,
          include: { professional: { select: { name: true } } },
          orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
          ...paginate({ page, perPage }),
        }),
        prisma.commission.count({ where }),
      ]);

      return reply.code(200).send({
        items: items.map(respostaComissao),
        meta: buildPageMeta({ page, perPage, total }),
      });
    },
  );

  app.post(
    '/comissoes/:id/aprovar',
    {
      schema: {
        tags: ['finance'],
        summary: 'Aprova uma comissao prevista',
        params: paramsSchema,
        response: {
          200: commissionSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const comissao = await prisma.commission.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        include: { professional: { select: { name: true } } },
      });
      if (comissao === null) {
        return reply
          .code(404)
          .send({ error: 'COMMISSION_NOT_FOUND', message: 'Comissao nao encontrada.' });
      }

      if (comissao.status === 'APROVADA') return reply.code(200).send(respostaComissao(comissao));
      if (comissao.status !== 'PREVISTA') {
        return reply.code(422).send({
          error: 'INVALID_STATUS_TRANSITION',
          message: 'Somente comissao prevista pode ser aprovada.',
        });
      }

      const atualizada = await prisma.commission.update({
        where: { id: comissao.id },
        data: { status: 'APROVADA' },
        include: { professional: { select: { name: true } } },
      });
      return reply.code(200).send(respostaComissao(atualizada));
    },
  );

  app.post(
    '/comissoes/:id/pagar',
    {
      schema: {
        tags: ['finance'],
        summary: 'Registra o pagamento de uma comissao',
        params: paramsSchema,
        response: {
          200: commissionSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const comissao = await prisma.commission.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        include: { professional: { select: { name: true } } },
      });
      if (comissao === null) {
        return reply
          .code(404)
          .send({ error: 'COMMISSION_NOT_FOUND', message: 'Comissao nao encontrada.' });
      }

      if (comissao.status === 'PAGA') return reply.code(200).send(respostaComissao(comissao));
      if (comissao.status !== 'APROVADA') {
        return reply.code(422).send({
          error: 'INVALID_STATUS_TRANSITION',
          message: 'Somente comissao aprovada pode ser paga.',
        });
      }

      const atualizada = await prisma.commission.update({
        where: { id: comissao.id },
        data: { status: 'PAGA', paidAt: new Date() },
        include: { professional: { select: { name: true } } },
      });
      return reply.code(200).send(respostaComissao(atualizada));
    },
  );

  app.post(
    '/comissoes/:id/cancelar',
    {
      schema: {
        tags: ['finance'],
        summary: 'Cancela uma comissao',
        params: paramsSchema,
        response: {
          200: commissionSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const comissao = await prisma.commission.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        include: { professional: { select: { name: true } } },
      });
      if (comissao === null) {
        return reply
          .code(404)
          .send({ error: 'COMMISSION_NOT_FOUND', message: 'Comissao nao encontrada.' });
      }

      if (comissao.status === 'CANCELADA') return reply.code(200).send(respostaComissao(comissao));
      if (comissao.status !== 'PREVISTA' && comissao.status !== 'APROVADA') {
        return reply.code(422).send({
          error: 'INVALID_STATUS_TRANSITION',
          message: 'Somente comissao prevista ou aprovada pode ser cancelada.',
        });
      }

      const atualizada = await prisma.commission.update({
        where: { id: comissao.id },
        data: { status: 'CANCELADA' },
        include: { professional: { select: { name: true } } },
      });
      return reply.code(200).send(respostaComissao(atualizada));
    },
  );

  // --- Resumo ----------------------------------------------------------

  app.get(
    '/resumo',
    {
      schema: {
        tags: ['finance'],
        summary: 'Resumo financeiro do periodo',
        description:
          'Totais do periodo [de, ate): recebido e despesas liquidados (paidAt), a receber ' +
          'por vencimento (dueDate), valores por metodo, inadimplencia e comissoes. Sem ' +
          '`de`/`ate`, o periodo e o mes corrente.',
        querystring: resumoQuerySchema,
        response: { 200: resumoFinanceiroSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) return reply.code(401).send(naoAutenticado);

      const hoje = hojeCivil();
      const { de: deISO, ate: ateISO } = request.query;

      const de =
        deISO === undefined
          ? new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1))
          : dataColuna(deISO);
      const fim =
        ateISO === undefined ? diaSeguinte(hoje.toISOString().slice(0, 10)) : diaSeguinte(ateISO);
      const vencidoFim = hoje.getTime() < fim.getTime() ? hoje : fim;

      const recebidas: Prisma.FinancialEntryWhereInput = {
        clinicId: sessao.clinicId,
        status: 'PAGO',
        paidAt: { gte: de, lt: fim },
      };
      const aReceber: Prisma.FinancialEntryWhereInput = {
        clinicId: sessao.clinicId,
        kind: 'RECEITA',
        status: { in: ['PENDENTE', 'INADIMPENTE'] },
        dueDate: { gte: de, lt: fim },
      };

      const [
        recebidoAgg,
        despesaAgg,
        aReceberAgg,
        vencidoAgg,
        porMetodo,
        porCliente,
        comissoesAPagar,
        comissoesPagas,
      ] = await Promise.all([
        prisma.financialEntry.aggregate({
          where: { ...recebidas, kind: 'RECEITA' },
          _sum: { amountCents: true },
        }),
        prisma.financialEntry.aggregate({
          where: { ...recebidas, kind: 'DESPESA' },
          _sum: { amountCents: true },
        }),
        prisma.financialEntry.aggregate({ where: aReceber, _sum: { amountCents: true } }),
        prisma.financialEntry.aggregate({
          where: { ...aReceber, dueDate: { gte: de, lt: vencidoFim } },
          _sum: { amountCents: true },
        }),
        prisma.financialEntry.groupBy({
          by: ['method'],
          where: { ...recebidas, kind: 'RECEITA', method: { not: null } },
          _sum: { amountCents: true },
          _count: { _all: true },
        }),
        prisma.financialEntry.groupBy({
          by: ['clientId'],
          where: { ...aReceber, clientId: { not: null } },
          _sum: { amountCents: true },
        }),
        prisma.commission.aggregate({
          where: { clinicId: sessao.clinicId, status: { in: ['PREVISTA', 'APROVADA'] } },
          _sum: { amountCents: true },
        }),
        prisma.commission.aggregate({
          where: { clinicId: sessao.clinicId, status: 'PAGA', paidAt: { gte: de, lt: fim } },
          _sum: { amountCents: true },
        }),
      ]);

      const recebidoPorMetodo = porMetodo
        .filter((grupo) => grupo.method !== null)
        .map((grupo) => ({
          method: grupo.method as NonNullable<typeof grupo.method>,
          total: grupo._sum?.amountCents ?? 0,
          quantidade: grupo._count._all,
        }))
        .sort((a, b) => b.total - a.total);

      const idsDeClientes = porCliente.map((grupo) => grupo.clientId).filter(Boolean) as string[];
      const nomes = idsDeClientes.length
        ? await prisma.client.findMany({
            where: { id: { in: idsDeClientes }, clinicId: sessao.clinicId },
            select: { id: true, name: true },
          })
        : [];
      const nomePorId = new Map(nomes.map((c) => [c.id, c.name]));
      const aReceberPorCliente = porCliente
        .map((grupo) => ({
          clientName:
            grupo.clientId === null
              ? 'Cliente removido'
              : (nomePorId.get(grupo.clientId) ?? 'Cliente removido'),
          total: grupo._sum?.amountCents ?? 0,
        }))
        .sort((a, b) => b.total - a.total);

      const recebido = recebidoAgg._sum?.amountCents ?? 0;
      const despesas = despesaAgg._sum?.amountCents ?? 0;

      return reply.code(200).send({
        de: de.toISOString().slice(0, 10),
        ate: ateISO ?? hoje.toISOString().slice(0, 10),
        recebido,
        despesas,
        saldoPeriodo: recebido - despesas,
        aReceber: aReceberAgg._sum?.amountCents ?? 0,
        aReceberVencido: vencidoAgg._sum?.amountCents ?? 0,
        recebidoPorMetodo,
        aReceberPorCliente,
        comissoes: {
          aPagar: comissoesAPagar._sum?.amountCents ?? 0,
          pagas: comissoesPagas._sum?.amountCents ?? 0,
        },
      });
    },
  );

  done();
};
