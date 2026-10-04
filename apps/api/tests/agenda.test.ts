import { randomUUID } from 'node:crypto';

import { diaDaSemanaDaData, parseDataLocal, utcDeLocal } from '@massoterapia/shared';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import type { Role } from '../src/generated/prisma/enums.js';
import { disconnectPrisma, prisma } from '../src/lib/prisma.js';

/**
 * Disponibilidade e agenda contra o banco de teste.
 *
 * O motor de slots tem teste proprio e puro; aqui o alvo sao as rotas: o
 * filtro por clinica, os codigos HTTP e a integracao com a constraint de
 * exclusao do Postgres (que vira 409).
 */

const TZ = 'America/Sao_Paulo';
const HASH_FIXTURE = '$argon2id$v=19$m=19456,t=2,p=1$c2VudG8$hash';

/** Data futura e distante, para nao esbarrar no relogio real. */
const DIA = '2099-01-05';
const DOW = diaDaSemanaDaData(DIA);

const senhaCorreta = (hashGuardado: string, senha: string): Promise<boolean> =>
  Promise.resolve(senha === 'Senha@123' && hashGuardado === HASH_FIXTURE);

const apps: App[] = [];

interface Cenario {
  clinicId: string;
  userId: string;
  email: string;
  role: Role;
  professionalId: string;
  clientId: string;
  therapyId: string;
}

const criadas: Cenario[] = [];

async function novaApp(): Promise<App> {
  const app = await buildApp({ verificarSenha: senhaCorreta });
  await app.ready();
  apps.push(app);
  return app;
}

async function criarCenario(role: Role = 'ADMIN'): Promise<Cenario> {
  const clinicId = randomUUID();
  const userId = randomUUID();
  const email = `${randomUUID()}@teste.local`;
  const professionalId = randomUUID();
  const clientId = randomUUID();
  const therapyId = randomUUID();
  const sufixo = clinicId.slice(0, 8);

  await prisma.clinic.create({
    data: { id: clinicId, name: 'Clinica de Teste', slug: `clinica-${sufixo}` },
  });
  await prisma.user.create({
    data: { id: userId, email, passwordHash: HASH_FIXTURE, name: 'Usuario de Teste' },
  });
  await prisma.clinicMembership.create({ data: { clinicId, userId, role } });
  await prisma.professional.create({
    data: { id: professionalId, clinicId, name: 'Profissional de Teste' },
  });
  await prisma.client.create({
    data: { id: clientId, clinicId, name: 'Cliente de Teste' },
  });
  await prisma.therapy.create({
    data: {
      id: therapyId,
      clinicId,
      name: 'Massagem Relaxante',
      slug: `relaxante-${sufixo}`,
      durationMinutes: 60,
      priceCents: 12_000,
      minNoticeMinutes: 0,
    },
  });
  await prisma.therapyProfessional.create({ data: { clinicId, therapyId, professionalId } });

  const cenario: Cenario = {
    clinicId,
    userId,
    email,
    role,
    professionalId,
    clientId,
    therapyId,
  };
  criadas.push(cenario);
  return cenario;
}

async function criarRegra(
  cenario: Cenario,
  overrides: Partial<{
    startMinute: number;
    endMinute: number;
    slotGranularityMinutes: number;
  }> = {},
): Promise<string> {
  const regra = await prisma.availabilityRule.create({
    data: {
      clinicId: cenario.clinicId,
      professionalId: cenario.professionalId,
      weekday: DOW,
      startMinute: overrides.startMinute ?? 9 * 60,
      endMinute: overrides.endMinute ?? 12 * 60,
      slotGranularityMinutes: overrides.slotGranularityMinutes ?? 60,
      effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    },
  });
  return regra.id;
}

function corpoDe<T>(resposta: { json(): unknown }): T {
  return resposta.json() as T;
}

async function autenticar(app: App, cenario: Cenario): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: cenario.email, senha: 'Senha@123' },
  });
  expect(resposta.statusCode).toBe(200);
  return corpoDe<{ accessToken: string }>(resposta).accessToken;
}

function comToken(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function localHora(hora: number): string {
  return utcDeLocal({ ...parseDataLocal(DIA), hour: hora, minute: 0 }, TZ).toISOString();
}

async function criarSessao(
  app: App,
  token: string,
  cenario: Cenario,
  startAt: string,
): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/appointments',
    headers: comToken(token),
    payload: {
      clientId: cenario.clientId,
      professionalId: cenario.professionalId,
      therapyId: cenario.therapyId,
      startAt,
    },
  });
  expect(resposta.statusCode).toBe(201);
  return corpoDe<{ id: string }>(resposta).id;
}

afterEach(async () => {
  const doTeste = criadas.splice(0, criadas.length);
  if (doTeste.length === 0) return;

  // Sessoes antes da clinica: a FK de cliente/profissional para agendamento
  // e RESTRICT e a ordem dos cascades do Postgres nao e garantida.
  await prisma.appointment.deleteMany({
    where: { clinicId: { in: doTeste.map((c) => c.clinicId) } },
  });
  await prisma.clinic.deleteMany({ where: { id: { in: doTeste.map((c) => c.clinicId) } } });
  await prisma.user.deleteMany({ where: { id: { in: doTeste.map((c) => c.userId) } } });
});

afterAll(async () => {
  for (const app of apps) {
    await app.close();
  }
  await disconnectPrisma();
});

describe('disponibilidade', () => {
  it('exige autenticacao', async () => {
    const app = await novaApp();
    const resposta = await app.inject({
      method: 'GET',
      url: '/availability/rules?professionalId=00000000-0000-0000-0000-000000000000',
    });
    expect(resposta.statusCode).toBe(401);
  });

  it('cria, lista, atualiza e desativa uma regra', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    const token = await autenticar(app, cenario);

    const criacao = await app.inject({
      method: 'POST',
      url: '/availability/rules',
      headers: comToken(token),
      payload: {
        professionalId: cenario.professionalId,
        weekday: DOW,
        startMinute: 9 * 60,
        endMinute: 12 * 60,
        slotGranularityMinutes: 45,
        effectiveFrom: '2099-01-01',
      },
    });
    expect(criacao.statusCode).toBe(201);
    const criada = corpoDe<{ id: string; slotGranularityMinutes: number }>(criacao);
    expect(criada.slotGranularityMinutes).toBe(45);

    const listagem = await app.inject({
      method: 'GET',
      url: `/availability/rules?professionalId=${cenario.professionalId}`,
      headers: comToken(token),
    });
    expect(corpoDe<{ items: unknown[] }>(listagem).items).toHaveLength(1);

    const atualizacao = await app.inject({
      method: 'PATCH',
      url: `/availability/rules/${criada.id}`,
      headers: comToken(token),
      payload: { endMinute: 11 * 60 },
    });
    expect(atualizacao.statusCode).toBe(200);
    expect(corpoDe<{ endMinute: number }>(atualizacao).endMinute).toBe(11 * 60);

    const remocao = await app.inject({
      method: 'DELETE',
      url: `/availability/rules/${criada.id}`,
      headers: comToken(token),
    });
    expect(remocao.statusCode).toBe(204);
  });

  it('recusa regra invertida com 422', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    const token = await autenticar(app, cenario);

    const resposta = await app.inject({
      method: 'POST',
      url: '/availability/rules',
      headers: comToken(token),
      payload: {
        professionalId: cenario.professionalId,
        weekday: DOW,
        startMinute: 12 * 60,
        endMinute: 9 * 60,
        effectiveFrom: '2099-01-01',
      },
    });
    expect(resposta.statusCode).toBe(422);
  });

  it('bloqueia escrita para quem nao e ADMIN', async () => {
    const app = await novaApp();
    const cenario = await criarCenario('PROFISSIONAL');
    const token = await autenticar(app, cenario);

    const resposta = await app.inject({
      method: 'POST',
      url: '/availability/rules',
      headers: comToken(token),
      payload: {
        professionalId: cenario.professionalId,
        weekday: DOW,
        startMinute: 9 * 60,
        endMinute: 12 * 60,
        effectiveFrom: '2099-01-01',
      },
    });
    expect(resposta.statusCode).toBe(403);
  });

  it('nao deixa usar profissional de outra clinica', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    const outro = await criarCenario();
    const token = await autenticar(app, cenario);

    const resposta = await app.inject({
      method: 'GET',
      url: `/availability/rules?professionalId=${outro.professionalId}`,
      headers: comToken(token),
    });
    expect(resposta.statusCode).toBe(404);
  });

  it('recusa feriado duplicado', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    const token = await autenticar(app, cenario);
    const payload = { date: DIA, description: 'Feriado da casa' };

    const primeira = await app.inject({
      method: 'POST',
      url: '/availability/holidays',
      headers: comToken(token),
      payload,
    });
    expect(primeira.statusCode).toBe(201);

    const segunda = await app.inject({
      method: 'POST',
      url: '/availability/holidays',
      headers: comToken(token),
      payload,
    });
    expect(segunda.statusCode).toBe(409);
  });
});

describe('slots', () => {
  it('calcula os horarios livres do profissional', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    await criarRegra(cenario);
    const token = await autenticar(app, cenario);

    const resposta = await app.inject({
      method: 'GET',
      url: `/appointments/slots?therapyId=${cenario.therapyId}&from=${DIA}&to=${DIA}`,
      headers: comToken(token),
    });

    expect(resposta.statusCode).toBe(200);
    const itens = corpoDe<{ items: Array<{ startAt: string }> }>(resposta).items;
    expect(itens.map((item) => item.startAt)).toEqual([localHora(9), localHora(10), localHora(11)]);
  });

  it('remove o horario ja reservado', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    await criarRegra(cenario);
    const token = await autenticar(app, cenario);
    await criarSessao(app, token, cenario, localHora(10));

    const resposta = await app.inject({
      method: 'GET',
      url: `/appointments/slots?therapyId=${cenario.therapyId}&from=${DIA}&to=${DIA}`,
      headers: comToken(token),
    });

    const itens = corpoDe<{ items: Array<{ startAt: string }> }>(resposta).items;
    expect(itens.map((item) => item.startAt)).toEqual([localHora(9), localHora(11)]);
  });
});

describe('sessoes', () => {
  it('cria a sessao e a devolve na lista do dia', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    const token = await autenticar(app, cenario);

    const criacao = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: comToken(token),
      payload: {
        clientId: cenario.clientId,
        professionalId: cenario.professionalId,
        therapyId: cenario.therapyId,
        startAt: localHora(9),
      },
    });

    expect(criacao.statusCode).toBe(201);
    const agendamento = corpoDe<{
      id: string;
      status: string;
      source: string;
      priceCents: number;
      clientName: string;
    }>(criacao);
    expect(agendamento.status).toBe('AGENDADO_PENDENTE');
    expect(agendamento.source).toBe('ADMIN');
    expect(agendamento.priceCents).toBe(12_000);
    expect(agendamento.clientName).toBe('Cliente de Teste');

    const lista = await app.inject({
      method: 'GET',
      url: `/appointments?from=${DIA}&to=${DIA}`,
      headers: comToken(token),
    });
    expect(corpoDe<{ items: unknown[] }>(lista).items).toHaveLength(1);
  });

  it('devolve 409 para horario ocupado', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    const token = await autenticar(app, cenario);
    await criarSessao(app, token, cenario, localHora(9));

    const resposta = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: comToken(token),
      payload: {
        clientId: cenario.clientId,
        professionalId: cenario.professionalId,
        therapyId: cenario.therapyId,
        startAt: localHora(9),
      },
    });
    expect(resposta.statusCode).toBe(409);
  });

  it('confirma e registra o historico de status', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    const token = await autenticar(app, cenario);
    const id = await criarSessao(app, token, cenario, localHora(9));

    const confirmacao = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}/status`,
      headers: comToken(token),
      payload: { status: 'CONFIRMADO' },
    });
    expect(confirmacao.statusCode).toBe(200);
    expect(corpoDe<{ confirmedAt: string | null }>(confirmacao).confirmedAt).not.toBeNull();

    const historico = await prisma.appointmentStatusHistory.findMany({
      where: { appointmentId: id },
    });
    expect(historico.map((linha) => linha.toStatus)).toEqual(['AGENDADO_PENDENTE', 'CONFIRMADO']);
  });

  it('rejeita transicao de status invalida', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    const token = await autenticar(app, cenario);
    const id = await criarSessao(app, token, cenario, localHora(9));

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}/status`,
      headers: comToken(token),
      payload: { status: 'EM_ATENDIMENTO' },
    });
    expect(resposta.statusCode).toBe(422);
  });

  it('libera o horario ao cancelar', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    await criarRegra(cenario);
    const token = await autenticar(app, cenario);
    const id = await criarSessao(app, token, cenario, localHora(9));

    const cancelamento = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}/status`,
      headers: comToken(token),
      payload: { status: 'CANCELADO', cancellationReason: 'CLIENTE_DESISTIU' },
    });
    expect(cancelamento.statusCode).toBe(200);
    expect(corpoDe<{ cancelledAt: string | null }>(cancelamento).cancelledAt).not.toBeNull();

    const slots = await app.inject({
      method: 'GET',
      url: `/appointments/slots?therapyId=${cenario.therapyId}&from=${DIA}&to=${DIA}`,
      headers: comToken(token),
    });
    const itens = corpoDe<{ items: Array<{ startAt: string }> }>(slots).items;
    expect(itens.map((item) => item.startAt)).toContain(localHora(9));
  });

  it('detecta conflito ao remarcar', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    const token = await autenticar(app, cenario);
    const primeiro = await criarSessao(app, token, cenario, localHora(9));
    await criarSessao(app, token, cenario, localHora(10));

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/appointments/${primeiro}`,
      headers: comToken(token),
      payload: { startAt: localHora(10) },
    });
    expect(resposta.statusCode).toBe(409);
  });

  it('remarca para um horario livre', async () => {
    const app = await novaApp();
    const cenario = await criarCenario();
    const token = await autenticar(app, cenario);
    const id = await criarSessao(app, token, cenario, localHora(9));

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}`,
      headers: comToken(token),
      payload: { startAt: localHora(11) },
    });
    expect(resposta.statusCode).toBe(200);
    expect(corpoDe<{ startAt: string }>(resposta).startAt).toBe(localHora(11));
  });
});
