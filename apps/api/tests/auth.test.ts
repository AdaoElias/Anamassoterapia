import { createHash, randomUUID } from 'node:crypto';
import type { OutgoingHttpHeaders } from 'node:http';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import { disconnectPrisma, prisma } from '../src/lib/prisma.js';

/**
 * `/auth` por dentro.
 *
 * Roda contra o banco de teste (`tests/setup.ts` ja trocou `DATABASE_URL`),
 * e nao com `app.inject()` puro: rotacao de refresh, familia e `tokenEpoch`
 * sao estado no Postgres. Um teste com repository mockado passaria mesmo com
 * a rotacao errada.
 *
 * A senha nao passa por Argon2 aqui: `buildApp({ verificarSenha })` troca o
 * KDF por comparacao com o hash fixture. O que se testa aqui e a rota e o
 * estado, nao o custo do Argon2 (que tem teste proprio, em
 * `password.test.ts`).
 *
 * Cada teste cria clinica, usuario e membership proprios e apaga no final.
 * Sem isso, `beforeEach` global deixaria lixo para o resto da suite e para o
 * proximo `db:seed`.
 */

const HASH_FIXTURE = '$argon2id$v=19$m=19456,t=2,p=1$c2VudG8$hash';

/**
 * Mesmo hash que `refresh-tokens.ts` usa. Fica duplicado aqui de proposito:
 * se a producao trocar o algoritmo, o teste tem de apontar o novo valor, e
 * nao herdar a troca sem perceber.
 */
const sha256 = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Stub do KDF. A ordem dos parametros e a mesma de `AuthOptions`:
 * primeiro o hash guardado, depois a senha tentada. Inverter os dois aqui
 * produz 401 em tudo e parece falha de autenticacao.
 */
const senhaCorreta = (hashGuardado: string, senha: string): Promise<boolean> =>
  Promise.resolve(senha === 'Senha@123' && hashGuardado === HASH_FIXTURE);

const apps: App[] = [];

/**
 * Envelhece um token recuando `expires_at` **e** `created_at`.
 *
 * O banco tem CHECK (`*_expiry_after_creation`) proibindo `expires_at` no
 * passado em relacao a `created_at`, e com razao: um token nascido expirado
 * e bug de emissao. Para exercitar o caminho de "expirado" na aplicacao --
 * que existe para tokens que expiram com o passar dos dias -- o teste tem
 * de envelhecer os dois campos, senao o banco barra antes da rota.
 */
async function envelhecerTokens(
  modelo: 'refreshToken' | 'passwordResetToken',
  userId: string,
): Promise<void> {
  const dados = {
    createdAt: new Date(Date.now() - 86_400_000),
    expiresAt: new Date(Date.now() - 1000),
  };

  // Branch explicito: `prisma[modelo]` une dois delegates e o TS nao acha
  // assinatura comum para chamar.
  if (modelo === 'refreshToken') {
    await prisma.refreshToken.updateMany({ where: { userId }, data: dados });
  } else {
    await prisma.passwordResetToken.updateMany({ where: { userId }, data: dados });
  }
}

interface Fixture {
  clinicId: string;
  clinicIds: string[];
  userId: string;
  membershipId: string;
  email: string;
}

/**
 * Fixtures criadas pelo teste corrente, drenadas no `afterEach`.
 *
 * Deletar o usuario derruba em cascata memberships, refresh tokens e reset
 * tokens; as clinicas precisam de delete explicito, porque nao sao filhas de
 * ninguem. Sem o drain, cada `vitest run` deixava dezenas de clinicas e
 * usuarios `@teste.local` no banco de teste.
 */
const criadas: Fixture[] = [];

async function novaApp(): Promise<App> {
  const app = await buildApp({ verificarSenha: senhaCorreta });
  await app.ready();
  apps.push(app);
  return app;
}

async function criarFixture(
  overrides: { active?: boolean; memberships?: number } = {},
): Promise<Fixture> {
  const clinicId = randomUUID();
  const userId = randomUUID();
  const email = `${randomUUID()}@teste.local`;
  const membershipId = randomUUID();
  const clinicIds = [clinicId];

  await prisma.clinic.create({
    data: {
      id: clinicId,
      name: 'Clinica de Teste',
      slug: `clinica-${clinicId.slice(0, 8)}`,
    },
  });

  await prisma.user.create({
    data: {
      id: userId,
      email,
      passwordHash: HASH_FIXTURE,
      name: 'Profissional de Teste',
      active: overrides.active ?? true,
    },
  });

  const total = overrides.memberships ?? 1;

  for (let i = 0; i < total; i++) {
    const membershipClinic = i === 0 ? clinicId : randomUUID();

    if (i > 0) {
      clinicIds.push(membershipClinic);
      await prisma.clinic.create({
        data: {
          id: membershipClinic,
          name: `Segunda Clinica ${i}`,
          slug: `clinica-b-${membershipClinic.slice(0, 8)}`,
        },
      });
    }

    await prisma.clinicMembership.create({
      data: {
        id: i === 0 ? membershipId : randomUUID(),
        clinicId: membershipClinic,
        userId,
        role: i === 0 ? 'ADMIN' : 'PROFISSIONAL',
      },
    });
  }

  const fixture: Fixture = { clinicId, clinicIds, userId, membershipId, email };
  criadas.push(fixture);
  return fixture;
}

/**
 * `res.cookies` do light-my-request e `Array<{ name, value, httpOnly? }>`,
 * nao lista de `Set-Cookie` cru. Para conferir atributo (`HttpOnly`,
 * `Path`, `SameSite`) o ground truth e o header cru; para pegar o valor do
 * token, o objeto parseado resolve.
 */
type RespostaInjetada = {
  statusCode: number;
  headers: OutgoingHttpHeaders;
  cookies: Array<{ name: string; value: string; httpOnly?: boolean }>;
};

/** Header `Set-Cookie` cru, sempre como lista. */
function cookiesCru(resposta: RespostaInjetada): string[] {
  const bruto = resposta.headers['set-cookie'];
  if (bruto === undefined) return [];
  return Array.isArray(bruto) ? bruto : [bruto];
}

/** Valor do refresh que a resposta acabou de emitir. */
function lerRefreshCookie(resposta: RespostaInjetada): string | null {
  return resposta.cookies.find((c) => c.name === 'mt_refresh')?.value ?? null;
}

/**
 * `resposta.json()` do light-my-request devolve `any`, e o lint proibe
 * acessar campo direto. O cast fica concentrado neste unico ponto: o
 * resto do teste consome o corpo ja tipado, sem `any` escorrendo.
 */
function corpoDe<T>(resposta: { json(): unknown }): T {
  return resposta.json() as T;
}

/**
 * Estreita um valor possivelmente ausente e falha o teste de forma
 * explicita. Substitui o `!` dos testes por uma checagem de verdade.
 */
function obter<T>(valor: T | null | undefined): T {
  if (valor === null || valor === undefined) {
    throw new Error('valor esperado nao veio');
  }
  return valor;
}

afterEach(async () => {
  const doTeste = criadas.splice(0, criadas.length);
  if (doTeste.length === 0) return;

  await prisma.user.deleteMany({ where: { id: { in: doTeste.map((f) => f.userId) } } });
  await prisma.clinic.deleteMany({
    where: { id: { in: doTeste.flatMap((f) => f.clinicIds) } },
  });
});

afterAll(async () => {
  for (const app of apps) {
    await app.close();
  }
  await disconnectPrisma();
});

describe('POST /auth/login', () => {
  it('autentica com e-mail e senha corretos e devolve access token e cookie', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Senha@123' },
    });

    expect(resposta.statusCode).toBe(200);
    const corpo = corpoDe<{
      status: string;
      accessToken: string;
      expiresInSeconds: number;
      perfil: { email: string; role: string; professionalId: string | null };
    }>(resposta);
    expect(corpo.status).toBe('autenticado');
    expect(corpo.accessToken).toEqual(expect.any(String));
    expect(corpo.expiresInSeconds).toBe(900);
    expect(corpo.perfil.email).toBe(fixture.email);
    expect(corpo.perfil.role).toBe('ADMIN');
    expect(corpo.perfil.professionalId).toBeNull();

    // O refresh vai em cookie httpOnly: e o que impede um XSS de ler a
    // credencial de longa duracao.
    const cookie = cookiesCru(resposta).find((c) => c.startsWith('mt_refresh='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    // Sem `Secure` no dev: sem TLS o navegador descarta o cookie em
    // silencio e o sintoma e "refresh nao funciona" sem erro no servidor.
    expect(cookie).toContain('SameSite=Lax');
  });

  it('normaliza o e-mail, para maiuscula e espaco nao criem conta duplicada', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: `  ${fixture.email.toUpperCase()}  `, senha: 'Senha@123' },
    });

    expect(resposta.statusCode).toBe(200);
    expect(corpoDe<{ status: string }>(resposta).status).toBe('autenticado');
  });

  it('nao diz se o e-mail existe: senha errada e usuario inexistente sao iguais', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();

    const senhaErrada = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Errada@123' },
    });
    const inexistente = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: `${randomUUID()}@naoexiste.local`, senha: 'Senha@123' },
    });

    // Corpo igual e status igual: qualquer diferenca entre os dois vira
    // enumerador de contas.
    expect(senhaErrada.statusCode).toBe(inexistente.statusCode);
    expect(senhaErrada.json()).toEqual(inexistente.json());
    expect(corpoDe<{ error: string }>(senhaErrada).error).toBe('INVALID_CREDENTIALS');
  });

  it('bloqueia conta desativada, mas so depois da senha certa', async () => {
    const app = await novaApp();
    const fixture = await criarFixture({ active: false });

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Senha@123' },
    });

    expect(resposta.statusCode).toBe(403);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('ACCOUNT_INACTIVE');
  });

  it('recusa conta sem nenhuma clinica', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    await prisma.clinicMembership.deleteMany({ where: { userId: fixture.userId } });

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Senha@123' },
    });

    expect(resposta.statusCode).toBe(403);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('NO_CLINIC_ACCESS');
  });

  it('pede a escolha de clinica quando ha mais de uma, sem emitir token', async () => {
    const app = await novaApp();
    const fixture = await criarFixture({ memberships: 2 });

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Senha@123' },
    });

    // 200 e nao 4xx: o login deu certo, falta uma informacao.
    expect(resposta.statusCode).toBe(200);
    const corpo = corpoDe<{
      status: string;
      accessToken?: string;
      clinicas: Array<{ id: string; nome: string; role: string }>;
    }>(resposta);
    expect(corpo.status).toBe('escolha_de_clinica');
    expect(corpo.clinicas).toHaveLength(2);
    expect(corpo.clinicas.map((c) => c.nome).sort()).toEqual([
      'Clinica de Teste',
      'Segunda Clinica 1',
    ]);
    // Nenhum token antes da escolha: uma clinic errada serviria dado errado.
    expect(corpo.accessToken).toBeUndefined();
    expect(lerRefreshCookie(resposta)).toBeNull();
  });

  it('aceita clinicId explicito entre varias clinicas', async () => {
    const app = await novaApp();
    const fixture = await criarFixture({ memberships: 2 });
    const memberships = await prisma.clinicMembership.findMany({
      where: { userId: fixture.userId },
    });
    const outra = obter(memberships.find((m) => m.clinicId !== fixture.clinicId));

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Senha@123', clinicId: outra.clinicId },
    });

    expect(resposta.statusCode).toBe(200);
    const corpo = corpoDe<{ status: string; perfil: { clinicId: string; role: string } }>(resposta);
    expect(corpo.status).toBe('autenticado');
    expect(corpo.perfil.clinicId).toBe(outra.clinicId);
    expect(corpo.perfil.role).toBe('PROFISSIONAL');
  });

  it('recusa clinicId de clinica que o usuario nao pertence', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Senha@123', clinicId: randomUUID() },
    });

    expect(resposta.statusCode).toBe(403);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('CLINIC_FORBIDDEN');
  });

  it('rejeita payload invalido com 422 e campo apontado', async () => {
    const app = await novaApp();

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nao-e-email', senha: '' },
    });

    expect(resposta.statusCode).toBe(422);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('VALIDATION_ERROR');
  });

  it('limita tentativas de login a 5 por minuto', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();

    let ultimo = app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Errada@123' },
    });
    for (let i = 0; i < 5; i++) {
      ultimo = app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: fixture.email, senha: 'Errada@123' },
      });
    }
    await ultimo;

    const excedente = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Errada@123' },
    });

    expect(excedente.statusCode).toBe(429);
  });
});

describe('POST /auth/refresh', () => {
  async function login(app: App, fixture: Fixture): Promise<string> {
    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Senha@123' },
    });
    return obter(lerRefreshCookie(resposta));
  }

  it('troca o refresh por um access token novo', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const cookie = await login(app, fixture);

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: cookie },
    });

    expect(resposta.statusCode).toBe(200);
    const corpo = corpoDe<{ accessToken: string; expiresInSeconds: number }>(resposta);
    // O cliente web ja esperava exatamente este formato.
    expect(corpo.accessToken).toEqual(expect.any(String));
    expect(corpo.expiresInSeconds).toBe(900);

    const novo = lerRefreshCookie(resposta);
    expect(novo).toBeTruthy();
    // Rotacao de verdade: o token novo nao pode ser o mesmo.
    expect(novo).not.toBe(cookie);
  });

  it('aponta replacedById do token antigo para o novo, nunca o contrario', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const cookie = await login(app, fixture);

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: cookie },
    });
    const novo = obter(lerRefreshCookie(resposta));

    const antigo = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(cookie) },
    });
    const sucessor = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(novo) },
    });

    expect(obter(antigo).revokedAt).not.toBeNull();
    // `replaced_by_id` vive no token substituido e aponta para quem o
    // substituiu. O codigo antigo gravava o id do antigo no novo, o que
    // inverte a cadeia e mente em auditoria.
    expect(obter(antigo).replacedById).toBe(obter(sucessor).id);
    expect(obter(sucessor).replacedById).toBeNull();
  });

  it('duas rotacoes simultaneas do mesmo token: so uma vence', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const cookie = await login(app, fixture);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/auth/refresh', cookies: { mt_refresh: cookie } }),
      app.inject({ method: 'POST', url: '/auth/refresh', cookies: { mt_refresh: cookie } }),
    ]);

    // Sem CAS, os dois requests leem "ativo", os dois gravam, e a sessao
    // fica com dois refresh validos -- a rotacao vira decoracao.
    expect([a, b].filter((r) => r.statusCode === 200)).toHaveLength(1);

    const original = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(cookie) },
    });
    const ativos = await prisma.refreshToken.count({
      where: { familyId: obter(original).familyId, revokedAt: null },
    });
    expect(ativos).toBe(0);
  });

  it('recusa sem cookie', async () => {
    const app = await novaApp();
    const resposta = await app.inject({ method: 'POST', url: '/auth/refresh' });

    expect(resposta.statusCode).toBe(401);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('NO_REFRESH_TOKEN');
  });

  it('recusa token desconhecido e limpa o cookie', async () => {
    const app = await novaApp();

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: 'token-que-nunca-existiu' },
    });

    expect(resposta.statusCode).toBe(401);
    // Sem limpar o cookie, o navegador continua mandando e leva 401 para
    // sempre em vez de cair no login.
    expect(cookiesCru(resposta).find((c) => c.startsWith('mt_refresh='))).toMatch(/mt_refresh=;/);
  });

  it('revoga a familia inteira quando o token volta a ser usado', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const cookie = await login(app, fixture);

    const primeiro = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: cookie },
    });
    const segundoCookie = obter(lerRefreshCookie(primeiro));

    // Uso legitimo: o rotacionado funciona.
    const segundo = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: segundoCookie },
    });
    expect(segundo.statusCode).toBe(200);

    // Reuso do token antigo: e assim que token roubado se denuncia.
    const reuso = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: cookie },
    });
    expect(reuso.statusCode).toBe(401);

    // E a punicao correta: o token do atacante, que era o mais novo da
    // cadeia, tambem morre. Revogar so o reusado deixaria a cadeia viva.
    const depoisDoReuso = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: obter(lerRefreshCookie(segundo)) },
    });
    expect(depoisDoReuso.statusCode).toBe(401);
  });

  it('recusa refresh de conta desativada', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const cookie = await login(app, fixture);

    await prisma.user.update({ where: { id: fixture.userId }, data: { active: false } });

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: cookie },
    });

    expect(resposta.statusCode).toBe(401);
  });

  it('recusa refresh de quem foi removido da clinica', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const cookie = await login(app, fixture);

    await prisma.clinicMembership.delete({ where: { id: fixture.membershipId } });

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: cookie },
    });

    expect(resposta.statusCode).toBe(401);
  });

  it('recusa refresh expirado', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const cookie = await login(app, fixture);

    await envelhecerTokens('refreshToken', fixture.userId);

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: cookie },
    });

    expect(resposta.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revoga a sessao e limpa o cookie', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const loginResposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Senha@123' },
    });
    const cookie = obter(lerRefreshCookie(loginResposta));

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { mt_refresh: cookie },
    });

    expect(resposta.statusCode).toBe(204);

    // O token presenter precisa estar morto, nao so sumir do navegador.
    const depois = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: cookie },
    });
    expect(depois.statusCode).toBe(401);
  });

  it('responde 204 mesmo sem cookie, para ser idempotente', async () => {
    const app = await novaApp();
    const resposta = await app.inject({ method: 'POST', url: '/auth/logout' });

    expect(resposta.statusCode).toBe(204);
  });
});

describe('GET /auth/me', () => {
  it('devolve o perfil a partir do access token', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const loginResposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Senha@123' },
    });
    const { accessToken } = corpoDe<{ accessToken: string }>(loginResposta);

    const resposta = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(resposta.statusCode).toBe(200);
    const corpo = corpoDe<{ userId: string; clinicId: string; role: string }>(resposta);
    expect(corpo.userId).toBe(fixture.userId);
    expect(corpo.clinicId).toBe(fixture.clinicId);
    expect(corpo.role).toBe('ADMIN');
  });

  it('responde 401 com WWW-Authenticate sem token', async () => {
    const app = await novaApp();
    const resposta = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(resposta.statusCode).toBe(401);
    // O header e o que faz o cliente saber que vale tentar o refresh.
    expect(resposta.headers['www-authenticate']).toBe('Bearer');
  });

  it('recusa token adulterado', async () => {
    const app = await novaApp();
    const resposta = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'Bearer nao.e.um.token' },
    });

    expect(resposta.statusCode).toBe(401);
  });

  it('recusa prefixo malformado em vez de aceitar por engano', async () => {
    const app = await novaApp();
    const resposta = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'BearerXnao-e-token' },
    });

    expect(resposta.statusCode).toBe(401);
  });

  it('invalida o access token apos troca de senha, pelo tokenEpoch', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const loginResposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Senha@123' },
    });
    const { accessToken } = corpoDe<{ accessToken: string }>(loginResposta);

    const antes = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(antes.statusCode).toBe(200);

    // JWT nao tem lista de revogacao: o epoch no token contra o do banco e o
    // que faz um token ja emitido morrer.
    await prisma.user.update({
      where: { id: fixture.userId },
      data: { tokenEpoch: { increment: 1 } },
    });

    const depois = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(depois.statusCode).toBe(401);
    expect(corpoDe<{ error: string }>(depois).error).toBe('TOKEN_SUPERSEDED');
  });
});

describe('POST /auth/recuperar-senha', () => {
  it('responde igual exista a conta ou nao', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();

    const existente = await app.inject({
      method: 'POST',
      url: '/auth/recuperar-senha',
      payload: { email: fixture.email },
    });
    const inexistente = await app.inject({
      method: 'POST',
      url: '/auth/recuperar-senha',
      payload: { email: `${randomUUID()}@naoexiste.local` },
    });

    expect(existente.statusCode).toBe(inexistente.statusCode);
    expect(existente.json()).toEqual(inexistente.json());
  });

  it('nao cria token para e-mail inexistente', async () => {
    const app = await novaApp();
    const email = `${randomUUID()}@naoexiste.local`;

    await app.inject({ method: 'POST', url: '/auth/recuperar-senha', payload: { email } });

    expect(await prisma.passwordResetToken.count({ where: { user: { email } } })).toBe(0);
  });

  it('guarda apenas o hash do token, nunca o token', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();

    await app.inject({
      method: 'POST',
      url: '/auth/recuperar-senha',
      payload: { email: fixture.email },
    });

    const registro = await prisma.passwordResetToken.findFirst({
      where: { userId: fixture.userId },
    });
    expect(registro).not.toBeNull();
    // `tokenHash` tem 64 hex = SHA-256. O token de 43 chars base64url nao
    // cabe, o que ja prova que nao e o token em claro.
    expect(obter(registro).tokenHash).toHaveLength(64);
    expect(obter(registro).usedAt).toBeNull();
  });

  it('limita a 3 pedidos por 5 minutos', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/auth/recuperar-senha',
        payload: { email: fixture.email },
      });
    }

    const excedente = await app.inject({
      method: 'POST',
      url: '/auth/recuperar-senha',
      payload: { email: fixture.email },
    });

    expect(excedente.statusCode).toBe(429);
  });
});

describe('POST /auth/redefinir-senha', () => {
  /** Cria um token de redefinicao e devolve o valor em claro. */
  async function criarTokenDeReset(userId: string): Promise<string> {
    const { createHash, randomBytes } = await import('node:crypto');
    const token = randomBytes(32).toString('base64url');

    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    return token;
  }

  it('troca a senha e derruba as sessoes existentes', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();

    const loginResposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: fixture.email, senha: 'Senha@123' },
    });
    const cookie = obter(lerRefreshCookie(loginResposta));
    const { accessToken } = corpoDe<{ accessToken: string }>(loginResposta);

    const token = await criarTokenDeReset(fixture.userId);

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/redefinir-senha',
      payload: { token, senha: 'NovaSenha@456' },
    });
    expect(resposta.statusCode).toBe(200);

    // As duas metades da invalidacao: o refresh foi revogado...
    const refreshDepois = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mt_refresh: cookie },
    });
    expect(refreshDepois.statusCode).toBe(401);

    // ...e o access token ja emitido morre pelo epoch.
    const meDepois = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(meDepois.statusCode).toBe(401);

    const user = await prisma.user.findUnique({ where: { id: fixture.userId } });
    expect(obter(user).tokenEpoch).toBe(1);
    expect(obter(user).passwordHash).not.toBe(HASH_FIXTURE);
  });

  it('recusa token invalido', async () => {
    const app = await novaApp();

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/redefinir-senha',
      payload: { token: 'token-inventado', senha: 'NovaSenha@456' },
    });

    expect(resposta.statusCode).toBe(400);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('INVALID_RESET_TOKEN');
  });

  it('recusa token ja usado, para o link nao virar credencial eterna', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await criarTokenDeReset(fixture.userId);

    const primeira = await app.inject({
      method: 'POST',
      url: '/auth/redefinir-senha',
      payload: { token, senha: 'NovaSenha@456' },
    });
    expect(primeira.statusCode).toBe(200);

    const segunda = await app.inject({
      method: 'POST',
      url: '/auth/redefinir-senha',
      payload: { token, senha: 'OutraSenha@789' },
    });
    expect(segunda.statusCode).toBe(400);
  });

  it('recusa token expirado', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await criarTokenDeReset(fixture.userId);

    await envelhecerTokens('passwordResetToken', fixture.userId);

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/redefinir-senha',
      payload: { token, senha: 'NovaSenha@456' },
    });

    expect(resposta.statusCode).toBe(400);
  });

  it('recusa senha curta com 422', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await criarTokenDeReset(fixture.userId);

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/redefinir-senha',
      payload: { token, senha: 'curta' },
    });

    expect(resposta.statusCode).toBe(422);
  });
});
