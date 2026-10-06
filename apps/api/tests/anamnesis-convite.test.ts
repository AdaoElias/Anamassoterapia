import { createHash, randomUUID } from 'node:crypto';

import type { AnamnesisForm, AnamnesisPublicForm } from '@massoterapia/shared';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import { readAnamnesisAnswers } from '../src/lib/anamnesis-crypto.js';
import { disconnectPrisma, prisma } from '../src/lib/prisma.js';

/**
 * Link de anamnese respondida pelo cliente, sem login.
 *
 * Como nao existe sessao nestas rotas, o token do link e a credencial. Os
 * testes tentam quebrar, em ordem de importancia:
 *
 * 1. **O link vaza outra pessoa.** Um token de um cliente nao abre, nao salva e
 *    nao envia rascunho de outro, e nem de outra clinica.
 * 2. **O token volta do banco.** So o SHA-256 pode ser persistido; se a coluna
 *    guardasse o token em claro, o banco viraria a chave do prontuario.
 * 3. **O token e reusavel.** Depois do envio o link morre. E um link
 *    descartavel, nao uma sessao.
 * 4. **O banco vaza saude.** Nem o formulario aberto nem a listagem do painel
 *    trazem nome completo, cpf, telefone ou resposta em claro.
 * 5. **O erro distingue causas.** Token inexistente, expirado e consumido
 *    devolvem a mesma mensagem -- senao o link serve de oraculo para descobrir
 *    se um convite existiu.
 */

const HASH_FIXTURE = '$argon2id$v=19$m=19456,t=2,p=1$c2VudG8$hash';

const senhaCorreta = (hashGuardado: string, senha: string): Promise<boolean> =>
  Promise.resolve(senha === 'Senha@123' && hashGuardado === HASH_FIXTURE);

const apps: App[] = [];
const criadas: string[] = [];

const FORMULARIO: AnamnesisForm = {
  type: 'object',
  order: ['dor_principal', 'gestante', 'alergias'],
  required: ['dor_principal'],
  properties: {
    dor_principal: { type: 'string', title: 'Dor principal', maxLength: 120 },
    gestante: { type: 'boolean', title: 'Gestante' },
    alergias: { type: 'array', title: 'Alergias', enum: ['latex', 'iodo', 'oleo'], max: 3 },
  },
};

/** Resposta completa e valida, para os testes que nao olham a validacao. */
const RESPOSTAS = { dor_principal: 'Dor lombar ha 3 meses', gestante: false, alergias: ['latex'] };

async function novaApp(): Promise<App> {
  const app = await buildApp({ verificarSenha: senhaCorreta });
  await app.ready();
  apps.push(app);
  return app;
}

function corpoDe<T>(resposta: { json(): unknown }): T {
  return resposta.json() as T;
}

function comToken(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * Decifra as respostas guardadas, como a tela de revisao faz.
 *
 * O payload cifrado carrega `{ templateId, answers }`: o `templateId` fica
 * dentro da cifra justamente para o servidor poder conferir, apos decifrar, que
 * a resposta veio do formulario que a rota(val) prometeu.
 */
function respostasDe(
  linha: { answersEncrypted: string | null } | undefined,
): Record<string, unknown> {
  if (linha === undefined) throw new Error('Anamnese nao encontrada');

  const { data } = readAnamnesisAnswers(
    linha.answersEncrypted ?? '',
    process.env['ANAMNESIS_ENCRYPTION_KEY'] ?? '',
  );
  return (data as { answers: Record<string, unknown> }).answers;
}

interface Cenario {
  clinicId: string;
  token: string;
  userId: string;
  clientId: string;
  clientNome: string;
  templateId: string;
}

async function criarCenario(app: App, clientNome = 'Ana Cliente'): Promise<Cenario> {
  const clinicId = randomUUID();
  const userId = randomUUID();
  const clientId = randomUUID();
  const sufixo = clinicId.slice(0, 8);
  const email = `admin-${sufixo}@teste.local`;

  await prisma.clinic.create({
    data: {
      id: clinicId,
      name: 'Clinica de Teste',
      slug: `clinica-${sufixo}`,
      phone: '5551300000001',
      email: `contato-${sufixo}@teste.local`,
    },
  });
  await prisma.user.create({
    data: { id: userId, email, passwordHash: HASH_FIXTURE, name: 'Admin de Teste' },
  });
  await prisma.clinicMembership.create({ data: { clinicId, userId, role: 'ADMIN' } });
  await prisma.client.create({
    data: {
      id: clientId,
      clinicId,
      name: clientNome,
      phone: '5551999990001',
      email: `ana-${sufixo}@teste.local`,
      cpf: '12345678909',
    },
  });

  criadas.push(clinicId);

  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, senha: 'Senha@123' },
  });

  const token = corpoDe<{ accessToken: string }>(login).accessToken;

  const template = await app.inject({
    method: 'POST',
    url: '/anamnesis/templates',
    headers: comToken(token),
    payload: { name: 'Anamnese inicial', schema: FORMULARIO },
  });
  expect(template.statusCode).toBe(201);

  return {
    clinicId,
    token,
    userId,
    clientId,
    clientNome,
    templateId: corpoDe<{ id: string }>(template).id,
  };
}

/** Cria o convite pela rota autenticada e devolve o token em claro. */
async function gerarLink(app: App, cenario: Cenario): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: `/anamnesis/clientes/${cenario.clientId}/convites`,
    headers: comToken(cenario.token),
    payload: { templateId: cenario.templateId, expiresInDays: 7 },
  });

  expect(resposta.statusCode).toBe(201);
  return corpoDe<{ token: string }>(resposta).token;
}

function abrir(app: App, token: string, payload: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/public/anamneses/abrir',
    payload: { token, ...payload },
  });
}

function salvarRascunho(app: App, token: string, answers: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/public/anamneses/rascunho',
    payload: { token, answers },
  });
}

function enviar(app: App, token: string, payload: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/public/anamneses/enviar',
    payload: { token, signed: true, ...payload },
  });
}

afterEach(async () => {
  const doTeste = criadas.splice(0, criadas.length);
  if (doTeste.length === 0) return;

  await prisma.clinic.deleteMany({ where: { id: { in: doTeste } } });
  await prisma.user.deleteMany({ where: { email: { contains: '@teste.local' } } });
});

afterAll(async () => {
  for (const app of apps.splice(0, apps.length)) {
    await app.close();
  }
  await disconnectPrisma();
});

describe('gerar link de anamnese', () => {
  it('devolve o token em claro e guarda apenas o hash', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const token = await gerarLink(app, cenario);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const linha = await prisma.anamnesisInvite.findFirstOrThrow({
      where: { clientId: cenario.clientId },
    });

    expect(linha.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(linha.tokenHash).not.toBe(token);
    expect(linha.usedAt).toBeNull();
  });

  it('a listagem do painel nao devolve o token', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    await gerarLink(app, cenario);

    const resposta = await app.inject({
      method: 'GET',
      url: `/anamnesis/clientes/${cenario.clientId}/convites`,
      headers: comToken(cenario.token),
    });

    expect(resposta.statusCode).toBe(200);
    const itens = corpoDe<{ items: Record<string, unknown>[] }>(resposta).items;
    expect(itens).toHaveLength(1);
    expect(itens[0]).not.toHaveProperty('token');
    expect(itens[0]).toMatchObject({ templateName: 'Anamnese inicial', usedAt: null });
  });

  it('exige sessao para gerar link', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const resposta = await app.inject({
      method: 'POST',
      url: `/anamnesis/clientes/${cenario.clientId}/convites`,
      payload: { templateId: cenario.templateId },
    });

    expect(resposta.statusCode).toBe(401);
  });

  it('recusa cliente de outra clinica', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const outra = await criarCenario(app);

    const resposta = await app.inject({
      method: 'POST',
      url: `/anamnesis/clientes/${outra.clientId}/convites`,
      headers: comToken(cenario.token),
      payload: { templateId: outra.templateId },
    });

    // 404 e nao 403: confirmar que o cliente existe ja entrega dado de outra
    // clinica.
    expect(resposta.statusCode).toBe(404);
  });
});

describe('responder o link sem login', () => {
  it('abre o formulario mostrando so o primeiro nome', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app, 'Ana Paula Cliente');
    const token = await gerarLink(app, cenario);

    const resposta = await abrir(app, token);
    expect(resposta.statusCode).toBe(200);

    const dados = corpoDe<AnamnesisPublicForm>(resposta);
    expect(dados.clientFirstName).toBe('Ana');
    expect(dados.templateName).toBe('Anamnese inicial');
    expect(dados.schema.order).toEqual(['dor_principal', 'gestante', 'alergias']);
    expect(dados.answers).toEqual({});
    expect(dados.expiresAt).toBeTruthy();

    // O link pode ser aberto por outra mao: nada de cpf, telefone ou e-mail.
    const bruto = resposta.body;
    expect(bruto).not.toContain('12345678909');
    expect(bruto).not.toContain('5551999990001');
    expect(bruto).not.toContain('Ana Paula Cliente');
    expect(bruto).not.toContain('ana-');
  });

  it('cria um rascunho na primeira abertura e nao na segunda', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const token = await gerarLink(app, cenario);

    await abrir(app, token);
    const depoisDaPrimeira = await prisma.anamnesis.count({
      where: { clientId: cenario.clientId, status: 'RASCUNHO' },
    });
    expect(depoisDaPrimeira).toBe(1);

    await abrir(app, token);
    const depoisDaSegunda = await prisma.anamnesis.count({
      where: { clientId: cenario.clientId, status: 'RASCUNHO' },
    });
    expect(depoisDaSegunda).toBe(1);
  });

  it('salva rascunho parcial cifrado e devolve no link seguinte', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const token = await gerarLink(app, cenario);

    await abrir(app, token);
    const salvo = await salvarRascunho(app, token, { dor_principal: 'Dor cervical' });
    expect(salvo.statusCode).toBe(204);

    const linha = await prisma.anamnesis.findFirstOrThrow({
      where: { clientId: cenario.clientId, status: 'RASCUNHO' },
    });
    expect(linha.answersEncrypted).not.toContain('Dor cervical');
    expect(respostasDe(linha)).toEqual({
      dor_principal: 'Dor cervical',
    });
    expect(linha.submittedAt).toBeNull();

    const reaberto = corpoDe<AnamnesisPublicForm>(await abrir(app, token));
    expect(reaberto.answers).toEqual({ dor_principal: 'Dor cervical' });
  });

  it('envia, marca o convite como usado e cria a anamnese enviada', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const token = await gerarLink(app, cenario);

    await abrir(app, token);
    const resposta = await enviar(app, token, { answers: RESPOSTAS });
    expect(resposta.statusCode).toBe(200);
    expect(corpoDe<{ submittedAt: string }>(resposta).submittedAt).toBeTruthy();

    const anamnese = await prisma.anamnesis.findFirstOrThrow({
      where: { clientId: cenario.clientId },
    });
    expect(anamnese.status).toBe('ENVIADA');
    expect(anamnese.signedAt).not.toBeNull();
    expect(respostasDe(anamnese)).toEqual(RESPOSTAS);

    const convite = await prisma.anamnesisInvite.findFirstOrThrow({
      where: { clientId: cenario.clientId },
    });
    expect(convite.usedAt).not.toBeNull();
    expect(convite.anamnesisId).toBe(anamnese.id);
  });

  it('reenvia o rascunho salvo quando o envio vem sem respostas', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const token = await gerarLink(app, cenario);

    await abrir(app, token);
    await salvarRascunho(app, token, RESPOSTAS);

    const resposta = await enviar(app, token);
    expect(resposta.statusCode).toBe(200);

    const anamnese = await prisma.anamnesis.findFirstOrThrow({
      where: { clientId: cenario.clientId, status: 'ENVIADA' },
    });
    expect(respostasDe(anamnese)).toEqual(RESPOSTAS);
  });
});

describe('o link nao serve para mais de um envio', () => {
  it('morre depois do envio, com a mesma mensagem de token invalido', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const token = await gerarLink(app, cenario);

    await abrir(app, token);
    await enviar(app, token, { answers: RESPOSTAS });

    const segunda = await enviar(app, token, { answers: RESPOSTAS });
    const invalido = await abrir(app, 'A'.repeat(43));

    expect(segunda.statusCode).toBe(404);
    expect(invalido.statusCode).toBe(404);
    // Consumido e inexistente respondem igual: o link nao revela se existiu.
    expect(corpoDe<{ message: string }>(segunda).message).toBe(
      corpoDe<{ message: string }>(invalido).message,
    );
  });

  it('nao abre nem apaga o rascunho depois do envio', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const token = await gerarLink(app, cenario);

    await abrir(app, token);
    await enviar(app, token, { answers: RESPOSTAS });
    await salvarRascunho(app, token, { dor_principal: 'tentando por cima' });

    const anamnese = await prisma.anamnesis.findFirstOrThrow({
      where: { clientId: cenario.clientId, status: 'ENVIADA' },
    });
    expect(respostasDe(anamnese)).toEqual(RESPOSTAS);
  });
});

describe('link quebrado, expirado e de outra pessoa', () => {
  it('recusa token fora do formato de base64url', async () => {
    const app = await novaApp();

    const resposta = await abrir(app, 'token-curto');

    expect(resposta.statusCode).toBe(422);
  });

  it('recusa link expirado e mantem o rascunho anterior', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const token = await gerarLink(app, cenario);

    await abrir(app, token);
    await salvarRascunho(app, token, { dor_principal: 'Dor cervical' });
    await prisma.anamnesisInvite.updateMany({
      where: { clientId: cenario.clientId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const reabrir = await abrir(app, token);
    const enviarDepois = await enviar(app, token, { answers: RESPOSTAS });

    expect(reabrir.statusCode).toBe(404);
    expect(enviarDepois.statusCode).toBe(404);
    expect(corpoDe<{ message: string }>(reabrir).message).toBe(
      corpoDe<{ message: string }>(enviarDepois).message,
    );

    const linha = await prisma.anamnesis.findFirstOrThrow({
      where: { clientId: cenario.clientId },
    });
    expect(linha.status).toBe('RASCUNHO');
    expect(linha.submittedAt).toBeNull();
  });

  it('um link de outro cliente nao abre nem grava rascunho alheio', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const outro = await criarCenario(app, 'Bruno Cliente');

    const tokenDoBruno = await gerarLink(app, outro);
    const tokenDaAna = await gerarLink(app, cenario);

    // O token da Ana nao pode virar rascunho do Bruno nem o contrario: cada um
    // nasce amarrado ao proprio cliente, no banco.
    const abriuDaAna = corpoDe<AnamnesisPublicForm>(await abrir(app, tokenDaAna));
    expect(abriuDaAna.clientFirstName).toBe('Ana');

    await salvarRascunho(app, tokenDaAna, { dor_principal: 'Da Ana' });

    // O token do Bruno ainda nao tem rascunho: o da Ana nao foi reaproveitado.
    const doBruno = await prisma.anamnesis.count({
      where: { clientId: outro.clientId, answersEncrypted: { not: null } },
    });
    expect(doBruno).toBe(0);

    // E cada link abre o proprio rascunho, nao o do vizinho.
    await abrir(app, tokenDoBruno);
    const doBrunoAberto = corpoDe<AnamnesisPublicForm>(await abrir(app, tokenDoBruno));
    expect(doBrunoAberto.clientFirstName).toBe('Bruno');
    expect(doBrunoAberto.answers).toEqual({});
  });

  it('rascunho de cliente de outra clinica nao e reaproveitado', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const outra = await criarCenario(app, 'Bruno Cliente');

    const tokenDaAna = await gerarLink(app, cenario);
    const tokenDoBruno = await gerarLink(app, outra);

    await salvarRascunho(app, tokenDaAna, { dor_principal: 'Da Ana' });
    await salvarRascunho(app, tokenDoBruno, { dor_principal: 'Do Bruno' });

    const anas = await prisma.anamnesis.findMany({
      where: { clientId: cenario.clientId, status: 'RASCUNHO' },
    });
    const brunos = await prisma.anamnesis.findMany({
      where: { clientId: outra.clientId, status: 'RASCUNHO' },
    });

    const [daAna] = anas;
    const [doBruno] = brunos;
    expect(daAna).toBeDefined();
    expect(doBruno).toBeDefined();
    expect(respostasDe(daAna)).toEqual({
      dor_principal: 'Da Ana',
    });
    expect(respostasDe(doBruno)).toEqual({
      dor_principal: 'Do Bruno',
    });
  });
});

describe('validacao das respostas do link', () => {
  it('recusa envio com campo obrigatorio faltando e nao consome o convite', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const token = await gerarLink(app, cenario);

    await abrir(app, token);
    const resposta = await enviar(app, token, { answers: { gestante: true } });

    expect(resposta.statusCode).toBe(422);
    expect(corpoDe<{ message: string }>(resposta).message).toContain('Dor principal');

    const convite = await prisma.anamnesisInvite.findFirstOrThrow({
      where: { clientId: cenario.clientId },
    });
    expect(convite.usedAt).toBeNull();

    // O link continua valendo depois de um envio invalido: o cliente corrige
    // e tenta de novo.
    const segunda = await enviar(app, token, { answers: RESPOSTAS });
    expect(segunda.statusCode).toBe(200);
  });

  it('recusa campo que nao existe no formulario', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const token = await gerarLink(app, cenario);

    await abrir(app, token);
    const resposta = await enviar(app, token, {
      answers: { ...RESPOSTAS, campo_inventado: 'o que o cliente inventou' },
    });

    expect(resposta.statusCode).toBe(422);
  });

  it('recusa valor fora das opcoes do campo', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const token = await gerarLink(app, cenario);

    await abrir(app, token);
    const resposta = await enviar(app, token, {
      answers: { ...RESPOSTAS, alergias: ['nao-existe'] },
    });

    expect(resposta.statusCode).toBe(422);
  });
});
