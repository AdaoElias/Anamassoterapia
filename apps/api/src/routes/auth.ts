import { createHash, randomBytes } from 'node:crypto';

import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { env } from '../config/env.js';
import { parseTtlToSeconds } from '../lib/jwt.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { emitirRefreshToken, rotacionarRefreshToken } from '../lib/refresh-tokens.js';
import type { SessaoAutenticada } from '../plugins/auth.js';

/**
 * `/auth`: login, refresh, logout, sessao atual, recuperacao e redefinicao de
 * senha.
 *
 * Tres regras valem para o arquivo inteiro:
 *
 * 1. **Login nao diz se o e-mail existe.** Senha errada e e-mail
 *    inexistente respondem o mesmo corpo, no mesmo tempo. Sem isso a rota vira
 *    enumerador de contas -- e quem assina newsletter de clinica esta na
 *    lista.
 *
 * 2. **Recuperacao de senha nao confirma se o e-mail existe.** O token so e
 *    criado para conta real, mas a resposta e sempre a mesma.
 *
 * 3. **Conta desativada e revelada so depois da senha certa.** Antes disso a
 *    resposta e a generica; depois, o bloqueio pode ser explicito, porque
 *    quem chegou la ja provou ser o dono da conta.
 *
 * O `NOTIFIER_DRIVER=log` imprime o link de redefinicao no log em vez de
 * enviar e-mail. E o que permite testar o fluxo inteiro sem servidor de
 * e-mail.
 */

const CREDENCIAL_INVALIDA = {
  error: 'INVALID_CREDENTIALS',
  message: 'E-mail ou senha invalidos.',
} as const;

const SESSAO_EXPIRADA = {
  error: 'INVALID_REFRESH_TOKEN',
  message: 'Sessao expirada. Faca login novamente.',
} as const;

const roleSchema = z.enum(['ADMIN', 'PROFISSIONAL', 'CLIENTE']);

/**
 * Normaliza **antes** de validar o formato.
 *
 * `z.email().toLowerCase().trim()` valida o valor cru: em
 * `" Fulano@Exemplo.COM "` o check de formato roda primeiro, reprova por causa
 * dos espacos, e o `.trim()` nunca chega a ser aplicado. O usuario que digita
 * o e-mail certo, so com espaco em volta, receberia "e-mail invalido".
 * A ordem correta e normalizar, e so entao validar o formato.
 */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'E-mail muito longo')
  .pipe(z.email('Informe um e-mail valido'));

const loginBodySchema = z.object({
  email: emailSchema,
  senha: z.string().min(1, 'Informe a senha').max(200),
  /**
   * Clinica desejada. Opcional porque a maioria dos profissionais tem uma
   * so. Havendo varias, o login devolve a lista e o cliente escolhe: o
   * backend nunca decide sozinho, porque cair na clinica errada significa
   * servir dado de outro profissional para alguem autenticado.
   */
  clinicId: z.uuid('clinicId invalido').optional(),
});

const clinicaResumoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  role: roleSchema,
});

const perfilSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.email(),
  role: roleSchema,
  clinicId: z.string(),
  clinicName: z.string(),
  /** `professionals.id` quando o usuario e profissional; `null` caso contrario. */
  professionalId: z.string().nullable(),
});

/**
 * Resposta de login e uma uniao discriminada por `status`. O caso
 * `escolha_de_clinica` nao e erro: e um login legitimo que precisa de mais
 * uma informacao. Modelar como 4xx faria o cliente tratar sucesso como
 * falha e o usuario nunca entraria.
 */
const loginResponseSchema = z.union([
  z.object({
    status: z.literal('autenticado'),
    accessToken: z.string(),
    expiresInSeconds: z.number(),
    perfil: perfilSchema,
  }),
  z.object({
    status: z.literal('escolha_de_clinica'),
    clinicas: z.array(clinicaResumoSchema),
  }),
]);

const refreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresInSeconds: z.number(),
});

const emailBodySchema = z.object({
  email: emailSchema,
});

const resetBodySchema = z.object({
  token: z.string().min(1, 'Token ausente'),
  senha: z.string().min(8, 'A senha precisa de ao menos 8 caracteres').max(200),
});

const mensagemSchema = z.object({
  message: z.string(),
});

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const ACCESS_TTL_SECONDS = parseTtlToSeconds(env.JWT_ACCESS_TTL);

const RESET_TTL_MS = 60 * 60 * 1000;

function hashOpaco(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Consome CPU comparavel ao de uma verificacao Argon2 real.
 *
 * Sem isso, "e-mail inexistente" responde em 2ms e "senha errada" em 80ms.
 * A diferenca basta para enumerar contas por tempo, sem nenhum ataque de
 * fora. O hash cego e gerado uma vez e reaproveitado: o custo e de um
 * Argon2 por processo, nao por tentativa.
 */
let hashCego: Promise<string> | undefined;

function queimarCiclos(senha: string): Promise<boolean> {
  hashCego ??= hashPassword(randomBytes(32).toString('hex'));
  return hashCego.then((hash) => verifyPassword(hash, senha));
}

export interface AuthOptions {
  /**
   * Substitui a verificacao de senha. Existe para os testes de rota nao
   * pagarem Argon2 em cada caso -- 19MiB por verificacao -- e para nenhum
   * log de teste carregar senha em claro.
   */
  verificarSenha?: (hashGuardado: string, senha: string) => Promise<boolean>;
}

export const authRoutes: FastifyPluginCallbackZod<AuthOptions> = (app, options, done) => {
  const verificar = options.verificarSenha ?? verifyPassword;

  app.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Entra com e-mail e senha',
        description:
          '200 com `status: autenticado`, ou `status: escolha_de_clinica` quando o ' +
          'usuario tem mais de uma clinica e nao informou `clinicId`.',
        body: loginBodySchema,
        response: { 200: loginResponseSchema, 401: erroSchema, 403: erroSchema },
      },
      // Login e o alvo obvio de forca bruta: 5 tentativas por minuto e por IP,
      // bem mais apertado que o limite global de 300.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { email, senha, clinicId } = request.body;

      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          memberships: { where: { active: true }, include: { clinic: true } },
          professionalOf: { select: { id: true } },
        },
      });

      if (!user) {
        // Mesmo custo de um Argon2 real, depois o mesmo 401.
        await queimarCiclos(senha);
        return reply.code(401).send(CREDENCIAL_INVALIDA);
      }

      if (!(await verificar(user.passwordHash, senha))) {
        return reply.code(401).send(CREDENCIAL_INVALIDA);
      }

      if (!user.active) {
        return reply.code(403).send({
          error: 'ACCOUNT_INACTIVE',
          message: 'Conta desativada. Fale com a administracao da clinica.',
        });
      }

      if (user.memberships.length === 0) {
        // Credencial certa sem nenhum acesso: cadastro orfao. Aqui a
        // mensagem pode ser especifica, a senha ja foi provada.
        return reply.code(403).send({
          error: 'NO_CLINIC_ACCESS',
          message: 'Seu usuario nao esta vinculado a nenhuma clinica.',
        });
      }

      if (clinicId === undefined && user.memberships.length > 1) {
        return reply.code(200).send({
          status: 'escolha_de_clinica',
          clinicas: user.memberships.map((m) => ({
            id: m.clinicId,
            nome: m.clinic.name,
            role: m.role,
          })),
        });
      }

      const membership =
        clinicId === undefined
          ? user.memberships[0]
          : user.memberships.find((m) => m.clinicId === clinicId);

      if (!membership) {
        // `clinicId` valido mas o usuario nao e membro: 403, e nao 404. O
        // recurso existe, o acesso que nao existe -- e 404 aqui esconderia da
        // clinica legitima que o id dela e valido.
        return reply.code(403).send({
          error: 'CLINIC_FORBIDDEN',
          message: 'Voce nao tem acesso a esta clinica.',
        });
      }

      const refresh = await emitirRefreshToken(prisma, {
        userId: user.id,
        membershipId: membership.id,
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });

      const sessao: SessaoAutenticada = {
        userId: user.id,
        clinicId: membership.clinicId,
        membershipId: membership.id,
        role: membership.role,
        epoch: user.tokenEpoch,
      };

      app.definirCookieRefresh(reply, refresh.token);

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      return reply.code(200).send({
        status: 'autenticado',
        accessToken: app.emitirAccessToken(sessao),
        expiresInSeconds: ACCESS_TTL_SECONDS,
        perfil: {
          userId: user.id,
          name: user.name,
          email: user.email,
          role: membership.role,
          clinicId: membership.clinicId,
          clinicName: membership.clinic.name,
          professionalId: user.professionalOf[0]?.id ?? null,
        },
      });
    },
  );

  app.post(
    '/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Troca o refresh do cookie por um novo access token',
        description:
          'O refresh apresentado e revogado e um novo par e emitido. Apresentar um ' +
          'token ja usado revoga a familia inteira: uso concorrente legitimo e ' +
          'token roubado ficam indistinguiveis, e a resposta certa para os dois ' +
          'e derrubar a sessao.',
        response: { 200: refreshResponseSchema, 401: erroSchema },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const cookie = request.cookies['mt_refresh'];

      if (!cookie) {
        return reply.code(401).send({
          error: 'NO_REFRESH_TOKEN',
          message: 'Sessao expirada. Faca login novamente.',
        });
      }

      const resultado = await rotacionarRefreshToken(prisma, cookie);

      // Falhou: limpa o cookie. Um refresh que nao rotaciona continua sendo
      // enviado em toda requisicao, e o cliente levaria 401 para sempre em
      // vez de cair no login.
      if (!resultado.ok) {
        app.limparCookieRefresh(reply);

        if (resultado.motivo === 'REUSO') {
          app.log.warn(
            { ip: request.ip, agent: request.headers['user-agent'] },
            'refresh token reutilizado: familia inteira revogada',
          );
        }

        return reply.code(401).send(SESSAO_EXPIRADA);
      }

      const registro = resultado.emitido.registro;

      const user = await prisma.user.findUnique({
        where: { id: registro.userId },
        include: {
          memberships: { where: { active: true }, include: { clinic: true } },
        },
      });

      const membership =
        user?.memberships.find((m) => m.id === registro.membershipId) ??
        // Token emitido antes da coluna `membership_id`: unica membership
        // ativa do usuario e a unica leitura defensavel.
        (registro.membershipId === null && user?.memberships.length === 1
          ? user.memberships[0]
          : undefined);

      if (!user || !membership || !user.active) {
        app.limparCookieRefresh(reply);
        return reply.code(401).send(SESSAO_EXPIRADA);
      }

      // A invalidacao global de sessao tem duas metades independentes:
      // a troca de senha mata os refresh (em `/redefinir-senha`), e o
      // `epoch` do token mata os access tokens ja emitidos, que nao tem
      // como ser revogados de outro modo. Aqui so precisa vir um token
      // novo; a comparacao acontece em `/me`.
      app.definirCookieRefresh(reply, resultado.emitido.token);

      return reply.code(200).send({
        accessToken: app.emitirAccessToken({
          userId: user.id,
          clinicId: membership.clinicId,
          membershipId: membership.id,
          role: membership.role,
          epoch: user.tokenEpoch,
        }),
        expiresInSeconds: ACCESS_TTL_SECONDS,
      });
    },
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Encerra a sessao atual',
        description: 'Revoga a familia do refresh apresentado e limpa o cookie. Idempotente.',
        // Sem schema para 204: 204 e "sem corpo" por definicao, e declarar um
        // schema faz o Fastify exigir um payload para uma resposta que nao
        // pode ter um.
        response: {},
      },
    },
    async (request, reply) => {
      const cookie = request.cookies['mt_refresh'];

      if (cookie) {
        const registro = await prisma.refreshToken.findUnique({
          where: { tokenHash: hashOpaco(cookie) },
        });

        if (registro) {
          await prisma.refreshToken.updateMany({
            where: { familyId: registro.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }

      app.limparCookieRefresh(reply);
      return reply.code(204).send();
    },
  );

  app.get(
    '/me',
    {
      schema: {
        tags: ['auth'],
        summary: 'Sessao do usuario autenticado',
        response: { 200: perfilSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;

      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const user = await prisma.user.findUnique({
        where: { id: sessao.userId },
        include: {
          memberships: { where: { id: sessao.membershipId }, include: { clinic: true } },
          professionalOf: { select: { id: true } },
        },
      });

      const membership = user?.memberships[0];

      if (!user || !membership) {
        // Access token valido apontando para membership que saiu: credencial
        // de quem foi removido da clinica enquanto o token vivia.
        return reply.code(401).send({
          error: 'UNAUTHENTICATED',
          message: 'Sessao expirada. Faca login novamente.',
        });
      }

      // O `epoch` do token contra o do banco. Trocar a senha incrementa o
      // contador, e todo access token emitido antes passa a ser recusado
      // aqui -- sem revogacao, porque JWT nao tem lista de bloqueio. Esta e
      // a unica rota que confere, pelo custo: exigiria uma consulta ao banco
      // em toda requisicao so para um token que ja expirou em 15 minutos.
      if (sessao.epoch !== user.tokenEpoch) {
        return reply.code(401).send({
          error: 'TOKEN_SUPERSEDED',
          message: 'Sessao invalida por troca de senha. Faca login novamente.',
        });
      }

      return reply.code(200).send({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: membership.role,
        clinicId: membership.clinicId,
        clinicName: membership.clinic.name,
        professionalId: user.professionalOf[0]?.id ?? null,
      });
    },
  );

  app.post(
    '/recuperar-senha',
    {
      schema: {
        tags: ['auth'],
        summary: 'Pede o link de redefinicao de senha',
        description: 'Resposta sempre 202, exista a conta ou nao.',
        body: emailBodySchema,
        response: { 202: mensagemSchema },
      },
      // Cada pedido pode virar um e-mail. Sem limite, a rota serve de
      // ferramenta de spam contra o dominio da clinica.
      config: { rateLimit: { max: 3, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const { email } = request.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (user?.active) {
        const token = randomBytes(32).toString('base64url');

        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashOpaco(token),
            expiresAt: new Date(Date.now() + RESET_TTL_MS),
          },
        });

        if (env.NOTIFIER_DRIVER === 'log') {
          app.log.warn(
            { link: `${env.WEB_PUBLIC_URL}/redefinir-senha?token=${token}` },
            'NOTIFIER_DRIVER=log: link de redefinicao gerado (token em claro no log)',
          );
        }
      }

      return reply.code(202).send({
        message: 'Se o e-mail existir, o link de redefinicao foi enviado.',
      });
    },
  );

  app.post(
    '/redefinir-senha',
    {
      schema: {
        tags: ['auth'],
        summary: 'Troca a senha usando o token do link',
        body: resetBodySchema,
        response: { 200: mensagemSchema, 400: erroSchema },
      },
      config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const { token, senha } = request.body;

      const registro = await prisma.passwordResetToken.findUnique({
        where: { tokenHash: hashOpaco(token) },
      });

      if (!registro || registro.usedAt !== null || registro.expiresAt.getTime() <= Date.now()) {
        return reply.code(400).send({
          error: 'INVALID_RESET_TOKEN',
          message: 'Link invalido ou expirado. Peca um novo.',
        });
      }

      const passwordHash = await hashPassword(senha);

      const trocou = await prisma.$transaction(async (tx) => {
        // Token de uso unico, garantido por CAS: `used_at IS NULL` faz o
        // link aceitar uma troca so. Com `update` por id, o link clicado
        // duas vezes (ou o formulario reenviado) marcava as duas vezes e a
        // segunda troca de senha passava direto.
        const { count } = await tx.passwordResetToken.updateMany({
          where: { id: registro.id, usedAt: null },
          data: { usedAt: new Date() },
        });

        if (count !== 1) {
          return false;
        }

        await tx.user.update({
          where: { id: registro.userId },
          data: {
            passwordHash,
            // Derruba toda sessao existente: quem tinha a senha antiga nao
            // pode continuar logado depois da troca.
            tokenEpoch: { increment: 1 },
          },
        });

        // Revogacao na mesma transacao: ou a senha muda com as sessoes
        // derrubadas, ou nada muda. Revogar depois deixaria a janela em que
        // a senha nova esta valida e as sessoes antigas ainda valem.
        await tx.refreshToken.updateMany({
          where: { userId: registro.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        return true;
      });

      if (!trocou) {
        return reply.code(400).send({
          error: 'INVALID_RESET_TOKEN',
          message: 'Link invalido ou expirado. Peca um novo.',
        });
      }

      app.limparCookieRefresh(reply);

      return reply.code(200).send({
        message: 'Senha redefinida. Faca login com a nova senha.',
      });
    },
  );

  done();
};
