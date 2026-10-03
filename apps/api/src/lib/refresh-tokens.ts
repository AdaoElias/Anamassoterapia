import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { env } from '../config/env.js';
import type { PrismaClient, RefreshToken } from '../generated/prisma/client.js';

/**
 * Refresh token: rotacao com deteccao de reuso.
 *
 * O access token vive 15 minutos e nao da para revogar. O refresh e o que
 * segura a sessao, entao e tratado como credencial de primeira classe:
 *
 * - **Rotaciona a cada uso.** Todo refresh emite um token novo e marca o
 *   anterior como revogado. Se um token ja usado volta, ou o cliente tem
 *   duas abas com refresh concorrente, ou alguem roubou o token.
 *
 * - **A familia e revogada inteira no reuso.** Revogar so o token roubado
 *   deixa o atacante com a cadeia inteira ainda valida. A familia (o
 *   `familyId` que nasce no login) morre junto, e o usuario precisa
 *   entrar de novo -- que e o preco correto quando ha duvida sobre quem
 *   esta com a credencial.
 *
 * - **So o hash vai para o banco.** Um dump de `refresh_tokens` nao entrega
 *   sessao nenhuma. O mesmo motivo que faz o hash de senha nao ser a senha.
 *
 * O token e opaco: 32 bytes aleatorios em base64url, nao um JWT. Nao ha
 * vantagem em ser JWT aqui -- o refresh nao precisa ser lido por nenhum
 * cliente, entao nao ha claims a expor, e um token sem estrutura nao pode
 * ser adulterado em campo nenhum. O que amarra a credencial ao servidor e o
 * registro no banco, consultado a cada refresh.
 *
 * A invalidacao global (troca de senha) nao passa por aqui: ela incrementa
 * `users.tokenEpoch`, e o refresh compara o epoch do banco com o do token
 * emitido. Isso mata todas as familias de uma vez sem tocar em
 * `refresh_tokens`.
 */

const TOKEN_BYTES = 32;

export interface Emitido {
  /** Token em claro: vai para o cookie httpOnly e nunca mais e lido. */
  token: string;
  registro: RefreshToken;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function expiraEm(): Date {
  return new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86_400_000);
}

/** Cria a primeira credencial de uma sessao. */
export async function emitirRefreshToken(
  prisma: PrismaClient,
  entrada: {
    userId: string;
    membershipId: string;
    userAgent?: string | undefined;
    ip?: string | undefined;
  },
): Promise<Emitido> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  const registro = await prisma.refreshToken.create({
    data: {
      userId: entrada.userId,
      tokenHash: hashToken(token),
      familyId: randomUUID(),
      membershipId: entrada.membershipId,
      expiresAt: expiraEm(),
      userAgent: entrada.userAgent?.slice(0, 300) ?? null,
      ip: entrada.ip ?? null,
    },
  });

  return { token, registro };
}

export type ResultadoRotacao =
  | { ok: true; emitido: Emitido }
  | { ok: false; motivo: 'DESCONHECIDO' | 'EXPIRADO' | 'REUSO' | 'REVOGADO' };

/**
 * Sinaliza que outro request ja trocou este token entre a leitura e a escrita.
 * Fica interno: quem chama trata como reuso, que e a leitura correta.
 */
class TokenJaRotacionado extends Error {}

/**
 * Troca o token apresentado por um novo.
 *
 * A busca e por `tokenHash`, e nao por `id`: o banco nunca viu o token em
 * claro, entao o hash e a unica chave de busca possivel.
 *
 * A escrita usa compare-and-swap (`updateMany` filtrando `revoked_at IS
 * NULL`) em vez de `update` por id. Com `update` por id, dois requests
 * concorrentes -- duas abas, ou um duplo clique -- leem ambos "token ativo",
 * ambos gravam, e os dois saem com um token valido: a rotacao deixa de ser
 * rotacao e o reuso deixa de ser detectavel. Com o CAS, so o primeiro
 * escreve; o segundo recebe `count: 0` e cai em reuso.
 */
export async function rotacionarRefreshToken(
  prisma: PrismaClient,
  token: string,
): Promise<ResultadoRotacao> {
  const registro = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });

  if (!registro) {
    return { ok: false, motivo: 'DESCONHECIDO' };
  }

  if (registro.expiresAt.getTime() <= Date.now()) {
    return { ok: false, motivo: 'EXPIRADO' };
  }

  // Chega aqui quando o token ja foi trocado: e a unica condicao em que a
  // deteccao de reuso pode disparar.
  if (registro.revokedAt !== null) {
    await revogarFamilia(prisma, registro.familyId);
    return { ok: false, motivo: 'REUSO' };
  }

  const proximo = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = expiraEm();

  let criado: RefreshToken;

  try {
    criado = await prisma.$transaction(async (tx) => {
      // Cria primeiro: `replacedById` so pode ser preenchido com o id do
      // token novo, e `unique` impede dois tokens apontarem para o mesmo.
      const novo = await tx.refreshToken.create({
        data: {
          userId: registro.userId,
          tokenHash: hashToken(proximo),
          familyId: registro.familyId,
          // A membership viaja para o novo token. Sem copiar, a segunda
          // rotacao ja perderia a clinica da sessao.
          membershipId: registro.membershipId,
          expiresAt,
          userAgent: registro.userAgent,
          ip: registro.ip,
        },
      });

      const { count } = await tx.refreshToken.updateMany({
        where: { id: registro.id, revokedAt: null },
        // `replaced_by_id` fica no token **antigo**: a coluna significa "este
        // token foi substituido por aquele". Gravar o id do antigo no novo
        // inverteria a cadeia e a detectaria em auditoria.
        data: { revokedAt: new Date(), replacedById: novo.id },
      });

      if (count !== 1) {
        // O throw desfaz o create: nao sobra token novo sem dono.
        throw new TokenJaRotacionado();
      }

      return novo;
    });
  } catch (erro) {
    if (erro instanceof TokenJaRotacionado) {
      await revogarFamilia(prisma, registro.familyId);
      return { ok: false, motivo: 'REUSO' };
    }
    throw erro;
  }

  return { ok: true, emitido: { token: proximo, registro: criado } };
}

/** Encerra a sessao. Revoga so o token apresentado e a familia. */
export async function revogarFamilia(prisma: PrismaClient, familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Encerra todas as sessoes do usuario. Usado ao trocar a senha. */
export async function revogarTodasAsSessoes(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Limpa tokens expirados ha mais de 30 dias.
 *
 * `expiresAt` tem indice proprio justamente para esta limpeza poder rodar
 * por agenda sem varrer tabela. Revogar e diferente de apagar: apagar o
 * registro removes a evidencia de que a credencial existiu.
 */
export async function limparRefreshTokensExpirados(prisma: PrismaClient): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 30 * 86_400_000) } },
  });
  return count;
}
