import {
  buildPageMeta,
  idSchema,
  normalizeSearchText,
  paginate,
  professionalCreateSchema,
  professionalListQuerySchema,
  professionalListResponseSchema,
  professionalSchema,
  professionalUpdateSchema,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client.js';
import { ehConflitoUnico, limpar, mensagemConflito } from '../lib/cadastros.js';
import { prisma } from '../lib/prisma.js';

/**
 * Cadastro de profissionais. Nesta etapa o profissional nao tem login:
 * `userId` fica nulo. O vinculo profissional x terapia e substituido por
 * inteiro a cada PATCH que o envie.
 */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const paramsSchema = z.object({ id: idSchema });

const incluirTerapias = { therapies: { select: { therapyId: true } } } as const;

type ProfissionalComTerapias = Prisma.ProfessionalGetPayload<{ include: typeof incluirTerapias }>;

function resposta(professional: ProfissionalComTerapias) {
  const { therapies, ...campos } = professional;
  return { ...campos, therapyIds: therapies.map((t) => t.therapyId) };
}

/**
 * Confere que todos os ids pertencem a clinica. Sem isso, um `therapyId` de
 * outro tenant criaria um vinculo com `clinic_id` deste e `therapy_id`
 * daquele -- corrupcao de dado multi-tenant.
 */
async function terapiasValidas(clinicId: string, therapyIds: string[]): Promise<boolean> {
  if (therapyIds.length === 0) return true;
  const encontradas = await prisma.therapy.count({
    where: { clinicId, id: { in: therapyIds } },
  });
  return encontradas === new Set(therapyIds).size;
}

export const professionalRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['professionals'],
        summary: 'Lista os profissionais da clinica',
        querystring: professionalListQuerySchema,
        response: { 200: professionalListResponseSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const { page, perPage, search, includeInactive, therapyId } = request.query;

      const where = {
        clinicId: sessao.clinicId,
        ...(includeInactive ? {} : { active: true }),
        ...(search ? { searchText: { contains: normalizeSearchText(search) } } : {}),
        ...(therapyId ? { therapies: { some: { therapyId, active: true } } } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.professional.findMany({
          where,
          orderBy: { name: 'asc' },
          include: incluirTerapias,
          ...paginate({ page, perPage }),
        }),
        prisma.professional.count({ where }),
      ]);

      return reply
        .code(200)
        .send({ items: items.map(resposta), meta: buildPageMeta({ page, perPage, total }) });
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['professionals'],
        summary: 'Detalhe de um profissional',
        params: paramsSchema,
        response: { 200: professionalSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const professional = await prisma.professional.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        include: incluirTerapias,
      });

      if (!professional) {
        return reply
          .code(404)
          .send({ error: 'PROFESSIONAL_NOT_FOUND', message: 'Profissional nao encontrado.' });
      }

      return reply.code(200).send(resposta(professional));
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['professionals'],
        summary: 'Cria um profissional',
        body: professionalCreateSchema,
        response: {
          201: professionalSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
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

      if (!(await terapiasValidas(sessao.clinicId, corpo.therapyIds))) {
        return reply.code(400).send({
          error: 'INVALID_THERAPY_IDS',
          message: 'Uma ou mais terapias informadas nao pertencem a clinica.',
        });
      }

      try {
        const professional = await prisma.professional.create({
          data: {
            clinicId: sessao.clinicId,
            name: corpo.name,
            email: limpar(corpo.email) ?? null,
            phone: limpar(corpo.phone) ?? null,
            registrationNumber: limpar(corpo.registrationNumber),
            registrationType: limpar(corpo.registrationType),
            bio: limpar(corpo.bio),
            color: limpar(corpo.color),
            searchText: normalizeSearchText(corpo.name),
            defaultCommissionBasisPoints: corpo.defaultCommissionBasisPoints,
            active: corpo.active,
            therapies: {
              create: corpo.therapyIds.map((therapyId) => ({
                clinicId: sessao.clinicId,
                therapyId,
              })),
            },
          },
          include: incluirTerapias,
        });

        return reply.code(201).send(resposta(professional));
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Registro profissional'));
        }
        throw error;
      }
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['professionals'],
        summary: 'Atualiza um profissional',
        params: paramsSchema,
        body: professionalUpdateSchema,
        response: {
          200: professionalSchema,
          400: erroSchema,
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
      const { id } = request.params;

      const existente = await prisma.professional.findFirst({
        where: { id, clinicId: sessao.clinicId },
        select: { id: true },
      });

      if (!existente) {
        return reply
          .code(404)
          .send({ error: 'PROFESSIONAL_NOT_FOUND', message: 'Profissional nao encontrado.' });
      }

      if (
        corpo.therapyIds !== undefined &&
        !(await terapiasValidas(sessao.clinicId, corpo.therapyIds))
      ) {
        return reply.code(400).send({
          error: 'INVALID_THERAPY_IDS',
          message: 'Uma ou mais terapias informadas nao pertencem a clinica.',
        });
      }

      try {
        const professional = await prisma.professional.update({
          where: { id },
          data: {
            name: corpo.name,
            email: limpar(corpo.email),
            phone: limpar(corpo.phone),
            registrationNumber: limpar(corpo.registrationNumber),
            registrationType: limpar(corpo.registrationType),
            bio: limpar(corpo.bio),
            color: limpar(corpo.color),
            searchText: corpo.name === undefined ? undefined : normalizeSearchText(corpo.name),
            defaultCommissionBasisPoints: corpo.defaultCommissionBasisPoints,
            active: corpo.active,
            ...(corpo.therapyIds === undefined
              ? {}
              : {
                  therapies: {
                    deleteMany: {},
                    create: corpo.therapyIds.map((therapyId) => ({
                      clinicId: sessao.clinicId,
                      therapyId,
                    })),
                  },
                }),
          },
          include: incluirTerapias,
        });

        return reply.code(200).send(resposta(professional));
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Registro profissional'));
        }
        throw error;
      }
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['professionals'],
        summary: 'Desativa um profissional',
        description: 'Desativacao logica: sai da agenda, mas o historico de sessoes permanece.',
        params: paramsSchema,
        response: {},
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const { count } = await prisma.professional.updateMany({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        data: { active: false },
      });

      if (count === 0) {
        return reply
          .code(404)
          .send({ error: 'PROFESSIONAL_NOT_FOUND', message: 'Profissional nao encontrado.' });
      }

      return reply.code(204).send();
    },
  );

  done();
};
