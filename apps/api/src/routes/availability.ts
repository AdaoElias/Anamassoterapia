import {
  availabilityExceptionCreateSchema,
  availabilityExceptionListResponseSchema,
  availabilityExceptionQuerySchema,
  availabilityExceptionSchema,
  availabilityRuleCreateSchema,
  availabilityRuleListResponseSchema,
  availabilityRuleQuerySchema,
  availabilityRuleSchema,
  availabilityRuleUpdateSchema,
  clinicHolidayCreateSchema,
  clinicHolidayListResponseSchema,
  clinicHolidayQuerySchema,
  clinicHolidaySchema,
  idSchema,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  dataCalendario,
  ehConflitoUnico,
  mensagemConflito,
  paraDataISO,
} from '../lib/cadastros.js';
import { prisma } from '../lib/prisma.js';

/**
 * Disponibilidade: regras semanais, excecoes pontuais e feriados.
 *
 * Leitura autenticada; escrita restrita a ADMIN. Toda consulta filtra por
 * `clinicId` da sessao. As datas sao guardadas como `@db.Date` (meia-noite
 * UTC) e devolvidas como `YYYY-MM-DD`.
 */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const paramsSchema = z.object({ id: idSchema });

type Regra = {
  id: string;
  professionalId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotGranularityMinutes: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  active: boolean;
};

type Excecao = {
  id: string;
  professionalId: string;
  date: Date;
  type: 'BLOQUEIO' | 'EXTRA';
  startMinute: number | null;
  endMinute: number | null;
  reason: string | null;
  active: boolean;
};

type Feriado = { id: string; date: Date; description: string | null };

function respostaRegra(regra: Regra) {
  return {
    id: regra.id,
    professionalId: regra.professionalId,
    weekday: regra.weekday,
    startMinute: regra.startMinute,
    endMinute: regra.endMinute,
    slotGranularityMinutes: regra.slotGranularityMinutes,
    effectiveFrom: paraDataISO(regra.effectiveFrom) ?? '',
    effectiveTo: paraDataISO(regra.effectiveTo),
    active: regra.active,
  };
}

function respostaExcecao(excecao: Excecao) {
  return {
    id: excecao.id,
    professionalId: excecao.professionalId,
    date: paraDataISO(excecao.date) ?? '',
    type: excecao.type,
    startMinute: excecao.startMinute,
    endMinute: excecao.endMinute,
    reason: excecao.reason,
    active: excecao.active,
  };
}

function respostaFeriado(feriado: Feriado) {
  return {
    id: feriado.id,
    date: paraDataISO(feriado.date) ?? '',
    description: feriado.description,
  };
}

export const availabilityRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  async function profissionalDaClinica(id: string, clinicId: string): Promise<boolean> {
    const total = await prisma.professional.count({ where: { id, clinicId } });
    return total > 0;
  }

  // --- Regras semanais -------------------------------------------------

  app.get(
    '/rules',
    {
      schema: {
        tags: ['booking'],
        summary: 'Lista as regras de disponibilidade de um profissional',
        querystring: availabilityRuleQuerySchema,
        response: { 200: availabilityRuleListResponseSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const { professionalId, includeInactive } = request.query;
      if (!(await profissionalDaClinica(professionalId, sessao.clinicId))) {
        return reply
          .code(404)
          .send({ error: 'PROFESSIONAL_NOT_FOUND', message: 'Profissional nao encontrado.' });
      }

      const regras = await prisma.availabilityRule.findMany({
        where: {
          clinicId: sessao.clinicId,
          professionalId,
          ...(includeInactive ? {} : { active: true }),
        },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      });

      return reply.code(200).send({ items: regras.map(respostaRegra) });
    },
  );

  app.post(
    '/rules',
    {
      schema: {
        tags: ['booking'],
        summary: 'Cria uma regra de disponibilidade semanal',
        body: availabilityRuleCreateSchema,
        response: {
          201: availabilityRuleSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const corpo = request.body;
      if (!(await profissionalDaClinica(corpo.professionalId, sessao.clinicId))) {
        return reply
          .code(404)
          .send({ error: 'PROFESSIONAL_NOT_FOUND', message: 'Profissional nao encontrado.' });
      }

      const regra = await prisma.availabilityRule.create({
        data: {
          clinicId: sessao.clinicId,
          professionalId: corpo.professionalId,
          weekday: corpo.weekday,
          startMinute: corpo.startMinute,
          endMinute: corpo.endMinute,
          slotGranularityMinutes: corpo.slotGranularityMinutes,
          effectiveFrom: dataCalendario(corpo.effectiveFrom),
          effectiveTo:
            corpo.effectiveTo === undefined || corpo.effectiveTo === ''
              ? null
              : dataCalendario(corpo.effectiveTo),
          active: corpo.active,
        },
      });

      return reply.code(201).send(respostaRegra(regra));
    },
  );

  app.patch(
    '/rules/:id',
    {
      schema: {
        tags: ['booking'],
        summary: 'Atualiza uma regra de disponibilidade',
        params: paramsSchema,
        body: availabilityRuleUpdateSchema,
        response: {
          200: availabilityRuleSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const corpo = request.body;

      const { count } = await prisma.availabilityRule.updateMany({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        data: {
          weekday: corpo.weekday,
          startMinute: corpo.startMinute,
          endMinute: corpo.endMinute,
          slotGranularityMinutes: corpo.slotGranularityMinutes,
          effectiveFrom:
            corpo.effectiveFrom === undefined ? undefined : dataCalendario(corpo.effectiveFrom),
          effectiveTo:
            corpo.effectiveTo === undefined
              ? undefined
              : corpo.effectiveTo === ''
                ? null
                : dataCalendario(corpo.effectiveTo),
          active: corpo.active,
        },
      });

      if (count === 0) {
        return reply
          .code(404)
          .send({ error: 'AVAILABILITY_RULE_NOT_FOUND', message: 'Regra nao encontrada.' });
      }

      const regra = await prisma.availabilityRule.findUniqueOrThrow({
        where: { id: request.params.id },
      });
      return reply.code(200).send(respostaRegra(regra));
    },
  );

  app.delete(
    '/rules/:id',
    {
      schema: {
        tags: ['booking'],
        summary: 'Desativa uma regra de disponibilidade',
        params: paramsSchema,
        response: {},
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const { count } = await prisma.availabilityRule.updateMany({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        data: { active: false },
      });

      if (count === 0) {
        return reply
          .code(404)
          .send({ error: 'AVAILABILITY_RULE_NOT_FOUND', message: 'Regra nao encontrada.' });
      }

      return reply.code(204).send();
    },
  );

  // --- Excecoes --------------------------------------------------------

  app.get(
    '/exceptions',
    {
      schema: {
        tags: ['booking'],
        summary: 'Lista as excecoes de disponibilidade no periodo',
        querystring: availabilityExceptionQuerySchema,
        response: {
          200: availabilityExceptionListResponseSchema,
          401: erroSchema,
          404: erroSchema,
        },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const { professionalId, from, to } = request.query;
      if (!(await profissionalDaClinica(professionalId, sessao.clinicId))) {
        return reply
          .code(404)
          .send({ error: 'PROFESSIONAL_NOT_FOUND', message: 'Profissional nao encontrado.' });
      }

      const excecoes = await prisma.availabilityException.findMany({
        where: {
          clinicId: sessao.clinicId,
          professionalId,
          date: { gte: dataCalendario(from), lte: dataCalendario(to) },
        },
        orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
      });

      return reply.code(200).send({ items: excecoes.map(respostaExcecao) });
    },
  );

  app.post(
    '/exceptions',
    {
      schema: {
        tags: ['booking'],
        summary: 'Cria uma excecao de disponibilidade',
        body: availabilityExceptionCreateSchema,
        response: {
          201: availabilityExceptionSchema,
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

      const corpo = request.body;
      if (!(await profissionalDaClinica(corpo.professionalId, sessao.clinicId))) {
        return reply
          .code(404)
          .send({ error: 'PROFESSIONAL_NOT_FOUND', message: 'Profissional nao encontrado.' });
      }

      try {
        const excecao = await prisma.availabilityException.create({
          data: {
            clinicId: sessao.clinicId,
            professionalId: corpo.professionalId,
            date: dataCalendario(corpo.date),
            type: corpo.type,
            startMinute: corpo.startMinute ?? null,
            endMinute: corpo.endMinute ?? null,
            reason: corpo.reason ?? null,
            active: corpo.active,
          },
        });
        return reply.code(201).send(respostaExcecao(excecao));
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Excecao de disponibilidade'));
        }
        throw error;
      }
    },
  );

  app.delete(
    '/exceptions/:id',
    {
      schema: {
        tags: ['booking'],
        summary: 'Remove uma excecao de disponibilidade',
        params: paramsSchema,
        response: {},
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const { count } = await prisma.availabilityException.deleteMany({
        where: { id: request.params.id, clinicId: sessao.clinicId },
      });

      if (count === 0) {
        return reply
          .code(404)
          .send({ error: 'AVAILABILITY_EXCEPTION_NOT_FOUND', message: 'Excecao nao encontrada.' });
      }

      return reply.code(204).send();
    },
  );

  // --- Feriados --------------------------------------------------------

  app.get(
    '/holidays',
    {
      schema: {
        tags: ['booking'],
        summary: 'Lista os feriados da clinica no periodo',
        querystring: clinicHolidayQuerySchema,
        response: { 200: clinicHolidayListResponseSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const { from, to } = request.query;
      const feriados = await prisma.clinicHoliday.findMany({
        where: {
          clinicId: sessao.clinicId,
          date: { gte: dataCalendario(from), lte: dataCalendario(to) },
        },
        orderBy: { date: 'asc' },
      });

      return reply.code(200).send({ items: feriados.map(respostaFeriado) });
    },
  );

  app.post(
    '/holidays',
    {
      schema: {
        tags: ['booking'],
        summary: 'Marca um feriado da clinica',
        body: clinicHolidayCreateSchema,
        response: {
          201: clinicHolidaySchema,
          401: erroSchema,
          403: erroSchema,
          409: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const corpo = request.body;
      try {
        const feriado = await prisma.clinicHoliday.create({
          data: {
            clinicId: sessao.clinicId,
            date: dataCalendario(corpo.date),
            description: corpo.description ?? null,
          },
        });
        return reply.code(201).send(respostaFeriado(feriado));
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Feriado'));
        }
        throw error;
      }
    },
  );

  app.delete(
    '/holidays/:id',
    {
      schema: {
        tags: ['booking'],
        summary: 'Remove um feriado da clinica',
        params: paramsSchema,
        response: {},
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const { count } = await prisma.clinicHoliday.deleteMany({
        where: { id: request.params.id, clinicId: sessao.clinicId },
      });

      if (count === 0) {
        return reply
          .code(404)
          .send({ error: 'CLINIC_HOLIDAY_NOT_FOUND', message: 'Feriado nao encontrado.' });
      }

      return reply.code(204).send();
    },
  );

  done();
};
