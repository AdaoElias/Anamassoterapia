import { clientContraindicationSchema, idSchema, prontuarioSchema } from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { anamneseVigente } from '../lib/anamneses/servico.js';
import {
  alertaSelect,
  anamnesisListaSelect,
  condicaoSelect,
  naoEncontradoCliente,
  respostaAlerta,
  respostaAnamnesis,
  respostaCondicao,
} from '../lib/anamneses/visao.js';
import { paraDataISO } from '../lib/cadastros.js';
import { prisma } from '../lib/prisma.js';

/**
 * Prontuario do cliente: a visao reunida que o profissional abre antes de
 * atender.
 *
 * Uma rota so, de proposito. As quatro pecas -- anamnese vigente, historico
 * de anamneses, condicoes de saude e alertas -- so fazem sentido juntas: um
 * painel com quatro abas deixa o profissional decidir o que olhar, e o que
 * ele nao olhar e exatamente o que muda o atendimento. Aqui ele recebe o
 * estado e escolhe o que abrir.
 *
 * As **respostas** da anamnese nao vem aqui. Vem os metadados (versao,
 * status, quem revisou) e a resposta so quando alguem pede o detalhe. E o
 * que impede que um `GET` de prontuario -- registro de acesso comum, lido
 * por proxy e log de aplicacao -- despeje dado de saude do cliente.
 */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const paramsSchema = z.object({ clientId: idSchema });
const condicaoParamsSchema = z.object({ clientId: idSchema, conditionId: idSchema });

/** Quantos registros o prontuario traz. O historico completo e paginado, la fora. */
const LIMITE_ANAMNESES = 20;
const LIMITE_SESSOES = 20;
const LIMITE_CONDICOES = 50;

export const prontuarioRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/:clientId',
    {
      schema: {
        tags: ['records'],
        summary: 'Prontuario do cliente',
        description:
          'Estado clinico reunido: anamnese vigente, versoes, condicoes e alertas. ' +
          'As respostas em si ficam em `GET /anamnesis/:id`.',
        params: paramsSchema,
        response: { 200: prontuarioSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const cliente = await prisma.client.findFirst({
        where: { id: request.params.clientId, clinicId: sessao.clinicId },
        select: { id: true, name: true, phone: true, email: true, birthDate: true, notes: true },
      });

      if (cliente === null) {
        return reply.code(404).send(naoEncontradoCliente());
      }

      const anamnesesWhere = { clinicId: sessao.clinicId, clientId: cliente.id };

      const [
        anamneses,
        sessoes,
        condicoes,
        alertas,
        vigente,
        pendentes,
        alertasPendentes,
        realizadas,
      ] = await Promise.all([
        prisma.anamnesis.findMany({
          where: anamnesesWhere,
          orderBy: { version: 'desc' },
          take: LIMITE_ANAMNESES,
          select: anamnesisListaSelect,
        }),
        prisma.appointment.findMany({
          where: { clinicId: sessao.clinicId, clientId: cliente.id },
          orderBy: { startAt: 'desc' },
          take: LIMITE_SESSOES,
          select: {
            id: true,
            startAt: true,
            endAt: true,
            status: true,
            sessionNotes: true,
            therapy: { select: { name: true } },
            professional: { select: { name: true } },
            anamnesisUsed: { select: { anamnesis: { select: { version: true } } } },
          },
        }),
        prisma.clientContraindication.findMany({
          where: { clinicId: sessao.clinicId, clientId: cliente.id },
          orderBy: [{ resolvedAt: 'asc' }, { createdAt: 'desc' }],
          take: LIMITE_CONDICOES,
          select: condicaoSelect,
        }),
        prisma.contraindicationAlert.findMany({
          where: { clinicId: sessao.clinicId, appointment: { clientId: cliente.id } },
          orderBy: { createdAt: 'desc' },
          take: LIMITE_SESSOES,
          select: alertaSelect,
        }),
        anamneseVigente(sessao.clinicId, cliente.id),
        prisma.anamnesis.count({ where: { ...anamnesesWhere, status: 'ENVIADA' } }),
        prisma.contraindicationAlert.count({
          where: {
            clinicId: sessao.clinicId,
            decision: 'PENDENTE',
            appointment: { clientId: cliente.id },
          },
        }),
        prisma.appointment.count({
          where: { clinicId: sessao.clinicId, clientId: cliente.id, status: 'CONCLUIDO' },
        }),
      ]);

      return reply.code(200).send({
        client: {
          id: cliente.id,
          name: cliente.name,
          phone: cliente.phone,
          email: cliente.email,
          birthDate: paraDataISO(cliente.birthDate),
          notes: cliente.notes,
        },
        situacao: {
          anamneseVigente: vigente === null ? null : { id: vigente.id, version: vigente.version },
          anamnesePendente: pendentes,
          condicoesAtivas: condicoes.filter((condicao) => condicao.resolvedAt === null).length,
          alertasPendentes,
          sessoesRealizadas: realizadas,
        },
        anamneses: anamneses.map(respostaAnamnesis),
        sessoes: sessoes.map((linha) => ({
          id: linha.id,
          startAt: linha.startAt.toISOString(),
          endAt: linha.endAt.toISOString(),
          status: linha.status,
          therapyName: linha.therapy.name,
          professionalName: linha.professional.name,
          sessionNotes: linha.sessionNotes,
          // A versao congelada da sessao: e o que prova com qual anamnese o
          // atendimento foi feito, mesmo que hoje exista versao mais nova.
          anamnesisVersion: linha.anamnesisUsed[0]?.anamnesis.version ?? null,
        })),
        condicoes: condicoes.map(respostaCondicao),
        alertas: alertas.map(respostaAlerta),
      });
    },
  );

  app.get(
    '/:clientId/condicoes/:conditionId',
    {
      schema: {
        tags: ['records'],
        summary: 'Detalhe de uma condicao de saude',
        params: condicaoParamsSchema,
        response: { 200: clientContraindicationSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const condicao = await prisma.clientContraindication.findFirst({
        where: {
          id: request.params.conditionId,
          clientId: request.params.clientId,
          clinicId: sessao.clinicId,
        },
        select: condicaoSelect,
      });

      if (condicao === null) {
        return reply
          .code(404)
          .send({ error: 'CONDITION_NOT_FOUND', message: 'Condicao nao encontrada.' });
      }

      return reply.code(200).send(respostaCondicao(condicao));
    },
  );

  done();
};
