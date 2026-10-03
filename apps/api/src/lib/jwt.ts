import { createHmac, timingSafeEqual } from 'node:crypto';

import { Role } from '../generated/prisma/enums.js';

/**
 * JWT HS256, em cima do `node:crypto`.
 *
 * Nao adotei `@fastify/jwt` porque o catalogo do monorepo nao tinha a lib e
 * o que a Etapa 2 precisa e exatamente um HS256: 40 linhas com a assinatura
 * verificada e o algoritmo fixo, sem arvore de dependencias nova. Se um dia
 * aparecer RS256 para assinar com chave publica, ai a lib passa a compensar.
 *
 * As duas decisoes que realmente importam aqui:
 *
 * 1. **O algoritmo e fixo, nunca lido do token.** Aceitar o `alg` que o
 *    cliente mandou e o que permite o ataque classico de confusao: o
 *    servidor que so sabe verificar HS256, ao receber `alg: none`, entrega
 *    token invalido sem assinatura; e o que so sabe verificar RS256, ao
 *    receber `alg: HS256`, usa a chave publica como segredo HMAC. Ambos
 *    viram "token valido" sem o atacante ter a chave. Aqui um header
 *    diferente de `HS256` e rejeitado antes de qualquer comparacao.
 *
 * 2. **A assinatura e comparada em tempo constante.** `===` em string
 *    compara byte a byte e retorna no primeiro diferente, o que vaza o
 *    tamanho do prefixo correto. `timingSafeEqual` sempre le a entrada
 *    inteira.
 */

const ALGORITHM = 'HS256' as const;

/** Codigo que um JWT usa para erro, em vez do `Error` simples. */
export class JwtError extends Error {
  readonly code: 'TOKEN_INVALID' | 'TOKEN_EXPIRED';

  constructor(code: 'TOKEN_INVALID' | 'TOKEN_EXPIRED', message: string) {
    super(message);
    this.name = 'JwtError';
    this.code = code;
  }
}

/**
 * Claims da nossa applicacao. `epoch` espelha `User.tokenEpoch`: comparar os
 * dois no refresh e o que faz "trocar a senha" derrubar sessoes sem precisar
 * varrer tabela de tokens.
 */
export interface AccessTokenClaims {
  /** `users.id`. */
  sub: string;
  /** Clinica escolhida no login. Todo acesso e no contexto dela. */
  cid: string;
  role: Role;
  /** `clinic_memberships.id`. */
  mid: string;
  /** `users.tokenEpoch` no momento da emissao. */
  epoch: number;
  iat: number;
  exp: number;
}

export interface SignOptions {
  /** Segredo HMAC. Segredos diferentes para access e refresh. */
  secret: string;
  /** Segundos ate a expiracao. */
  expiresInSeconds: number;
  /** Segundos desde a epoch. Injectavel para testar expiracao sem esperar. */
  now?: () => number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function fromBase64url(input: string): Buffer {
  // O padrao base64url dispensa padding; o `Buffer.from` exige de volta.
  const padded = input.replaceAll('-', '+').replaceAll('_', '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function signAccessToken(
  claims: Omit<AccessTokenClaims, 'iat' | 'exp'>,
  options: SignOptions,
): string {
  const now = options.now ? options.now() : Math.floor(Date.now() / 1000);
  const payload: AccessTokenClaims = {
    ...claims,
    iat: now,
    exp: now + options.expiresInSeconds,
  };

  const header = base64url(JSON.stringify({ alg: ALGORITHM, typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const data = `${header}.${body}`;

  return `${data}.${base64url(hmac(options.secret, data))}`;
}

/**
 * Le e valida o token.
 *
 * `typ` e `alg` sao conferidos antes da assinatura, e a assinatura antes de
 * qualquer claim -- verificar um token so depois de confiar no header abre
 * a porta para o ataque de confusao de algoritmo.
 */
export function verifyAccessToken(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): AccessTokenClaims {
  const parts = token.split('.');

  // Um JWT tem exatamente 3 segmentos. Token partido e token forjado do
  // mesmo jeito: nao ha caso valido com menos ou mais.
  if (parts.length !== 3) {
    throw new JwtError('TOKEN_INVALID', 'Token malformado');
  }

  const [header, body, signature] = parts as [string, string, string];

  let decodedHeader: unknown;
  try {
    decodedHeader = JSON.parse(fromBase64url(header).toString('utf8'));
  } catch {
    throw new JwtError('TOKEN_INVALID', 'Header do token nao e JSON');
  }

  if (
    typeof decodedHeader !== 'object' ||
    decodedHeader === null ||
    (decodedHeader as { alg?: unknown }).alg !== ALGORITHM ||
    (decodedHeader as { typ?: unknown }).typ !== 'JWT'
  ) {
    throw new JwtError('TOKEN_INVALID', 'Algoritmo ou tipo de token nao aceito');
  }

  const expected = hmac(secret, `${header}.${body}`);
  const received = fromBase64url(signature);

  // `timingSafeEqual` exige mesmo tamanho. Token truncado nao vira
  // "assinatura invalida", vira token invalido -- e os dois casos
  // respondem 401, entao a distincao nao precisa sobreviver daqui.
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new JwtError('TOKEN_INVALID', 'Assinatura invalida');
  }

  let claims: unknown;
  try {
    claims = JSON.parse(fromBase64url(body).toString('utf8'));
  } catch {
    throw new JwtError('TOKEN_INVALID', 'Payload do token nao e JSON');
  }

  if (typeof claims !== 'object' || claims === null) {
    throw new JwtError('TOKEN_INVALID', 'Payload do token nao e objeto');
  }

  const c = claims as Record<string, unknown>;

  // `exp` ausente e `exp` invalido sao a mesma coisa: token sem prazo de
  // validade e token que nunca expira sao o mesmo buraco.
  if (typeof c['exp'] !== 'number' || c['exp'] <= now) {
    throw new JwtError('TOKEN_EXPIRED', 'Token expirado');
  }

  if (
    typeof c['sub'] !== 'string' ||
    typeof c['cid'] !== 'string' ||
    typeof c['mid'] !== 'string' ||
    typeof c['epoch'] !== 'number' ||
    // Lista vinda do enum gerado: um token com `role` inventado morre aqui
    // em vez de chegar em `requireRole` e cair num 403 enganoso.
    !Object.values(Role).includes(c['role'] as Role)
  ) {
    throw new JwtError('TOKEN_INVALID', 'Claims obrigatorias ausentes');
  }

  return c as unknown as AccessTokenClaims;
}

/**
 * "15m" -> 900. Aceita `s`, `m`, `h` e `d` porque e assim que o `.env`
 * escreve. O valor ja vem validado como string; um formato desconhecido e
 * erro de configuracao, nao silenciosamente 0.
 */
export function parseTtlToSeconds(ttl: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(ttl.trim());

  if (!match) {
    throw new Error(`TTL invalido: "${ttl}". Use 30s, 15m, 12h ou 30d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[unit];

  return amount * multiplier;
}
