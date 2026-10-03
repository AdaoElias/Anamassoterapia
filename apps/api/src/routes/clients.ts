import {
  buildPageMeta,
  clientCreateSchema,
  clientListQuerySchema,
  clientListResponseSchema,
  clientSchema,
  clientUpdateSchema,
  idSchema,
  normalizeSearchText,
  paginate,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client.js';
import {
  dataDeNascimento,
  ehConflitoUnico,
  limpar,
  mensagemConflito,
  paraDataISO,
} from '../lib/cadastros.js';
import { prisma } from '../lib/prisma.js';

/** Cadastro de clientes da clinica. */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const paramsSchema = z.object({ id: idSchema });

type Cliente = Prisma.ClientModel;

function resposta(client: Cliente) {
  return { ...client, birthDate: paraDataISO(client.birthDate) };
}

/** `''`/ausente -> nulo/ausente; string ISO -> `Date` no fim do dia UTC. */
function dataOuNula(value: string | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === '') return null;
  return dataDeNascimento(value);
}

export const clientRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['clients'],
        summary: 'Lista os clientes da clinica',
        querystring: clientListQuerySchema,
        response: { 200: clientListResponseSchema, 401: erroSchema },
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
        ...(search ? { searchText: { contains: normalizeSearchText(search) } } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.client.findMany({
          where,
          orderBy: { name: 'asc' },
          ...paginate({ page, perPage }),
        }),
        prisma.client.count({ where }),
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
        tags: ['clients'],
        summary: 'Detalhe de um cliente',
        params: paramsSchema,
        response: { 200: clientSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const client = await prisma.client.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
      });

      if (!client) {
        return reply
          .code(404)
          .send({ error: 'CLIENT_NOT_FOUND', message: 'Cliente nao encontrado.' });
      }

      return reply.code(200).send(resposta(client));
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['clients'],
        summary: 'Cria um cliente',
        body: clientCreateSchema,
        response: { 201: clientSchema, 401: erroSchema, 403: erroSchema, 409: erroSchema },
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
        const client = await prisma.client.create({
          data: {
            clinicId: sessao.clinicId,
            name: corpo.name,
            email: limpar(corpo.email) ?? null,
            phone: limpar(corpo.phone) ?? null,
            cpf: limpar(corpo.cpf) ?? null,
            birthDate: dataOuNula(corpo.birthDate) ?? null,
            gender: limpar(corpo.gender),
            addressLine1: limpar(corpo.addressLine1),
            addressCity: limpar(corpo.addressCity),
            addressState: limpar(corpo.addressState),
            addressZip: limpar(corpo.addressZip),
            notes: limpar(corpo.notes),
            searchText: normalizeSearchText(corpo.name),
            marketingOptIn: corpo.marketingOptIn,
            active: corpo.active,
          },
        });

        return reply.code(201).send(resposta(client));
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('CPF'));
        }
        throw error;
      }
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['clients'],
        summary: 'Atualiza um cliente',
        params: paramsSchema,
        body: clientUpdateSchema,
        response: {
          200: clientSchema,
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

      try {
        const { count } = await prisma.client.updateMany({
          where: { id, clinicId: sessao.clinicId },
          data: {
            name: corpo.name,
            email: limpar(corpo.email),
            phone: limpar(corpo.phone),
            cpf: limpar(corpo.cpf),
            birthDate: dataOuNula(corpo.birthDate),
            gender: limpar(corpo.gender),
            addressLine1: limpar(corpo.addressLine1),
            addressCity: limpar(corpo.addressCity),
            addressState: limpar(corpo.addressState),
            addressZip: limpar(corpo.addressZip),
            notes: limpar(corpo.notes),
            searchText: corpo.name === undefined ? undefined : normalizeSearchText(corpo.name),
            marketingOptIn: corpo.marketingOptIn,
            active: corpo.active,
          },
        });

        if (count === 0) {
          return reply
            .code(404)
            .send({ error: 'CLIENT_NOT_FOUND', message: 'Cliente nao encontrado.' });
        }

        const client = await prisma.client.findUniqueOrThrow({ where: { id } });
        return reply.code(200).send(resposta(client));
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('CPF'));
        }
        throw error;
      }
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['clients'],
        summary: 'Desativa um cliente',
        description:
          'Desativacao logica. O cliente sai das listas, mas prontuario e financeiro permanecem.',
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

      const { count } = await prisma.client.updateMany({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        data: { active: false },
      });

      if (count === 0) {
        return reply
          .code(404)
          .send({ error: 'CLIENT_NOT_FOUND', message: 'Cliente nao encontrado.' });
      }

      return reply.code(204).send();
    },
  );

  done();
};
