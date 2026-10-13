import { createHash, randomBytes } from 'node:crypto';

import {
  buildPageMeta,
  idSchema,
  membershipInviteResponseSchema,
  membershipInviteSchema,
  membershipListQuerySchema,
  membershipListResponseSchema,
  membershipSchema,
  membershipUpdateSchema,
  paginate,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { env } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ehConflitoUnico, limpar, mensagemConflito } from '../lib/cadastros.js';
import { hashPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';

/**
 * Gestao de usuarios e papeis da clinica (secao 5.2).
 *
 * Todas as rotas sao `ADMIN`. A autoria de quem convida/desativa nao e gravada
 * numa coluna propria porque ja esta no `audit_log` generico -- o que importa
 * aqui e o estado da membership.
 *
 * O convite reusa `PasswordResetToken`: o `User` nasce com um hash de senha
 * aleatoria (ninguem sabe a senha) e recebe um token para definir a propria.
 * Nenhuma senha em claro trafega por e-mail, e nao ha tabela nova.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const paramsSchema = z.object({ id: idSchema });

/** Mesmo hash opaco do reset de senha (`auth.ts`): so o hash vai ao banco. */
function hashOpaco(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const selecaoMembro = {
  id: true,
  role: true,
  jobTitle: true,
  active: true,
  createdAt: true,
  user: {
    select: { id: true, name: true, email: true, phone: true, lastLoginAt: true },
  },
} as const;

type MembroComUsuario = Prisma.ClinicMembershipGetPayload<{ select: typeof selecaoMembro }>;

function resposta(membro: MembroComUsuario) {
  return {
    id: membro.id,
    userId: membro.user.id,
    name: membro.user.name,
    email: membro.user.email,
    phone: membro.user.phone,
    role: membro.role,
    jobTitle: membro.jobTitle,
    active: membro.active,
    lastLoginAt: membro.user.lastLoginAt === null ? null : membro.user.lastLoginAt.toISOString(),
    createdAt: membro.createdAt.toISOString(),
  };
}

/**
 * A clinica nao pode ficar sem administrador ativo: sem isso, o unico ADMIN
 * se rebaixa ou se desativa e ninguem mais entra para reverter -- nem o dono.
 * A checagem conta os *outros* admins ativos, para nao bloquear a edicao de um
 * admin enquanto ha um segundo.
 */
async function ehUltimoAdmin(clinicId: string, membroId: string): Promise<boolean> {
  const outros = await prisma.clinicMembership.count({
    where: { clinicId, role: 'ADMIN', active: true, id: { not: membroId } },
  });
  return outros === 0;
}

/** Derruba as sessoes abertas pela membership: papel/atividade mudou. */
async function revogarSessoesDaMembership(membershipId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { membershipId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export const userRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['users'],
        summary: 'Lista os usuarios da clinica',
        querystring: membershipListQuerySchema,
        response: { 200: membershipListResponseSchema, 401: erroSchema, 403: erroSchema },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const { page, perPage, search, includeInactive } = request.query;

      const where: Prisma.ClinicMembershipWhereInput = {
        clinicId: sessao.clinicId,
        ...(includeInactive ? {} : { active: true }),
        ...(search
          ? {
              user: {
                is: {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        prisma.clinicMembership.findMany({
          where,
          orderBy: { user: { name: 'asc' } },
          select: selecaoMembro,
          ...paginate({ page, perPage }),
        }),
        prisma.clinicMembership.count({ where }),
      ]);

      return reply
        .code(200)
        .send({ items: items.map(resposta), meta: buildPageMeta({ page, perPage, total }) });
    },
  );

  app.post(
    '/invites',
    {
      schema: {
        tags: ['users'],
        summary: 'Convida um usuario para a clinica',
        description:
          'Cria a pessoa (se ainda nao existir) e a membership, e emite um link para ela ' +
          'definir a propria senha. Reenviar para um e-mail ja convidado responde 409.',
        body: membershipInviteSchema,
        response: {
          201: membershipInviteResponseSchema,
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

      // O hash da senha aleatoria e pago antes da transacao: manter o
      // Argon2 (~80ms) fora dela encurta o tempo com a conexao travada.
      const senhaAleatoria = await hashPassword(randomBytes(32).toString('base64url'));
      const token = randomBytes(32).toString('base64url');

      let membershipId: string;
      try {
        membershipId = await prisma.$transaction(async (tx) => {
          const existente = await tx.user.findUnique({
            where: { email: corpo.email },
            select: { id: true },
          });

          const usuario =
            existente ??
            (await tx.user.create({
              data: { email: corpo.email, passwordHash: senhaAleatoria, name: corpo.name },
              select: { id: true },
            }));

          const membro = await tx.clinicMembership.create({
            data: {
              clinicId: sessao.clinicId,
              userId: usuario.id,
              role: corpo.role,
              jobTitle: limpar(corpo.jobTitle) ?? null,
            },
            select: { id: true },
          });

          await tx.passwordResetToken.create({
            data: {
              userId: usuario.id,
              tokenHash: hashOpaco(token),
              expiresAt: new Date(Date.now() + INVITE_TTL_MS),
            },
          });

          return membro.id;
        });
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Usuario'));
        }
        throw error;
      }

      const membro = await prisma.clinicMembership.findUniqueOrThrow({
        where: { id: membershipId },
        select: selecaoMembro,
      });

      const link = `${env.WEB_PUBLIC_URL}/redefinir-senha?token=${token}`;
      // Sem servidor de e-mail configurado, o link so existe no log e na
      // resposta. Em producao com e-mail ligado, o token vai pela caixa da
      // pessoa e nunca pela resposta HTTP.
      const inviteLink = env.NOTIFIER_DRIVER === 'log' ? link : null;
      if (inviteLink === null) {
        app.log.warn(
          { email: corpo.email },
          'convite criado, mas o envio de e-mail ainda nao esta implementado',
        );
      } else {
        app.log.warn({ link }, 'convite: link de definicao de senha gerado (NOTIFIER_DRIVER=log)');
      }

      return reply.code(201).send({ membership: resposta(membro), inviteLink });
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['users'],
        summary: 'Atualiza papel, funcao ou atividade de um usuario',
        params: paramsSchema,
        body: membershipUpdateSchema,
        response: {
          200: membershipSchema,
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

      const atual = await prisma.clinicMembership.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        select: { id: true, role: true, active: true },
      });

      if (!atual) {
        return reply
          .code(404)
          .send({ error: 'MEMBERSHIP_NOT_FOUND', message: 'Usuario nao encontrado.' });
      }

      const corpo = request.body;
      const novoRole = corpo.role ?? atual.role;
      const novoAtivo = corpo.active ?? atual.active;
      const deixaDeSerAdminAtivo =
        atual.role === 'ADMIN' && atual.active && (novoRole !== 'ADMIN' || !novoAtivo);

      if (deixaDeSerAdminAtivo && (await ehUltimoAdmin(sessao.clinicId, atual.id))) {
        return reply.code(409).send({
          error: 'LAST_ADMIN',
          message: 'A clinica precisa de ao menos um administrador ativo.',
        });
      }

      try {
        await prisma.clinicMembership.updateMany({
          where: { id: atual.id, clinicId: sessao.clinicId },
          data: {
            role: corpo.role,
            active: corpo.active,
            jobTitle: limpar(corpo.jobTitle),
          },
        });
      } catch (error) {
        if (ehConflitoUnico(error)) {
          return reply.code(409).send(mensagemConflito('Papel'));
        }
        throw error;
      }

      // Mudou papel ou foi desativado: as sessoes abertas carregam o papel
      // antigo no access token. Revogar o refresh forca o proximo refresh a
      // falhar e a pessoa a entrar de novo, ja com o estado novo.
      if (corpo.role !== undefined || corpo.active === false) {
        await revogarSessoesDaMembership(atual.id);
      }

      const membro = await prisma.clinicMembership.findUniqueOrThrow({
        where: { id: atual.id },
        select: selecaoMembro,
      });

      return reply.code(200).send(resposta(membro));
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['users'],
        summary: 'Desativa o acesso de um usuario a clinica',
        description: 'Desativacao logica da membership: o usuario e o historico permanecem.',
        params: paramsSchema,
        // Sem schema para 204: 204 e "sem corpo" por definicao; declarar um
        // faria o Fastify exigir payload numa resposta que nao pode ter.
        response: {},
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const atual = await prisma.clinicMembership.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        select: { id: true, role: true, active: true },
      });

      if (!atual) {
        return reply
          .code(404)
          .send({ error: 'MEMBERSHIP_NOT_FOUND', message: 'Usuario nao encontrado.' });
      }

      if (
        atual.role === 'ADMIN' &&
        atual.active &&
        (await ehUltimoAdmin(sessao.clinicId, atual.id))
      ) {
        return reply.code(409).send({
          error: 'LAST_ADMIN',
          message: 'A clinica precisa de ao menos um administrador ativo.',
        });
      }

      await prisma.clinicMembership.updateMany({
        where: { id: atual.id, clinicId: sessao.clinicId },
        data: { active: false },
      });
      await revogarSessoesDaMembership(atual.id);

      return reply.code(204).send();
    },
  );

  done();
};
