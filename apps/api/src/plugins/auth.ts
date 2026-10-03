import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../config/env.js';
import type { Role } from '../generated/prisma/enums.js';
import { JwtError, parseTtlToSeconds, signAccessToken, verifyAccessToken } from '../lib/jwt.js';

/**
 * Autenticacao e autorizacao.
 *
 * Funcao de registro, e nao plugin encapsulado: `fastify-plugin` nao esta no
 * catalogo, e nao ha motivo para adicionar uma dependencia so para furar o
 * escopo -- `buildApp` chama isto direto na raiz, entao as decoracoes
 * valem para todas as rotas.
 *
 * O plugin nao guarda estado: ele le o access token do header, verifica a
 * assinatura e deixa o resultado em `request.auth`. Quem decide o que fazer
 * com isso e o `requireAuth`/`requireRole`, declarados como `preHandler` por
 * rota.
 *
 * Por que o token vai no header e o refresh em cookie httpOnly: o access
 * token precisa ser legivel por JavaScript para ir no `Authorization`; o
 * refresh nao precisa, e esconde-lo e o que mitiga XSS -- um script
 * injetado na pagina nao le o cookie, mesmo que consiga fazer requisicao na
 * mesma origem.
 */

export interface SessaoAutenticada {
  userId: string;
  clinicId: string;
  membershipId: string;
  /**
   * `Role` vem do Prisma gerado, e nao e um literal reescrito aqui. O enum
   * do schema e `PROFISSIONAL`; escrever a palavra a mao no codigo ja gerou
   * um erro de tipo numa primeira versao deste arquivo.
   */
  role: Role;
  /** `users.tokenEpoch` no momento da emissao do token. */
  epoch: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido por `requireAuth`. Indefinido em rota publica. */
    auth?: SessaoAutenticada;
  }

  interface FastifyInstance {
    /**
     * As decoracoes sao declaradas como propriedades (seta), e nao como
     * metodos. Assim `app.requireAuth` pode ser passado direto como
     * `preHandler` sem disparar `unbound-method`: o lint trata metodo sem
     * `this: void` como possivel perda de contexto.
     */
    lerSessao: (request: FastifyRequest) => SessaoAutenticada | null;
    emitirAccessToken: (sessao: SessaoAutenticada) => string;
    /**
     * Cookie do refresh. O `path` muda com o ambiente porque o dev fala com
     * a API pelo proxy do Vite, em `/api/auth/*`, e producao serve a API na
     * raiz da propria origem. Cookie com `path` errado simplesmente nunca
     * volta -- e o sintoma e "refresh so falha no dev".
     */
    definirCookieRefresh: (reply: FastifyReply, token: string) => void;
    limparCookieRefresh: (reply: FastifyReply) => void;
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: Role[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const ACCESS_TTL_SECONDS = parseTtlToSeconds(env.JWT_ACCESS_TTL);
const COOKIE_NAME = 'mt_refresh';
const COOKIE_PATH = env.isProduction ? '/auth' : '/api/auth';

function extrairBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;

  if (!header) return null;

  // `startsWith('Bearer ')` aceitaria "BearerXabc" como token. Um token
  // malformado tem de ser malformado, nao aceito por engano.
  const match = /^Bearer (\S+)$/.exec(header);
  return match?.[1] ?? null;
}

export function registrarAutenticacao(app: FastifyInstance): void {
  app.decorate('emitirAccessToken', (sessao) =>
    signAccessToken(
      {
        sub: sessao.userId,
        cid: sessao.clinicId,
        mid: sessao.membershipId,
        role: sessao.role,
        epoch: sessao.epoch,
      },
      { secret: env.JWT_ACCESS_SECRET, expiresInSeconds: ACCESS_TTL_SECONDS },
    ),
  );

  app.decorate('lerSessao', (request) => {
    const token = extrairBearer(request);

    if (!token) return null;

    try {
      const claims = verifyAccessToken(token, env.JWT_ACCESS_SECRET);
      return {
        userId: claims.sub,
        clinicId: claims.cid,
        membershipId: claims.mid,
        role: claims.role,
        epoch: claims.epoch,
      };
    } catch (error) {
      // Token invalido equivale a "sem sessao", e nao a erro 500: quem
      // responde 401 ou 401-com-refresh e a rota. Token expirado e o fluxo
      // normal de um acesso de 15 minutos, entao nem deserve log de warn.
      if (error instanceof JwtError) {
        request.log.debug({ codigo: error.code }, 'access token recusado');
        return null;
      }
      throw error;
    }
  });

  app.decorate('definirCookieRefresh', (reply, token) => {
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      // `secure` desligado no dev: sem TLS o navegador descarta cookie
      // `secure` em silencio, e o refresh falha sem nenhuma mensagem.
      secure: env.isProduction,
      sameSite: 'lax',
      path: COOKIE_PATH,
      maxAge: env.JWT_REFRESH_TTL_DAYS * 86_400,
    });
  });

  app.decorate('limparCookieRefresh', (reply) => {
    // `clearCookie` precisa receber os mesmos atributos do cookie original.
    // Sem `path` igual, o navegador remove um cookie que nao existe.
    reply.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: env.isProduction,
      sameSite: 'lax',
      path: COOKIE_PATH,
    });
  });

  app.decorate('requireAuth', async (request, reply) => {
    const sessao = app.lerSessao(request);

    if (!sessao) {
      // O `WWW-Authenticate` e o que faz um cliente generico saber que o
      // token expirou e tentar o refresh antes de renderizar erro.
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({
        error: 'UNAUTHENTICATED',
        message: 'Faca login para continuar.',
      });
    }

    request.auth = sessao;
  });

  app.decorate(
    'requireRole',
    (...roles) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        // `requireAuth` roda antes: se a rota nao o declarou, `auth` fica
        // indefinido e o 403 seria enganoso -- o certo seria 401.
        const sessao = request.auth;

        if (!sessao) {
          return reply.code(401).send({
            error: 'UNAUTHENTICATED',
            message: 'Faca login para continuar.',
          });
        }

        if (!roles.includes(sessao.role)) {
          return reply.code(403).send({
            error: 'FORBIDDEN',
            message: 'Seu perfil nao tem acesso a este recurso.',
          });
        }
      },
  );
}
