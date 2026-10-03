import {
  buildPageMeta,
  idSchema,
  paginate,
  slugify,
  therapyCreateSchema,
  therapyListQuerySchema,
  therapyListResponseSchema,
  therapySchema,
  therapyUpdateSchema,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { ehConflitoUnico, limpar, mensagemConflito } from '../lib/cadastros.js';
import { prisma } from '../lib/prisma.js';

/** Cardapio de terapias da clinica. Leitura autenticada, escrita por ADMIN. */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const paramsSchema = z.object({ id: idSchema });

export const therapyRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['therapies'],
        summary: 'Lista as terapias da clinica',
        querystring: therapyListQuerySchema,
        response: { 200: therapyListResponseSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const { page, perPage, search, includeInactive } = request.query;

      const where = {
        clinicId: sessao.clinicId,
        ...(includeInactive ? {} : { active: true }),
        ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.therapy.findMany({
          where,
          orderBy: [{ position: 'asc' }, { name: 'asc' }],
          ...paginate({ page, perPage }),
        }),
        prisma.therapy.count({ where }),
      ]);

      return reply.code(200).send({ items, meta: buildPageMeta({ page, perPage, total }) });
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['therapies'],
        summary: 'Detalhe de uma terapia',
        params: paramsSchema,
        response: { 200: therapySchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const therapy = await prisma.therapy.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
      });

      if (!therapy) {
        return reply
          .code(404)
          .send({ error: 'THERAPY_NOT_FOUND', message: 'Terapia nao encontrada.' });
      }

      return reply.code(200).send(therapy);
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['therapies'],
        summary: 'Cria uma terapia',
        body: therapyCreateSchema,
        response: { 201: therapySchema, 401: erroSchema, 403: erroSchema, 409: erroSchema },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const corpo = request.body;

      try {
        const therapy = await prisma.therapy.create({
          data: {
            clinicId: sessao.clinicId,
            name: corpo.name,
            // Slug ausente e derivado do nome. Editar o nome depois NAO
            // reescreve o slug: link publico ja divulgado nao pode morrer.
            slug: corpo.slug ?? slugify(corpo.name),
            description: limpar(corpo.description),
            category: limpar(corpo.category),
            durationMinutes: corpo.durationMinutes,
            bufferMinutes: corpo.bufferMinutes,
            priceCents: corpo.priceCents,
            color: limpar(corpo.color),
            imageUrl: limpar(corpo.imageUrl),
            requiresAnamnesis: corpo.requiresAnamnesis,
            requiresMedicalClearance: corpo.requiresMedicalClearance,
            minNoticeMinutes: corpo.minNoticeMinutes,
            minAge: corpo.minAge ?? null,
            maxAge: corpo.maxAge ?? null,
            position: corpo.position,
            active: corpo.active,
          },
        });

        return reply.code(201).send(therapy);
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Slug de terapia'));
        }
        throw error;
      }
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['therapies'],
        summary: 'Atualiza uma terapia',
        params: paramsSchema,
        body: therapyUpdateSchema,
        response: {
          200: therapySchema,
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

      try {
        const { count } = await prisma.therapy.updateMany({
          where: { id: request.params.id, clinicId: sessao.clinicId },
          data: {
            name: corpo.name,
            slug: corpo.slug,
            description: limpar(corpo.description),
            category: limpar(corpo.category),
            durationMinutes: corpo.durationMinutes,
            bufferMinutes: corpo.bufferMinutes,
            priceCents: corpo.priceCents,
            color: limpar(corpo.color),
            imageUrl: limpar(corpo.imageUrl),
            requiresAnamnesis: corpo.requiresAnamnesis,
            requiresMedicalClearance: corpo.requiresMedicalClearance,
            minNoticeMinutes: corpo.minNoticeMinutes,
            minAge: corpo.minAge,
            maxAge: corpo.maxAge,
            position: corpo.position,
            active: corpo.active,
          },
        });

        if (count === 0) {
          return reply
            .code(404)
            .send({ error: 'THERAPY_NOT_FOUND', message: 'Terapia nao encontrada.' });
        }

        const therapy = await prisma.therapy.findUniqueOrThrow({
          where: { id: request.params.id },
        });
        return reply.code(200).send(therapy);
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Slug de terapia'));
        }
        throw error;
      }
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['therapies'],
        summary: 'Desativa uma terapia',
        description:
          'Desativacao logica. A terapia sai do cardapio, mas sessoes ja agendadas seguem validas.',
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

      const { count } = await prisma.therapy.updateMany({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        data: { active: false },
      });

      if (count === 0) {
        return reply
          .code(404)
          .send({ error: 'THERAPY_NOT_FOUND', message: 'Terapia nao encontrada.' });
      }

      return reply.code(204).send();
    },
  );

  done();
};
