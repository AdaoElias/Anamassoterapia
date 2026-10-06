import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import type { Role } from '../src/generated/prisma/enums.js';
import { disconnectPrisma, prisma } from '../src/lib/prisma.js';

/**
 * Financeiro: lancamentos, pacotes, comissoes e resumo.
 *
 * Mesmo contrato de `cadastros.test.ts`: fixtures criadas via Prisma no banco
 * de teste, login real para exercitar `requireAuth`/`requireRole`, e a
 * limpeza por clinica (onDelete: Cascade) no afterEach.
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

async function criarCliente(clinicId: string, nome = 'Cliente de Teste'): Promise<string> {
  const cliente = await prisma.client.create({ data: { clinicId, name: nome } });
  return cliente.id;
}

async function criarProfissional(clinicId: string): Promise<string> {
  const profissional = await prisma.professional.create({
    data: { clinicId, name: 'Profissional de Teste' },
  });
  return profissional.id;
}

function diaUTC(offset: number, hora = 12): Date {
  const hoje = new Date();
  const dia = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  dia.setUTCDate(dia.getUTCDate() + offset);
  dia.setUTCHours(hora, 0, 0, 0);
  return dia;
}

function diaISO(offset: number): string {
  return diaUTC(offset, 0).toISOString().slice(0, 10);
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

describe('lancamentos', () => {
  it('exige autenticacao e bloqueia escrita para PROFISSIONAL', async () => {
    const app = await novaApp();
    const fixture = await criarFixture('PROFISSIONAL');
    const token = await autenticar(app, fixture);

    const semLogin = await app.inject({ method: 'GET', url: '/finance/lancamentos' });
    expect(semLogin.statusCode).toBe(401);

    const lendo = await app.inject({
      method: 'GET',
      url: '/finance/lancamentos',
      headers: comToken(token),
    });
    expect(lendo.statusCode).toBe(200);

    const escrevendo = await app.inject({
      method: 'POST',
      url: '/finance/lancamentos',
      headers: comToken(token),
      payload: { kind: 'RECEITA', amountCents: 1000, description: 'Sessao' },
    });
    expect(escrevendo.statusCode).toBe(403);
  });

  it('lanca como PENDENTE sem forma de pagamento e liquida depois', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const criado = await app.inject({
      method: 'POST',
      url: '/finance/lancamentos',
      headers: comToken(token),
      payload: {
        kind: 'RECEITA',
        amountCents: 12000,
        dueDate: diaISO(0),
        description: 'Sessao avulsa',
      },
    });
    expect(criado.statusCode).toBe(201);
    const lancamento = corpoDe<{ id: string; status: string; method: string | null }>(criado);
    expect(lancamento.status).toBe('PENDENTE');
    expect(lancamento.method).toBeNull();

    const liquidado = await app.inject({
      method: 'POST',
      url: `/finance/lancamentos/${lancamento.id}/pagar`,
      headers: comToken(token),
      payload: { method: 'PIX' },
    });
    expect(liquidado.statusCode).toBe(200);
    const pago = corpoDe<{ status: string; method: string; paidAt: string }>(liquidado);
    expect(pago.status).toBe('PAGO');
    expect(pago.method).toBe('PIX');
    expect(pago.paidAt).not.toBeNull();
  });

  it('lanca como PAGO com forma de pagamento e recusa pagar de novo', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const criado = await app.inject({
      method: 'POST',
      url: '/finance/lancamentos',
      headers: comToken(token),
      payload: { kind: 'RECEITA', amountCents: 8000, method: 'DINHEIRO', description: 'Avulso' },
    });
    const lancamento = corpoDe<{ id: string; status: string }>(criado);
    expect(lancamento.status).toBe('PAGO');

    const deNovo = await app.inject({
      method: 'POST',
      url: `/finance/lancamentos/${lancamento.id}/pagar`,
      headers: comToken(token),
      payload: { method: 'PIX' },
    });
    expect(deNovo.statusCode).toBe(422);
  });

  it('cancela apenas pendente e e idempotente via chave', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);

    const chave = randomUUID();
    const criou = await app.inject({
      method: 'POST',
      url: '/finance/lancamentos',
      headers: comToken(token),
      payload: { kind: 'RECEITA', amountCents: 5000, idempotencyKey: chave },
    });
    expect(criou.statusCode).toBe(201);

    const repetiu = await app.inject({
      method: 'POST',
      url: '/finance/lancamentos',
      headers: comToken(token),
      payload: { kind: 'RECEITA', amountCents: 5000, idempotencyKey: chave },
    });
    expect(repetiu.statusCode).toBe(409);

    const lancamento = corpoDe<{ id: string }>(criou);
    const cancelou = await app.inject({
      method: 'POST',
      url: `/finance/lancamentos/${lancamento.id}/cancelar`,
      headers: comToken(token),
      payload: {},
    });
    expect(cancelou.statusCode).toBe(200);
    expect(corpoDe<{ status: string }>(cancelou).status).toBe('CANCELADO');

    const deNovo = await app.inject({
      method: 'POST',
      url: `/finance/lancamentos/${lancamento.id}/cancelar`,
      headers: comToken(token),
      payload: {},
    });
    expect(deNovo.statusCode).toBe(422);
  });

  it('nao deixa outra clinica mexer no lancamento', async () => {
    const app = await novaApp();
    const dona = await criarFixture();
    const intrusa = await criarFixture();

    const criado = await app.inject({
      method: 'POST',
      url: '/finance/lancamentos',
      headers: comToken(await autenticar(app, dona)),
      payload: { kind: 'RECEITA', amountCents: 3000 },
    });
    const lancamento = corpoDe<{ id: string }>(criado);

    const tentou = await app.inject({
      method: 'POST',
      url: `/finance/lancamentos/${lancamento.id}/pagar`,
      headers: comToken(await autenticar(app, intrusa)),
      payload: { method: 'PIX' },
    });
    expect(tentou.statusCode).toBe(404);
  });
});

describe('pacotes', () => {
  it('cria pacote gerando sessoes e receita paga quando ha pagamento', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);
    const clienteId = await criarCliente(fixture.clinicId);

    const criado = await app.inject({
      method: 'POST',
      url: '/finance/pacotes',
      headers: comToken(token),
      payload: {
        clientId: clienteId,
        name: 'Relaxante 5x',
        totalSessions: 5,
        priceCents: 54000,
        validFrom: diaISO(0),
        validUntil: diaISO(90),
        payment: { method: 'PIX' },
      },
    });

    expect(criado.statusCode).toBe(201);
    const pacote = corpoDe<{
      id: string;
      status: string;
      totalSessions: number;
      sessoesUsadas: number;
      sessoesRestantes: number;
    }>(criado);
    expect(pacote.status).toBe('ATIVO');
    expect(pacote.totalSessions).toBe(5);
    expect(pacote.sessoesUsadas).toBe(0);
    expect(pacote.sessoesRestantes).toBe(5);

    const lista = await app.inject({
      method: 'GET',
      url: '/finance/lancamentos',
      headers: comToken(token),
    });
    const entradas = corpoDe<{
      items: Array<{ packageId: string | null; status: string; kind: string }>;
    }>(lista).items;
    const receita = entradas.find((entrada) => entrada.packageId === pacote.id);
    expect(receita?.kind).toBe('RECEITA');
    expect(receita?.status).toBe('PAGO');
  });

  it('cria receita a receber quando nao ha pagamento e recusa nome duplicado', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);
    const clienteId = await criarCliente(fixture.clinicId);

    const corpo = {
      clientId: clienteId,
      name: 'Relaxante 5x',
      totalSessions: 5,
      priceCents: 54000,
      validFrom: diaISO(0),
      validUntil: diaISO(90),
    };

    const criou = await app.inject({
      method: 'POST',
      url: '/finance/pacotes',
      headers: comToken(token),
      payload: corpo,
    });
    expect(criou.statusCode).toBe(201);
    const pacote = corpoDe<{ id: string }>(criou);

    const duplicou = await app.inject({
      method: 'POST',
      url: '/finance/pacotes',
      headers: comToken(token),
      payload: corpo,
    });
    expect(duplicou.statusCode).toBe(409);

    const lista = await app.inject({
      method: 'GET',
      url: '/finance/lancamentos',
      headers: comToken(token),
    });
    const receita = corpoDe<{ items: Array<{ packageId: string | null; status: string }> }>(
      lista,
    ).items.find((entrada) => entrada.packageId === pacote.id);
    expect(receita?.status).toBe('PENDENTE');
  });

  it('consome e devolve sessoes, e so conclui com saldo zerado', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);
    const clienteId = await criarCliente(fixture.clinicId);

    const criado = await app.inject({
      method: 'POST',
      url: '/finance/pacotes',
      headers: comToken(token),
      payload: {
        clientId: clienteId,
        name: 'Dupla',
        totalSessions: 2,
        priceCents: 20000,
        validFrom: diaISO(0),
        validUntil: diaISO(30),
      },
    });
    const pacote = corpoDe<{ id: string }>(criado);

    const detalhe = await app.inject({
      method: 'GET',
      url: `/finance/pacotes/${pacote.id}`,
      headers: comToken(token),
    });
    const sessao = corpoDe<{ sessions: Array<{ id: string; status: string }> }>(detalhe)
      .sessions[0];
    if (sessao === undefined) throw new Error('pacote deveria ter sessoes');

    const usada = await app.inject({
      method: 'POST',
      url: `/finance/pacotes/${pacote.id}/sessoes/${sessao.id}/usar`,
      headers: comToken(token),
    });
    expect(usada.statusCode).toBe(200);
    expect(corpoDe<{ sessoesUsadas: number; sessoesRestantes: number }>(usada).sessoesUsadas).toBe(
      1,
    );

    const usadaDeNovo = await app.inject({
      method: 'POST',
      url: `/finance/pacotes/${pacote.id}/sessoes/${sessao.id}/usar`,
      headers: comToken(token),
    });
    expect(usadaDeNovo.statusCode).toBe(422);

    const devolvida = await app.inject({
      method: 'POST',
      url: `/finance/pacotes/${pacote.id}/sessoes/${sessao.id}/disponibilizar`,
      headers: comToken(token),
    });
    expect(devolvida.statusCode).toBe(200);
    expect(corpoDe<{ sessoesRestantes: number }>(devolvida).sessoesRestantes).toBe(2);

    const concluiuAntes = await app.inject({
      method: 'POST',
      url: `/finance/pacotes/${pacote.id}/status`,
      headers: comToken(token),
      payload: { status: 'CONCLUIDO' },
    });
    expect(concluiuAntes.statusCode).toBe(422);
  });

  it('nao entrega pacote de outra clinica', async () => {
    const app = await novaApp();
    const dona = await criarFixture();
    const intrusa = await criarFixture();
    const clienteId = await criarCliente(dona.clinicId);

    const criado = await app.inject({
      method: 'POST',
      url: '/finance/pacotes',
      headers: comToken(await autenticar(app, dona)),
      payload: {
        clientId: clienteId,
        name: 'Pacote da Dona',
        totalSessions: 3,
        priceCents: 30000,
        validFrom: diaISO(0),
        validUntil: diaISO(30),
      },
    });
    const pacote = corpoDe<{ id: string }>(criado);

    const tentou = await app.inject({
      method: 'GET',
      url: `/finance/pacotes/${pacote.id}`,
      headers: comToken(await autenticar(app, intrusa)),
    });
    expect(tentou.statusCode).toBe(404);
  });
});

describe('comissoes', () => {
  it('aprova, paga e recusa transicoes indevidas', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);
    const professionalId = await criarProfissional(fixture.clinicId);

    const comissao = await prisma.commission.create({
      data: {
        clinicId: fixture.clinicId,
        professionalId,
        baseAmountCents: 54000,
        percentBasisPoints: 3000,
        amountCents: 1620,
        status: 'PREVISTA',
        periodStart: diaUTC(-30, 0),
        periodEnd: diaUTC(0, 0),
      },
    });

    const listou = await app.inject({
      method: 'GET',
      url: '/finance/comissoes',
      headers: comToken(token),
    });
    expect(listou.statusCode).toBe(200);
    expect(corpoDe<{ items: Array<{ id: string }> }>(listou).items).toHaveLength(1);

    const aprovada = await app.inject({
      method: 'POST',
      url: `/finance/comissoes/${comissao.id}/aprovar`,
      headers: comToken(token),
    });
    expect(aprovada.statusCode).toBe(200);
    expect(corpoDe<{ status: string }>(aprovada).status).toBe('APROVADA');

    const pagou = await app.inject({
      method: 'POST',
      url: `/finance/comissoes/${comissao.id}/pagar`,
      headers: comToken(token),
    });
    expect(pagou.statusCode).toBe(200);
    const paga = corpoDe<{ status: string; paidAt: string }>(pagou);
    expect(paga.status).toBe('PAGA');
    expect(paga.paidAt).not.toBeNull();

    const cancelouDepois = await app.inject({
      method: 'POST',
      url: `/finance/comissoes/${comissao.id}/cancelar`,
      headers: comToken(token),
    });
    expect(cancelouDepois.statusCode).toBe(422);
  });

  it('cancela prevista e bloqueia escrita para PROFISSIONAL', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);
    const professionalId = await criarProfissional(fixture.clinicId);

    const comissao = await prisma.commission.create({
      data: {
        clinicId: fixture.clinicId,
        professionalId,
        baseAmountCents: 10000,
        percentBasisPoints: 3000,
        amountCents: 300,
        status: 'PREVISTA',
        periodStart: diaUTC(-30, 0),
        periodEnd: diaUTC(0, 0),
      },
    });

    const cancelada = await app.inject({
      method: 'POST',
      url: `/finance/comissoes/${comissao.id}/cancelar`,
      headers: comToken(token),
    });
    expect(cancelada.statusCode).toBe(200);
    expect(corpoDe<{ status: string }>(cancelada).status).toBe('CANCELADA');

    const profissional = await criarFixture('PROFISSIONAL');
    const tokenProfissional = await autenticar(app, profissional);
    const outra = await prisma.commission.create({
      data: {
        clinicId: profissional.clinicId,
        professionalId: await criarProfissional(profissional.clinicId),
        baseAmountCents: 10000,
        percentBasisPoints: 3000,
        amountCents: 300,
        status: 'PREVISTA',
        periodStart: diaUTC(-30, 0),
        periodEnd: diaUTC(0, 0),
      },
    });

    const tentou = await app.inject({
      method: 'POST',
      url: `/finance/comissoes/${outra.id}/aprovar`,
      headers: comToken(tokenProfissional),
    });
    expect(tentou.statusCode).toBe(403);
  });
});

describe('resumo', () => {
  it('soma recebido, despesas, a receber e vencido no periodo', async () => {
    const app = await novaApp();
    const fixture = await criarFixture();
    const token = await autenticar(app, fixture);
    const clienteId = await criarCliente(fixture.clinicId);

    const de = diaISO(-1);
    const ate = diaISO(30);

    // Recebida dentro do periodo.
    await app.inject({
      method: 'POST',
      url: '/finance/lancamentos',
      headers: comToken(token),
      payload: { kind: 'RECEITA', amountCents: 10000, method: 'PIX', description: 'Recebida' },
    });
    // Vencendo no periodo.
    await app.inject({
      method: 'POST',
      url: '/finance/lancamentos',
      headers: comToken(token),
      payload: {
        kind: 'RECEITA',
        amountCents: 5000,
        clientId: clienteId,
        dueDate: diaISO(0),
        description: 'Vence',
      },
    });
    // Vencido antes de hoje dentro do periodo (dueDate = de, antes do hoje).
    await app.inject({
      method: 'POST',
      url: '/finance/lancamentos',
      headers: comToken(token),
      payload: {
        kind: 'RECEITA',
        amountCents: 2500,
        clientId: clienteId,
        dueDate: de,
        description: 'Atrasado',
      },
    });
    // Despesa paga dentro do periodo.
    await app.inject({
      method: 'POST',
      url: '/finance/lancamentos',
      headers: comToken(token),
      payload: {
        kind: 'DESPESA',
        amountCents: 750,
        method: 'TRANSFERENCIA',
        description: 'Insulfilm',
      },
    });

    const resumo = await app.inject({
      method: 'GET',
      url: `/finance/resumo?de=${de}&ate=${ate}`,
      headers: comToken(token),
    });

    expect(resumo.statusCode).toBe(200);
    const corpo = corpoDe<{
      recebido: number;
      despesas: number;
      saldoPeriodo: number;
      aReceber: number;
      aReceberVencido: number;
    }>(resumo);

    // A receita "Recebida" nao tem dueDate; o resumo conta a receber pelo
    // vencimento, entao so entram as duas com dueDate no periodo.
    expect(corpo.recebido).toBe(10000);
    expect(corpo.despesas).toBe(750);
    expect(corpo.saldoPeriodo).toBe(9250);
    expect(corpo.aReceber).toBe(7500);
    expect(corpo.aReceberVencido).toBe(2500);
  });

  it('exige autenticacao', async () => {
    const app = await novaApp();
    const resposta = await app.inject({ method: 'GET', url: '/finance/resumo' });
    expect(resposta.statusCode).toBe(401);
  });
});
