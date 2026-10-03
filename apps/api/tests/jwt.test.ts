import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JwtError, parseTtlToSeconds, signAccessToken, verifyAccessToken } from '../src/lib/jwt.js';

/**
 * JWT: o que precisa ser provado e o que precisa ser recusado.
 *
 * A maioria destes casos e de ataque. Um token assinado que volta do
 * `verifyAccessToken` sem erro e exatamente o que o atacante quer, entao
 * "deu ruim" precisa ser uma excecao nomeada -- e nao um `undefined` que
 * algum `if` la frente vira sessao valida.
 */

const SEGREDO = 'a'.repeat(64);
const OUTRO = 'b'.repeat(64);

const CLAIMS = {
  sub: '11111111-1111-4111-8111-111111111111',
  cid: '22222222-2222-4222-8222-222222222222',
  mid: '33333333-3333-4333-8333-333333333333',
  role: 'ADMIN',
  epoch: 0,
} as const;

function base64url(entrada: Buffer | string): string {
  return Buffer.from(entrada)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/**
 * Decodifica um segmento do JWT sem deixar `any` vazar do `JSON.parse`.
 * `as unknown` e o unico ponto de saida do `any`; daqui para a frente o
 * teste so compara com `expect` ou faz o cast explicito do que espera.
 */
function decodificarSegmento(token: string, indice: 0 | 1): unknown {
  const segmento = token.split('.')[indice];
  if (segmento === undefined) throw new Error('token sem os tres segmentos');
  return JSON.parse(Buffer.from(segmento, 'base64url').toString('utf8')) as unknown;
}

describe('signAccessToken', () => {
  it('produz tres segmentos e nao expoe o segredo', () => {
    const token = signAccessToken(CLAIMS, { secret: SEGREDO, expiresInSeconds: 900 });

    expect(token.split('.')).toHaveLength(3);
    expect(token).not.toContain(SEGREDO);
  });

  it('assina header com HS256 e typ JWT', () => {
    const token = signAccessToken(CLAIMS, { secret: SEGREDO, expiresInSeconds: 900 });
    const header = decodificarSegmento(token, 0);

    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('usa base64url, sem + nem / que quebram o transporte', () => {
    // 900 bytes de dado produzem "+" e "/" na base64 normal; o token tem que
    // sobreviver a header HTTP e a JSON sem escape.
    for (let i = 0; i < 50; i++) {
      const token = signAccessToken(
        { ...CLAIMS, sub: 'x'.repeat(i) },
        { secret: SEGREDO, expiresInSeconds: 900 },
      );
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    }
  });

  it('embute exp a partir de expiresInSeconds', () => {
    const agora = 1_700_000_000;
    const token = signAccessToken(CLAIMS, {
      secret: SEGREDO,
      expiresInSeconds: 900,
      now: () => agora,
    });

    const payload = decodificarSegmento(token, 1) as { iat: number; exp: number };
    expect(payload.iat).toBe(agora);
    expect(payload.exp).toBe(agora + 900);
  });
});

describe('verifyAccessToken', () => {
  it('devolve as claims de um token recem-assinado', () => {
    const agora = 1_700_000_000;
    const token = signAccessToken(CLAIMS, {
      secret: SEGREDO,
      expiresInSeconds: 900,
      now: () => agora,
    });

    const claims = verifyAccessToken(token, SEGREDO, agora + 1);

    expect(claims.sub).toBe(CLAIMS.sub);
    expect(claims.cid).toBe(CLAIMS.cid);
    expect(claims.mid).toBe(CLAIMS.mid);
    expect(claims.role).toBe('ADMIN');
    expect(claims.epoch).toBe(0);
  });

  it('recusa assinatura feita com outro segredo', () => {
    const token = signAccessToken(CLAIMS, { secret: OUTRO, expiresInSeconds: 900 });

    expect(() => verifyAccessToken(token, SEGREDO)).toThrow(JwtError);
    expect(() => verifyAccessToken(token, SEGREDO)).toThrow(/Assinatura invalida/);
  });

  it('recusa token expirado distinguindo de token invalido', () => {
    const agora = 1_700_000_000;
    const token = signAccessToken(CLAIMS, {
      secret: SEGREDO,
      expiresInSeconds: 900,
      now: () => agora,
    });

    // Exatamente no limite ja e expirado: `exp` e o instante de expiracao,
    // nao o seguinte.
    expect(() => verifyAccessToken(token, SEGREDO, agora + 900)).toThrow(
      expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
    );
    expect(() => verifyAccessToken(token, SEGREDO, agora + 899)).not.toThrow();
  });

  it('recusa payload adulterado sem reler a assinatura', () => {
    const agora = 1_700_000_000;
    const token = signAccessToken(CLAIMS, {
      secret: SEGREDO,
      expiresInSeconds: 900,
      now: () => agora,
    });
    const [header, , assinatura] = token.split('.');

    // Token valido com `role` trocado para ADMIN e expiracao empurrada.
    const forjado = base64url(
      JSON.stringify({
        ...CLAIMS,
        cid: '99999999-9999-4999-8999-999999999999',
        exp: agora + 999_999,
      }),
    );

    expect(() => verifyAccessToken(`${header}.${forjado}.${assinatura}`, SEGREDO, agora)).toThrow(
      /Assinatura invalida/,
    );
  });

  it('recusa alg none, que e o ataque de token sem assinatura', () => {
    const agora = 1_700_000_000;
    const semAssinatura = `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64url(
      JSON.stringify({ ...CLAIMS, exp: agora + 999_999 }),
    )}.`;

    expect(() => verifyAccessToken(semAssinatura, SEGREDO, agora)).toThrow(JwtError);
  });

  it('recusa HS256 com typ trocado', () => {
    const agora = 1_700_000_000;
    const forjado = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWE' }))}.${base64url(
      JSON.stringify({ ...CLAIMS, exp: agora + 999_999 }),
    )}.${base64url(createHmac('sha256', SEGREDO).update('').digest())}`;

    expect(() => verifyAccessToken(forjado, SEGREDO, agora)).toThrow(
      /Algoritmo ou tipo de token nao aceito/,
    );
  });

  it('recusa token sem exp, que nunca expiraria', () => {
    const agora = 1_700_000_000;
    const dados = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(
      JSON.stringify(CLAIMS),
    )}`;
    const assinatura = base64url(createHmac('sha256', SEGREDO).update(dados).digest());

    expect(() => verifyAccessToken(`${dados}.${assinatura}`, SEGREDO, agora)).toThrow(
      expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
    );
  });

  it('recusa token com claims obrigatorias ausentes', () => {
    const agora = 1_700_000_000;
    const dados = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(
      // Sem `cid`: um token de outra estrutura cairia em `requireRole`
      // com clinicId indefinida.
      JSON.stringify({
        sub: CLAIMS.sub,
        mid: CLAIMS.mid,
        role: 'ADMIN',
        epoch: 0,
        exp: agora + 900,
      }),
    )}`;
    const assinatura = base64url(createHmac('sha256', SEGREDO).update(dados).digest());

    expect(() => verifyAccessToken(`${dados}.${assinatura}`, SEGREDO, agora)).toThrow(
      /Claims obrigatorias ausentes/,
    );
  });

  it('recusa role fora do enum', () => {
    const agora = 1_700_000_000;
    const dados = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(
      JSON.stringify({ ...CLAIMS, role: 'DONO', exp: agora + 900 }),
    )}`;
    const assinatura = base64url(createHmac('sha256', SEGREDO).update(dados).digest());

    expect(() => verifyAccessToken(`${dados}.${assinatura}`, SEGREDO, agora)).toThrow(
      /Claims obrigatorias ausentes/,
    );
  });

  it('recusa assinatura truncada, sem estourar no timingSafeEqual', () => {
    const token = signAccessToken(CLAIMS, { secret: SEGREDO, expiresInSeconds: 900 });

    expect(() => verifyAccessToken(token.slice(0, -6), SEGREDO)).toThrow(JwtError);
  });

  it('recusa token com numero errado de segmentos', () => {
    const token = signAccessToken(CLAIMS, { secret: SEGREDO, expiresInSeconds: 900 });

    expect(() => verifyAccessToken('', SEGREDO)).toThrow(/malformado/);
    expect(() => verifyAccessToken('a.b', SEGREDO)).toThrow(/malformado/);
    expect(() => verifyAccessToken(`${token}.extra`, SEGREDO)).toThrow(/malformado/);
  });

  it('recusa header que nao e JSON', () => {
    const token = signAccessToken(CLAIMS, { secret: SEGREDO, expiresInSeconds: 900 });
    const [, corpo, assinatura] = token.split('.');

    expect(() =>
      verifyAccessToken(`${base64url('nao e json')}.${corpo}.${assinatura}`, SEGREDO),
    ).toThrow(/Header do token nao e JSON/);
  });

  it('recusa payload que nao e JSON, com assinatura valida', () => {
    const corpo = base64url('nao e json');
    const dados = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${corpo}`;
    const assinatura = base64url(createHmac('sha256', SEGREDO).update(dados).digest());

    expect(() => verifyAccessToken(`${dados}.${assinatura}`, SEGREDO)).toThrow(
      /Payload do token nao e JSON/,
    );
  });

  it('recusa payload que e JSON mas nao e objeto', () => {
    const corpo = base64url('123');
    const dados = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${corpo}`;
    const assinatura = base64url(createHmac('sha256', SEGREDO).update(dados).digest());

    expect(() => verifyAccessToken(`${dados}.${assinatura}`, SEGREDO)).toThrow(
      /Payload do token nao e objeto/,
    );
  });
});

describe('parseTtlToSeconds', () => {
  it('converte as unidades aceitas no .env', () => {
    expect(parseTtlToSeconds('30s')).toBe(30);
    expect(parseTtlToSeconds('15m')).toBe(900);
    expect(parseTtlToSeconds('12h')).toBe(43_200);
    expect(parseTtlToSeconds('30d')).toBe(2_592_000);
  });

  it('aceita espaco entre numero e unidade', () => {
    expect(parseTtlToSeconds('15 m')).toBe(900);
  });

  it('rejeita formato desconhecido em vez de virar 0', () => {
    // TTL Zero seria token que expira no instante da emissao: um login que
    // nunca funciona, e o erro aparece longe da causa.
    expect(() => parseTtlToSeconds('15')).toThrow(/TTL invalido/);
    expect(() => parseTtlToSeconds('quinze minutos')).toThrow(/TTL invalido/);
    expect(() => parseTtlToSeconds('')).toThrow(/TTL invalido/);
  });
});
