import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import type { Role } from '../src/generated/prisma/enums.js';
import { disconnectPrisma, prisma } from '../src/lib/prisma.js';

/**
 * Rotas de cadastro (clinica, salas, terapias, profissionais, clientes).
 *
 * Roda contra o banco de teste e cria as fixtures pelo Prisma, como
 * `auth.test.ts`. O access token vem do login real: testar `requireAuth` e
 * `requireRole` e parte do contrato destas rotas.
 */

const HASH_FIXTURE = '$argon2id$v=19$m=19456,t=2,p=1$c2VudG8$hash';

const senhaCorreta = (hashGuardado: string, senha: string): Promise<boolean> =>
  Promise.resolve(senha === 'Senha@123' && hashGuardado === HASH_FIXTURE);

const apps: App[] = [];

interface Fixture {
  clinicId: string;
  userId: string;
  email: string;
  role: Role;
}

const criadas: Fixture[] = [];

async function novaApp(): Promise<App> {
  const app = await buildApp({ verificarSenha: senhaCorreta });
  await app.ready();
  apps.push(app);
  return app;
}

async function criarFixture(role: Role = 'ADMIN'): Promise<Fixture> {
  const clinicId = randomUUID();
  const userId = randomUUID();
  const email = `${randomUUID()}@teste.local`;

  await prisma.clinic.create({
    data: { id: clinicId, name: 'Clinica de Teste', slug: `clinica-${clinicId.slice(0, 8)}` },
  });

  await prisma.user.create({
    data: { id: userId, email, passwordHash: HASH_FIXTURE, name: 'Usuario de Teste' },
  });

  await prisma.clinicMembership.create({
    data: { clinicId, userId, role },
  });

  const fixture: Fixture = { clinicId, userId, email, role };
  criadas.push(fixture);
  return fixture;
}

function corpoDe<T>(resposta: { json(): unknown }): T {
  return resposta.json() as T;
}

async function autenticar(app: App, fixture: Fixture): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: fixture.email, senha: 'Senha@123' },
  });

  expect(resposta.statusCode).toBe(200);
  return corpoDe<{ accessToken: string }>(resposta).accessToken;
}

function comToken(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

afterEach(async () => {
  const doTeste = criadas.splice(0, criadas.length);
  if (doTeste.length === 0) return;

  await prisma.clinic.deleteMany({ where: { id: { in: doTeste.map((f) => f.clinicId) } } });
  await prisma.user.deleteMany({ where: { id: { in: doTeste.map((f) => f.userId) } } });
});

afterAll(async () => {
  for (const app of apps) {
    await app.close();
  }
  await disconnectPrisma();
});

describe('clinica', () => {
  it('exige autenticacao', async () => {
    const app = await novaApp();
    const resposta = await app.inject({ method: 'GET', url: '/clinics/current' });
    expect(resposta.statusCode).toBe(401);
  });

  it('devolve o perfil da clinica da sessao', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const resposta = await app.inject({
      method: 'GET',
      url: '/clinics/current',
      headers: comToken(token),
    });

    expect(resposta.statusCode).toBe(200);
    expect(corpoDe<{ id: string }>(resposta).id).toBe(fixture.clinicId);
  });

  it('bloqueia escrita para quem nao e ADMIN', async () => {
    const app = await novaApp();
    const fixture = await criarFixture('PROFISSIONAL');
    const token = await autenticar(app, fixture);

    const resposta = await app.inject({
      method: 'PATCH',
      url: '/clinics/current',
      headers: comToken(token),
      payload: { name: 'Novo Nome' },
    });

    expect(resposta.statusCode).toBe(403);
  });

  it('atualiza campos e limpa opcionais com string vazia', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const editou = await app.inject({
      method: 'PATCH',
      url: '/clinics/current',
      headers: comToken(token),
      payload: { name: 'Clinica Renomeada', legalName: '', phone: '(11) 98888-7777' },
    });

    expect(editou.statusCode).toBe(200);
    const corpo = corpoDe<{ name: string; legalName: string | null; phone: string | null }>(editou);
    expect(corpo.name).toBe('Clinica Renomeada');
    expect(corpo.legalName).toBeNull();
    expect(corpo.phone).toBe('5511988887777');
  });
});

describe('salas', () => {
  it('cria, recusa duplicado e desativa logicamente', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const criou = await app.inject({
      method: 'POST',
      url: '/clinics/current/rooms',
      headers: comToken(token),
      payload: { name: 'Sala 1' },
    });
    expect(criou.statusCode).toBe(201);
    const sala = corpoDe<{ id: string }>(criou);

    const duplicou = await app.inject({
      method: 'POST',
      url: '/clinics/current/rooms',
      headers: comToken(token),
      payload: { name: 'Sala 1' },
    });
    expect(duplicou.statusCode).toBe(409);

    const apagou = await app.inject({
      method: 'DELETE',
      url: `/clinics/current/rooms/${sala.id}`,
      headers: comToken(token),
    });
    expect(apagou.statusCode).toBe(204);

    const lista = await app.inject({
      method: 'GET',
      url: '/clinics/current/rooms',
      headers: comToken(token),
    });
    expect(corpoDe<{ items: unknown[] }>(lista).items).toHaveLength(0);
  });

  it('nao altera sala de outra clinica', async () => {
    const app = await novaApp();
    const dona = await criarFixture();
    const intrusa = await criarFixture();
    const tokenIntruso = await autenticar(app, intrusa);

    const criou = await app.inject({
      method: 'POST',
      url: '/clinics/current/rooms',
      headers: comToken(await autenticar(app, dona)),
      payload: { name: 'Sala da Dona' },
    });
    const sala = corpoDe<{ id: string }>(criou);

    const tentou = await app.inject({
      method: 'PATCH',
      url: `/clinics/current/rooms/${sala.id}`,
      headers: comToken(tokenIntruso),
      payload: { name: 'Invadida' },
    });

    expect(tentou.statusCode).toBe(404);
  });
});

describe('terapias', () => {
  it('cria derivando o slug do nome e lista', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const criou = await app.inject({
      method: 'POST',
      url: '/therapies',
      headers: comToken(token),
      payload: { name: 'Drenagem Linfatica', priceCents: 15000 },
    });

    expect(criou.statusCode).toBe(201);
    const terapia = corpoDe<{ id: string; slug: string; durationMinutes: number }>(criou);
    expect(terapia.slug).toBe('drenagem-linfatica');
    expect(terapia.durationMinutes).toBe(60);

    const lista = await app.inject({
      method: 'GET',
      url: '/therapies',
      headers: comToken(token),
    });
    expect(corpoDe<{ items: unknown[] }>(lista).items).toHaveLength(1);
  });

  it('rejeita payload invalido com 422', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const resposta = await app.inject({
      method: 'POST',
      url: '/therapies',
      headers: comToken(token),
      payload: { name: 'X', priceCents: -1, durationMinutes: 2 },
    });

    expect(resposta.statusCode).toBe(422);
  });

  it('atualiza preco e limpa a descricao', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const criou = await app.inject({
      method: 'POST',
      url: '/therapies',
      headers: comToken(token),
      payload: { name: 'Massagem Relaxante', priceCents: 10000, description: 'Relaxa' },
    });
    const terapia = corpoDe<{ id: string }>(criou);

    const editou = await app.inject({
      method: 'PATCH',
      url: `/therapies/${terapia.id}`,
      headers: comToken(token),
      payload: { description: '', priceCents: 12000 },
    });

    expect(editou.statusCode).toBe(200);
    const corpo = corpoDe<{ description: string | null; priceCents: number }>(editou);
    expect(corpo.description).toBeNull();
    expect(corpo.priceCents).toBe(12000);
  });
});

describe('profissionais', () => {
  it('cria com terapias habilitadas e devolve os ids', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const terapia = corpoDe<{ id: string }>(
      await app.inject({
        method: 'POST',
        url: '/therapies',
        headers: comToken(token),
        payload: { name: 'Shiatsu', priceCents: 18000 },
      }),
    );

    const criou = await app.inject({
      method: 'POST',
      url: '/professionals',
      headers: comToken(token),
      payload: { name: 'Ana Profissional', therapyIds: [terapia.id] },
    });

    expect(criou.statusCode).toBe(201);
    expect(corpoDe<{ therapyIds: string[] }>(criou).therapyIds).toEqual([terapia.id]);
  });

  it('recusa terapia de outra clinica', async () => {
    const app = await novaApp();
    const dona = await criarFixture();
    const vizinha = await criarFixture();
    const tokenVizinha = await autenticar(app, vizinha);

    const terapia = corpoDe<{ id: string }>(
      await app.inject({
        method: 'POST',
        url: '/therapies',
        headers: comToken(await autenticar(app, dona)),
        payload: { name: 'Terapia da Dona', priceCents: 9000 },
      }),
    );

    const tentou = await app.inject({
      method: 'POST',
      url: '/professionals',
      headers: comToken(tokenVizinha),
      payload: { name: 'Profissional Vizinha', therapyIds: [terapia.id] },
    });

    expect(tentou.statusCode).toBe(400);
  });
});

describe('clientes', () => {
  it('normaliza cpf e telefone e devolve birthDate como data', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const criou = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: comToken(token),
      payload: {
        name: 'Joao da Silva',
        cpf: '529.982.247-25',
        phone: '(11) 98888-7777',
        birthDate: '1990-05-10',
      },
    });

    expect(criou.statusCode).toBe(201);
    const cliente = corpoDe<{ cpf: string; phone: string; birthDate: string }>(criou);
    expect(cliente.cpf).toBe('52998224725');
    expect(cliente.phone).toBe('5511988887777');
    expect(cliente.birthDate).toBe('1990-05-10');
  });

  it('recusa cpf repetido na mesma clinica', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const corpo = { name: 'Maria', cpf: '52998224725' };
    await app.inject({ method: 'POST', url: '/clients', headers: comToken(token), payload: corpo });

    const repetiu = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: comToken(token),
      payload: { name: 'Maria 2', cpf: '52998224725' },
    });

    expect(repetiu.statusCode).toBe(409);
  });

  it('busca ignorando acento e caixa', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    await app.inject({
      method: 'POST',
      url: '/clients',
      headers: comToken(token),
      payload: { name: 'Jose Antonio' },
    });

    const busca = await app.inject({
      method: 'GET',
      url: '/clients?search=jose',
      headers: comToken(token),
    });

    expect(corpoDe<{ items: Array<{ name: string }> }>(busca).items[0]?.name).toBe('Jose Antonio');
  });

  it('nao entrega cliente de outra clinica', async () => {
    const app = await novaApp();
    const dona = await criarFixture();
    const intrusa = await criarFixture();

    const cliente = corpoDe<{ id: string }>(
      await app.inject({
        method: 'POST',
        url: '/clients',
        headers: comToken(await autenticar(app, dona)),
        payload: { name: 'Cliente da Dona' },
      }),
    );

    const tentou = await app.inject({
      method: 'GET',
      url: `/clients/${cliente.id}`,
      headers: comToken(await autenticar(app, intrusa)),
    });

    expect(tentou.statusCode).toBe(404);
  });
});
