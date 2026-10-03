import {
  buildPageMeta,
  clinicSchema,
  clinicUpdateSchema,
  idSchema,
  paginate,
  roomCreateSchema,
  roomListQuerySchema,
  roomListResponseSchema,
  roomSchema,
  roomUpdateSchema,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { ehConflitoUnico, limpar, mensagemConflito } from '../lib/cadastros.js';
import { prisma } from '../lib/prisma.js';

/**
 * Perfil da clinica da sessao e suas salas.
 *
 * A leitura aceita qualquer papel autenticado (a agenda precisa saber o
 * fuso e as salas); a escrita e restrita a ADMIN. Nao existe criar clinica
 * aqui: o tenant nasce no seed e o onboarding fica para outra etapa.
 */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const paramsSchema = z.object({ id: idSchema });

export const clinicRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/current',
    {
      schema: {
        tags: ['clinic'],
        summary: 'Perfil da clinica da sessao',
        response: { 200: clinicSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const clinic = await prisma.clinic.findUnique({ where: { id: sessao.clinicId } });

      if (!clinic) {
        return reply
          .code(404)
          .send({ error: 'CLINIC_NOT_FOUND', message: 'Clinica nao encontrada.' });
      }

      return reply.code(200).send(clinic);
    },
  );

  app.patch(
    '/current',
    {
      schema: {
        tags: ['clinic'],
        summary: 'Atualiza o perfil da clinica',
        body: clinicUpdateSchema,
        response: { 200: clinicSchema, 401: erroSchema, 403: erroSchema, 404: erroSchema },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const corpo = request.body;

      const clinic = await prisma.clinic.update({
        where: { id: sessao.clinicId },
        data: {
          name: corpo.name,
          legalName: limpar(corpo.legalName),
          cnpj: limpar(corpo.cnpj),
          email: limpar(corpo.email),
          phone: limpar(corpo.phone),
          timezone: corpo.timezone,
          addressLine1: limpar(corpo.addressLine1),
          addressLine2: limpar(corpo.addressLine2),
          addressCity: limpar(corpo.addressCity),
          addressState: limpar(corpo.addressState),
          addressZip: limpar(corpo.addressZip),
          bookingTerms: limpar(corpo.bookingTerms),
        },
      });

      return reply.code(200).send(clinic);
    },
  );

  app.get(
    '/current/rooms',
    {
      schema: {
        tags: ['clinic'],
        summary: 'Lista as salas da clinica',
        querystring: roomListQuerySchema,
        response: { 200: roomListResponseSchema, 401: erroSchema },
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
        prisma.room.findMany({
          where,
          orderBy: { name: 'asc' },
          ...paginate({ page, perPage }),
        }),
        prisma.room.count({ where }),
      ]);

      return reply.code(200).send({ items, meta: buildPageMeta({ page, perPage, total }) });
    },
  );

  app.post(
    '/current/rooms',
    {
      schema: {
        tags: ['clinic'],
        summary: 'Cria uma sala',
        body: roomCreateSchema,
        response: { 201: roomSchema, 401: erroSchema, 403: erroSchema, 409: erroSchema },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      try {
        const room = await prisma.room.create({
          data: { clinicId: sessao.clinicId, name: request.body.name },
        });
        return reply.code(201).send(room);
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Sala'));
        }
        throw error;
      }
    },
  );

  app.patch(
    '/current/rooms/:id',
    {
      schema: {
        tags: ['clinic'],
        summary: 'Atualiza uma sala',
        params: paramsSchema,
        body: roomUpdateSchema,
        response: {
          200: roomSchema,
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

      try {
        const { count } = await prisma.room.updateMany({
          where: { id: request.params.id, clinicId: sessao.clinicId },
          data: request.body,
        });

        if (count === 0) {
          return reply.code(404).send({ error: 'ROOM_NOT_FOUND', message: 'Sala nao encontrada.' });
        }

        const room = await prisma.room.findUniqueOrThrow({ where: { id: request.params.id } });
        return reply.code(200).send(room);
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Nome de sala'));
        }
        throw error;
      }
    },
  );

  app.delete(
    '/current/rooms/:id',
    {
      schema: {
        tags: ['clinic'],
        summary: 'Desativa uma sala',
        description: 'Desativacao logica: a sala sai da agenda mas o historico permanece.',
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

      const { count } = await prisma.room.updateMany({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        data: { active: false },
      });

      if (count === 0) {
        return reply.code(404).send({ error: 'ROOM_NOT_FOUND', message: 'Sala nao encontrada.' });
      }

      return reply.code(204).send();
    },
  );

  done();
};
