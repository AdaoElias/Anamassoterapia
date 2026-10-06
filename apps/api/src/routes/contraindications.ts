import {
  alertDecisionResponseSchema,
  alertDecisionSchema,
  alertListQuerySchema,
  alertListResponseSchema,
  clientContraindicationCreateSchema,
  clientContraindicationListResponseSchema,
  clientContraindicationParamsSchema,
  clientContraindicationResolveSchema,
  clientContraindicationSchema,
  conditionParamsSchema,
  contraindicationCreateSchema,
  contraindicationListQuerySchema,
  contraindicationListResponseSchema,
  contraindicationSchema,
  contraindicationUpdateSchema,
  idSchema,
  therapyContraindicationLinkSchema,
  vinculoContraindicationSchema,
  vinculoParamsSchema,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  alertaSelect,
  CATALOGO_SELECT,
  condicaoSelect,
  respostaAlerta,
  respostaCatalogo,
  respostaCondicao,
} from '../lib/anamneses/visao.js';
import { dataCalendario, ehConflitoUnico, mensagemConflito } from '../lib/cadastros.js';
import { ErroDominio } from '../lib/dominio-erros.js';
import { prisma } from '../lib/prisma.js';

/**
 * Contraindicacoes: o catalogo da clinica, as condicoes de saude do cliente
 * e os alertas gerados na combinacao dos dois.
 *
 * **O sistema avisa, nunca bloqueia.** Quem pode avaliar se a contraindicacao
 * e real para aquele atendimento e o profissional com o cliente; o que o
 * sistema garante e que a decisao fique registrada (`ACEITO` ou `BLOQUEADO`),
 * o que protege o profissional e o cliente. Um bloqueio automatico seria
 * pior dos dois lados: esconderia o profissional do que ele precisa ler e
 * deixaria o cliente sem atendimento por um cadastro desatualizado.
 */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const paramsSchema = z.object({ id: idSchema });

export const contraindicationRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  // ------------------------------------------------------------------
  // Alertas (sao o que o painel mostra antes de atender)
  // ------------------------------------------------------------------

  app.get(
    '/alertas',
    {
      schema: {
        tags: ['records'],
        summary: 'Lista os alertas de contraindicacao',
        description: 'Filtra por decisao; o padrao e so o que ainda esta pendente.',
        querystring: alertListQuerySchema,
        response: { 200: alertListResponseSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const { decision, appointmentId, limit, offset } = request.query;

      const where = {
        clinicId: sessao.clinicId,
        decision,
        ...(appointmentId === undefined ? {} : { appointmentId }),
      };

      const [linhas, total] = await Promise.all([
        prisma.contraindicationAlert.findMany({
          where,
          orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
          take: limit,
          skip: offset,
          select: alertaSelect,
        }),
        prisma.contraindicationAlert.count({ where }),
      ]);

      return reply.code(200).send({ items: linhas.map(respostaAlerta), total });
    },
  );

  app.post(
    '/alertas/:id/decisao',
    {
      schema: {
        tags: ['records'],
        summary: 'Registra a decisao sobre o alerta',
        description:
          'ACEITO mantem a sessao; BLOQUEADO e o registro de que ela nao deveria ter acontecido. ' +
          'Nao ha "dispensar": a decisao fica na trilha.',
        params: paramsSchema,
        body: alertDecisionSchema,
        response: {
          200: alertDecisionResponseSchema,
          401: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const existente = await prisma.contraindicationAlert.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        select: { id: true, decision: true },
      });

      if (existente === null) {
        return reply
          .code(404)
          .send({ error: 'ALERT_NOT_FOUND', message: 'Alerta nao encontrado.' });
      }

      if (existente.decision !== 'PENDENTE') {
        return reply.code(409).send({
          error: 'ALERT_ALREADY_DECIDED',
          message: 'Este alerta ja tem decisao registrada.',
        });
      }

      // `decision: PENDENTE` no `where` e o que fecha a corrida entre dois
      // profissionais clicando em "registrar decisao" ao mesmo tempo.
      const { count } = await prisma.contraindicationAlert.updateMany({
        where: { id: existente.id, clinicId: sessao.clinicId, decision: 'PENDENTE' },
        data: {
          decision: request.body.decision,
          decisionNotes: request.body.decisionNotes ?? null,
          acknowledgedAt: new Date(),
          acknowledgedByUserId: sessao.userId,
        },
      });

      if (count === 0) {
        throw new ErroDominio(
          'ALERT_ALREADY_DECIDED',
          409,
          'Este alerta ja tem decisao registrada.',
        );
      }

      const alerta = await prisma.contraindicationAlert.findUniqueOrThrow({
        where: { id: existente.id },
        select: alertaSelect,
      });

      return reply.code(200).send({ alert: respostaAlerta(alerta) });
    },
  );

  // ------------------------------------------------------------------
  // Condicoes do cliente
  // ------------------------------------------------------------------

  app.get(
    '/clientes/:clientId',
    {
      schema: {
        tags: ['records'],
        summary: 'Condicoes de saude registradas de um cliente',
        description:
          'Inclui as ja resolvidas; o filtro e do painel, e o prontuario guarda a historia.',
        params: clientContraindicationParamsSchema,
        response: {
          200: clientContraindicationListResponseSchema,
          401: erroSchema,
          404: erroSchema,
        },
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
        select: { id: true },
      });
      if (cliente === null) {
        return reply
          .code(404)
          .send({ error: 'CLIENT_NOT_FOUND', message: 'Cliente nao encontrado.' });
      }

      const condicoes = await prisma.clientContraindication.findMany({
        where: { clinicId: sessao.clinicId, clientId: cliente.id },
        orderBy: [{ resolvedAt: 'asc' }, { createdAt: 'desc' }],
        select: condicaoSelect,
      });

      return reply.code(200).send({ items: condicoes.map(respostaCondicao) });
    },
  );

  app.post(
    '/clientes/:clientId',
    {
      schema: {
        tags: ['records'],
        summary: 'Registra condicao de saude do cliente',
        description:
          'Com `contraindicationId`, o codigo e a severidade vem do catalogo. Sem ele, a condicao ' +
          'e registrada avulsa -- gestacao de 32 semanas, relato que so o profissional ouviu.',
        params: clientContraindicationParamsSchema,
        body: clientContraindicationCreateSchema,
        response: {
          201: clientContraindicationSchema,
          401: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const corpo = request.body;

      const cliente = await prisma.client.findFirst({
        where: { id: request.params.clientId, clinicId: sessao.clinicId },
        select: { id: true },
      });
      if (cliente === null) {
        return reply
          .code(404)
          .send({ error: 'CLIENT_NOT_FOUND', message: 'Cliente nao encontrado.' });
      }

      let codigo = corpo.code;
      let severidade = corpo.severity;
      let exigeAtestado = corpo.requiresMedicalClearance;

      if (corpo.contraindicationId !== undefined) {
        const doCatalogo = await prisma.contraindication.findFirst({
          where: { id: corpo.contraindicationId, clinicId: sessao.clinicId },
          select: { code: true, severity: true, requiresMedicalClearance: true },
        });
        if (doCatalogo === null) {
          return reply.code(404).send({
            error: 'CONTRAINDICATION_NOT_FOUND',
            message: 'Contraindicacao nao encontrada nesta clinica.',
          });
        }

        codigo = corpo.code ?? doCatalogo.code;
        severidade = corpo.severity ?? doCatalogo.severity;
        exigeAtestado = corpo.requiresMedicalClearance || doCatalogo.requiresMedicalClearance;
      }

      const condicao = await prisma.clientContraindication.create({
        data: {
          clinicId: sessao.clinicId,
          clientId: cliente.id,
          contraindicationId: corpo.contraindicationId ?? null,
          code: codigo ?? 'OUTRA',
          title: corpo.title,
          description: corpo.description ?? null,
          severity: severidade ?? 'MEDIA',
          requiresMedicalClearance: exigeAtestado ?? false,
          source: corpo.source ?? null,
          diagnosedAt: corpo.diagnosedAt === undefined ? null : dataCalendario(corpo.diagnosedAt),
          notes: corpo.notes ?? null,
          createdByUserId: sessao.userId,
        },
        select: condicaoSelect,
      });

      return reply.code(201).send(respostaCondicao(condicao));
    },
  );

  app.post(
    '/condicoes/:conditionId/resolver',
    {
      schema: {
        tags: ['records'],
        summary: 'Marca a condicao como resolvida',
        description:
          'Resolve nao apaga: a condicao sai dos alertas novos e continua no prontuario com a data.',
        params: conditionParamsSchema,
        body: clientContraindicationResolveSchema,
        response: {
          200: clientContraindicationSchema,
          401: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const { count } = await prisma.clientContraindication.updateMany({
        where: {
          id: request.params.conditionId,
          clinicId: sessao.clinicId,
          resolvedAt: null,
        },
        data: {
          resolvedAt: new Date(),
          notes: request.body.notes,
        },
      });

      if (count === 0) {
        const existe = await prisma.clientContraindication.count({
          where: { id: request.params.conditionId, clinicId: sessao.clinicId },
        });

        return existe === 0
          ? reply
              .code(404)
              .send({ error: 'CONDITION_NOT_FOUND', message: 'Condicao nao encontrada.' })
          : reply.code(409).send({
              error: 'CONDITION_ALREADY_RESOLVED',
              message: 'Esta condicao ja estava resolvida.',
            });
      }

      const condicao = await prisma.clientContraindication.findUniqueOrThrow({
        where: { id: request.params.conditionId },
        select: condicaoSelect,
      });

      return reply.code(200).send(respostaCondicao(condicao));
    },
  );

  // ------------------------------------------------------------------
  // Catalogo da clinica (ADMIN gerencia)
  // ------------------------------------------------------------------

  app.get(
    '/',
    {
      schema: {
        tags: ['records'],
        summary: 'Lista o catalogo de contraindicacoes da clinica',
        querystring: contraindicationListQuerySchema,
        response: { 200: contraindicationListResponseSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const linhas = await prisma.contraindication.findMany({
        where: {
          clinicId: sessao.clinicId,
          ...(request.query.includeInactive ? {} : { active: true }),
        },
        orderBy: { title: 'asc' },
        select: CATALOGO_SELECT,
      });

      return reply.code(200).send({ items: linhas.map(respostaCatalogo) });
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['records'],
        summary: 'Cadastra uma contraindicacao no catalogo',
        body: contraindicationCreateSchema,
        response: {
          201: contraindicationSchema,
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
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const corpo = request.body;

      const therapies = await prisma.therapy.findMany({
        where: { id: { in: corpo.therapyIds }, clinicId: sessao.clinicId },
        select: { id: true },
      });
      if (therapies.length !== corpo.therapyIds.length) {
        return reply.code(404).send({
          error: 'THERAPY_NOT_FOUND',
          message: 'Uma das terapias nao existe nesta clinica.',
        });
      }

      try {
        const contraindication = await prisma.contraindication.create({
          data: {
            clinicId: sessao.clinicId,
            code: corpo.code,
            title: corpo.title,
            description: corpo.description ?? null,
            severity: corpo.severity,
            requiresMedicalClearance: corpo.requiresMedicalClearance,
            therapies: {
              create: therapies.map((terapia) => ({
                clinicId: sessao.clinicId,
                therapyId: terapia.id,
              })),
            },
          },
          select: CATALOGO_SELECT,
        });

        return reply.code(201).send(respostaCatalogo(contraindication));
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Codigo de contraindicacao'));
        }
        throw error;
      }
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['records'],
        summary: 'Detalhe de uma contraindicacao do catalogo',
        params: paramsSchema,
        response: { 200: contraindicationSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const linha = await prisma.contraindication.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        select: CATALOGO_SELECT,
      });

      if (linha === null) {
        return reply.code(404).send({
          error: 'CONTRAINDICATION_NOT_FOUND',
          message: 'Contraindicacao nao encontrada.',
        });
      }

      return reply.code(200).send(respostaCatalogo(linha));
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['records'],
        summary: 'Atualiza uma contraindicacao do catalogo',
        description:
          'O `code` e imutavel: e ele que liga a condicao avulsa ao catalogo. ' +
          'Para mudar, cadastrar outra.',
        params: paramsSchema,
        body: contraindicationUpdateSchema,
        response: {
          200: contraindicationSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const corpo = request.body;
      const { count } = await prisma.contraindication.updateMany({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        data: {
          title: corpo.title,
          description: corpo.description,
          severity: corpo.severity,
          requiresMedicalClearance: corpo.requiresMedicalClearance,
          active: corpo.active,
        },
      });

      if (count === 0) {
        return reply.code(404).send({
          error: 'CONTRAINDICATION_NOT_FOUND',
          message: 'Contraindicacao nao encontrada.',
        });
      }

      const linha = await prisma.contraindication.findUniqueOrThrow({
        where: { id: request.params.id },
        select: CATALOGO_SELECT,
      });

      return reply.code(200).send(respostaCatalogo(linha));
    },
  );

  app.post(
    '/terapias/:therapyId',
    {
      schema: {
        tags: ['records'],
        summary: 'Vincula uma contraindicacao a uma terapia',
        description:
          'Severidade e exigencia de atestado ausentes herdam o catalogo. O vinculo e sobrescrito, ' +
          'e nao duplicado.',
        params: z.object({ therapyId: idSchema }),
        body: therapyContraindicationLinkSchema,
        response: {
          201: vinculoContraindicationSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const corpo = request.body;

      // As duas pontas do vinculo precisam ser da mesma clinica: sem esta
      // checagem o banco aceitaria amarrar a terapia A a contraindicacao B.
      const [terapia, contraindication] = await Promise.all([
        prisma.therapy.findFirst({
          where: { id: request.params.therapyId, clinicId: sessao.clinicId },
          select: { id: true },
        }),
        prisma.contraindication.findFirst({
          where: { id: corpo.contraindicationId, clinicId: sessao.clinicId },
          select: { id: true },
        }),
      ]);

      if (terapia === null) {
        return reply
          .code(404)
          .send({ error: 'THERAPY_NOT_FOUND', message: 'Terapia nao encontrada.' });
      }
      if (contraindication === null) {
        return reply.code(404).send({
          error: 'CONTRAINDICATION_NOT_FOUND',
          message: 'Contraindicacao nao encontrada.',
        });
      }

      const vinculo = await prisma.therapyContraindication.upsert({
        where: {
          therapyId_contraindicationId: {
            therapyId: terapia.id,
            contraindicationId: contraindication.id,
          },
        },
        create: {
          clinicId: sessao.clinicId,
          therapyId: terapia.id,
          contraindicationId: contraindication.id,
          severity: corpo.severity ?? null,
          requiresMedicalClearance: corpo.requiresMedicalClearance ?? null,
        },
        update: {
          severity: corpo.severity ?? null,
          requiresMedicalClearance: corpo.requiresMedicalClearance ?? null,
        },
        select: {
          id: true,
          therapyId: true,
          contraindicationId: true,
          severity: true,
          requiresMedicalClearance: true,
        },
      });

      return reply.code(201).send(vinculo);
    },
  );

  app.delete(
    '/terapias/:therapyId/:contraindicationId',
    {
      schema: {
        tags: ['records'],
        summary: 'Desfaz o vinculo entre terapia e contraindicacao',
        params: vinculoParamsSchema,
        // Sem schema para 204: 204 e "sem corpo" por definicao, e declarar um
        // schema faz o Fastify exigir um payload para uma resposta que nao
        // pode ter um.
        response: {},
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const { count } = await prisma.therapyContraindication.deleteMany({
        where: {
          clinicId: sessao.clinicId,
          therapyId: request.params.therapyId,
          contraindicationId: request.params.contraindicationId,
        },
      });

      if (count === 0) {
        return reply
          .code(404)
          .send({ error: 'CONTRAINDICATION_LINK_NOT_FOUND', message: 'Vinculo nao encontrado.' });
      }

      return reply.code(204).send();
    },
  );

  done();
};
