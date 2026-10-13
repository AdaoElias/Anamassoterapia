import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import type { Role } from '../src/generated/prisma/enums.js';
import { disconnectPrisma, prisma } from '../src/lib/prisma.js';

/**
 * `/users`: gestao de usuarios e papeis da clinica.
 *
 * Roda contra o banco de teste, com fixtures pelo Prisma como `cadastros.test.ts`.
 * O login usa o stub de senha (HASH_FIXTURE); o convite, porem, paga o Argon2
 * real, porque a senha aleatoria nasce dentro da rota.
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

/** Fixtures a drenar: clinicas em cascata; usuarios de convite sao avulsos. */
const criadas: Fixture[] = [];
/** Ids de usuarios que o convite criou (nao vem de fixture previa). */
const usuariosCriados: string[] = [];

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
  await prisma.clinicMembership.create({ data: { clinicId, userId, role } });

  const fixture: Fixture = { clinicId, userId, email, role };
  criadas.push(fixture);
  return fixture;
}

/** Cria usuario + membership dentro de uma clinica ja existente. */
async function adicionarMembro(clinicId: string, role: Role): Promise<Fixture> {
  const userId = randomUUID();
  const email = `${randomUUID()}@teste.local`;

  await prisma.user.create({
    data: { id: userId, email, passwordHash: HASH_FIXTURE, name: 'Membro de Teste' },
  });
  await prisma.clinicMembership.create({ data: { clinicId, userId, role } });

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

interface MembroJson {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
}

afterEach(async () => {
  const usuarios = usuariosCriados.splice(0, usuariosCriados.length);
  const doTeste = criadas.splice(0, criadas.length);

  if (doTeste.length > 0) {
    await prisma.clinic.deleteMany({ where: { id: { in: doTeste.map((f) => f.clinicId) } } });
    await prisma.user.deleteMany({ where: { id: { in: doTeste.map((f) => f.userId) } } });
  }
  if (usuarios.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  }
});

afterAll(async () => {
  for (const app of apps) await app.close();
  await disconnectPrisma();
});

describe('GET /users', () => {
  it('lista a propria membership como ADMIN', async () => {
    const app = await novaApp();
    const admin = await criarFixture('ADMIN');
    const token = await autenticar(app, admin);

    const resposta = await app.inject({ method: 'GET', url: '/users', headers: comToken(token) });

    expect(resposta.statusCode).toBe(200);
    const corpo = corpoDe<{ items: MembroJson[] }>(resposta);
    expect(corpo.items.some((m) => m.userId === admin.userId && m.role === 'ADMIN')).toBe(true);
  });

  it('recusa PROFISSIONAL com 403', async () => {
    const app = await novaApp();
    const profissional = await criarFixture('PROFISSIONAL');
    const token = await autenticar(app, profissional);

    const resposta = await app.inject({ method: 'GET', url: '/users', headers: comToken(token) });

    expect(resposta.statusCode).toBe(403);
  });
});

describe('POST /users/invites', () => {
  it('cria usuario, membership e token de definicao de senha', async () => {
    const app = await novaApp();
    const admin = await criarFixture('ADMIN');
    const token = await autenticar(app, admin);
    const email = `${randomUUID()}@teste.local`;

    const resposta = await app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: comToken(token),
      payload: { name: 'Nova Pessoa', email },
    });

    expect(resposta.statusCode).toBe(201);
    const corpo = corpoDe<{ membership: MembroJson; inviteLink: string | null }>(resposta);
    expect(corpo.membership.email).toBe(email);
    expect(corpo.membership.role).toBe('PROFISSIONAL');
    expect(corpo.membership.lastLoginAt).toBeNull();
    expect(corpo.inviteLink).toContain('/redefinir-senha?token=');

    usuariosCriados.push(corpo.membership.userId);

    // O convite e um PasswordResetToken sem uso para o usuario recem-criado.
    const tokens = await prisma.passwordResetToken.count({
      where: { userId: corpo.membership.userId, usedAt: null },
    });
    expect(tokens).toBe(1);
  });

  it('reaproveita o User existente em vez de duplicar', async () => {
    const app = await novaApp();
    const admin = await criarFixture('ADMIN');
    const token = await autenticar(app, admin);

    const resposta = await app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: comToken(token),
      payload: { name: 'Ignorado', email: admin.email, role: 'PROFISSIONAL' },
    });

    expect(resposta.statusCode).toBe(201);
    const corpo = corpoDe<{ membership: MembroJson }>(resposta);
    expect(corpo.membership.userId).toBe(admin.userId);

    const total = await prisma.user.count({ where: { email: admin.email } });
    expect(total).toBe(1);
  });

  it('recusa convite duplicado com 409', async () => {
    const app = await novaApp();
    const admin = await criarFixture('ADMIN');
    const token = await autenticar(app, admin);
    const email = `${randomUUID()}@teste.local`;

    const primeiro = await app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: comToken(token),
      payload: { name: 'Pessoa', email, role: 'PROFISSIONAL' },
    });
    expect(primeiro.statusCode).toBe(201);
    usuariosCriados.push(corpoDe<{ membership: MembroJson }>(primeiro).membership.userId);

    const segundo = await app.inject({
      method: 'POST',
      url: '/users/invites',
      headers: comToken(token),
      payload: { name: 'Pessoa', email, role: 'PROFISSIONAL' },
    });
    expect(segundo.statusCode).toBe(409);
  });
});

describe('PATCH /users/:id', () => {
  it('promove um PROFISSIONAL a ADMIN', async () => {
    const app = await novaApp();
    const admin = await criarFixture('ADMIN');
    const profissional = await adicionarMembro(admin.clinicId, 'PROFISSIONAL');
    const token = await autenticar(app, admin);

    const membro = await prisma.clinicMembership.findFirstOrThrow({
      where: { clinicId: profissional.clinicId, userId: profissional.userId },
      select: { id: true },
    });

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/users/${membro.id}`,
      headers: comToken(token),
      payload: { role: 'ADMIN', jobTitle: 'Coordenacao' },
    });

    expect(resposta.statusCode).toBe(200);
    const corpo = corpoDe<MembroJson & { jobTitle: string | null }>(resposta);
    expect(corpo.role).toBe('ADMIN');
    expect(corpo.jobTitle).toBe('Coordenacao');
  });

  it('protege o ultimo administrador ativo', async () => {
    const app = await novaApp();
    const admin = await criarFixture('ADMIN');
    const token = await autenticar(app, admin);

    const membro = await prisma.clinicMembership.findFirstOrThrow({
      where: { clinicId: admin.clinicId, userId: admin.userId },
      select: { id: true },
    });

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/users/${membro.id}`,
      headers: comToken(token),
      payload: { active: false },
    });

    expect(resposta.statusCode).toBe(409);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('LAST_ADMIN');
  });

  it('isola o tenant: membership de outra clinica da 404', async () => {
    const app = await novaApp();
    const admin = await criarFixture('ADMIN');
    const outra = await criarFixture('ADMIN');
    const token = await autenticar(app, admin);

    const membroOutra = await prisma.clinicMembership.findFirstOrThrow({
      where: { clinicId: outra.clinicId, userId: outra.userId },
      select: { id: true },
    });

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/users/${membroOutra.id}`,
      headers: comToken(token),
      payload: { jobTitle: 'X' },
    });

    expect(resposta.statusCode).toBe(404);
  });
});

describe('DELETE /users/:id', () => {
  it('desativa a membership e some da lista padrao', async () => {
    const app = await novaApp();
    const admin = await criarFixture('ADMIN');
    const profissional = await adicionarMembro(admin.clinicId, 'PROFISSIONAL');
    const token = await autenticar(app, admin);

    const membro = await prisma.clinicMembership.findFirstOrThrow({
      where: { clinicId: profissional.clinicId, userId: profissional.userId },
      select: { id: true },
    });

    const resposta = await app.inject({
      method: 'DELETE',
      url: `/users/${membro.id}`,
      headers: comToken(token),
    });
    expect(resposta.statusCode).toBe(204);

    const padrao = await app.inject({ method: 'GET', url: '/users', headers: comToken(token) });
    const visiveis = corpoDe<{ items: MembroJson[] }>(padrao).items;
    expect(visiveis.some((m) => m.id === membro.id)).toBe(false);

    const comInativos = await app.inject({
      method: 'GET',
      url: '/users?includeInactive=true',
      headers: comToken(token),
    });
    const todos = corpoDe<{ items: MembroJson[] }>(comInativos).items;
    const alvo = todos.find((m) => m.id === membro.id);
    expect(alvo?.active).toBe(false);
  });
});
