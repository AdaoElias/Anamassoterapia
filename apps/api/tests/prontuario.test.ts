import { randomUUID } from 'node:crypto';

import type { AnamnesisForm } from '@massoterapia/shared';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import { readAnamnesisAnswers } from '../src/lib/anamnesis-crypto.js';
import { disconnectPrisma, prisma } from '../src/lib/prisma.js';

/**
 * Prontuario: formularios de anamnese, respostas versionadas, condicoes de
 * saude e alertas de contraindicacao.
 *
 * O que estes testes tentam quebrar, em ordem de importancia:
 *
 * 1. **A resposta some do banco.** Nenhuma listagem devolve `answers`; so o
 *    detalhe decifra. Um `GET` de prontuario e registro de acesso comum --
 *    se ele derruba a resposta no log do proxy, a cifra nao protege nada.
 * 2. **A resposta enviada e imutavel.** Nao por convencao da rota, mas pelo
 *    gatilho do Postgres: um `prisma.anamnesis.update` direto tem de falhar.
 * 3. **A versao conta certo**, inclusive quando o cliente ja tem anamnese
 *    aprovada e responde de novo.
 * 4. **O aviso nao vira bloqueio.** Alerta pendente mantem a sessao criada.
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
    alergias: {
      type: 'array',
      title: 'Alergias',
      enum: ['latex', 'iodo', 'oleo'],
      max: 3,
    },
  },
};

const FORMULARIO_V2: AnamnesisForm = {
  type: 'object',
  order: ['dor_principal', 'pressao'],
  required: ['dor_principal'],
  properties: {
    dor_principal: { type: 'string', title: 'Dor principal', maxLength: 120 },
    pressao: { type: 'integer', title: 'Pressao sistolica', min: 60, max: 260 },
  },
};

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

interface Cenario {
  clinicId: string;
  slug: string;
  userId: string;
  token: string;
  clientId: string;
  professionalId: string;
  therapyId: string;
}

async function criarCenario(app: App): Promise<Cenario> {
  const clinicId = randomUUID();
  const userId = randomUUID();
  const professionalId = randomUUID();
  const therapyId = randomUUID();
  const clientId = randomUUID();
  const sufixo = clinicId.slice(0, 8);
  const slug = `clinica-${sufixo}`;
  const email = `admin-${sufixo}@teste.local`;

  await prisma.clinic.create({
    data: {
      id: clinicId,
      name: 'Clinica de Teste',
      slug,
      phone: '5551300000001',
      email: `contato-${sufixo}@teste.local`,
    },
  });
  await prisma.user.create({
    data: { id: userId, email, passwordHash: HASH_FIXTURE, name: 'Admin de Teste' },
  });
  await prisma.clinicMembership.create({ data: { clinicId, userId, role: 'ADMIN' } });
  await prisma.professional.create({
    data: { id: professionalId, clinicId, name: 'Profissional de Teste' },
  });
  await prisma.client.create({
    data: { id: clientId, clinicId, name: 'Ana Cliente', phone: '5551999990001' },
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

  criadas.push(clinicId);

  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, senha: 'Senha@123' },
  });

  return {
    clinicId,
    slug,
    userId,
    token: corpoDe<{ accessToken: string }>(login).accessToken,
    clientId,
    professionalId,
    therapyId,
  };
}

/** Profissional de outra clinica nao entra: o prontuario e dado de saude. */
async function criarProfissional(app: App, cenario: Cenario): Promise<string> {
  const userId = randomUUID();
  const email = `prof-${userId.slice(0, 8)}@teste.local`;
  const professionalId = randomUUID();

  await prisma.user.create({
    data: { id: userId, email, passwordHash: HASH_FIXTURE, name: 'Massista' },
  });
  await prisma.clinicMembership.create({
    data: { clinicId: cenario.clinicId, userId, role: 'PROFISSIONAL' },
  });
  await prisma.professional.create({
    data: { id: professionalId, clinicId: cenario.clinicId, name: 'Massista' },
  });

  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, senha: 'Senha@123' },
  });

  return corpoDe<{ accessToken: string }>(login).accessToken;
}

async function criarTemplate(
  app: App,
  cenario: Cenario,
  extras: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/anamnesis/templates',
    headers: comToken(cenario.token),
    payload: { name: 'Anamnese inicial', schema: FORMULARIO, ...extras },
  });

  expect(resposta.statusCode).toBe(201);
  return corpoDe<{ id: string; version: number }>(resposta);
}

async function registrarAnamnese(
  app: App,
  cenario: Cenario,
  payload: Record<string, unknown> = {},
): Promise<{ id: string; status: string; version: number }> {
  const resposta = await app.inject({
    method: 'POST',
    url: `/anamnesis/clientes/${cenario.clientId}`,
    headers: comToken(cenario.token),
    payload,
  });

  expect(resposta.statusCode).toBe(201);
  return corpoDe(resposta);
}

function sessaoFutura(minutos = 60): string {
  return new Date(Date.now() + minutos * 60_000).toISOString();
}

async function agendar(
  app: App,
  cenario: Cenario,
  inicio = sessaoFutura(),
): Promise<{ statusCode: number; id: string | undefined }> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/appointments',
    headers: comToken(cenario.token),
    payload: {
      clientId: cenario.clientId,
      professionalId: cenario.professionalId,
      therapyId: cenario.therapyId,
      startAt: inicio,
    },
  });

  return { statusCode: resposta.statusCode, id: corpoDe<{ id?: string }>(resposta).id };
}

afterEach(async () => {
  const doTeste = criadas.splice(0, criadas.length);
  if (doTeste.length === 0) return;

  // Alertas e vinculos de anamnese sao RESTRICT/Cascade em cadeia; apagar a
  // clinica remove tudo, desde que as sessoes caiam antes.
  await prisma.appointment.deleteMany({ where: { clinicId: { in: doTeste } } });
  await prisma.clinic.deleteMany({ where: { id: { in: doTeste } } });
  await prisma.user.deleteMany({ where: { email: { contains: '@teste.local' } } });
});

afterAll(async () => {
  for (const app of apps.splice(0, apps.length)) {
    await app.close();
  }
  await disconnectPrisma();
});

describe('formularios de anamnese', () => {
  it('cadastra formulario e devolve os vinculos com as terapias', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const template = await criarTemplate(app, cenario, { therapyIds: [cenario.therapyId] });

    expect(template.version).toBe(1);

    const detalhe = await app.inject({
      method: 'GET',
      url: `/anamnesis/templates/${template.id}`,
      headers: comToken(cenario.token),
    });
    expect(detalhe.statusCode).toBe(200);
    expect(corpoDe<{ therapyIds: string[] }>(detalhe).therapyIds).toEqual([cenario.therapyId]);
  });

  it('profissional nao cadastra formulario, mas le', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const tokenProfissional = await criarProfissional(app, cenario);
    await criarTemplate(app, cenario);

    const recusa = await app.inject({
      method: 'POST',
      url: '/anamnesis/templates',
      headers: comToken(tokenProfissional),
      payload: { name: 'Tentativa', schema: FORMULARIO },
    });
    expect(recusa.statusCode).toBe(403);

    const leitura = await app.inject({
      method: 'GET',
      url: '/anamnesis/templates',
      headers: comToken(tokenProfissional),
    });
    expect(leitura.statusCode).toBe(200);
    expect(corpoDe<{ items: unknown[] }>(leitura).items).toHaveLength(1);
  });

  it('recusa formulario com campo na ordem e sem definicao', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const resposta = await app.inject({
      method: 'POST',
      url: '/anamnesis/templates',
      headers: comToken(cenario.token),
      payload: {
        name: 'Formulario quebrado',
        schema: { ...FORMULARIO, order: [...FORMULARIO.order, 'campo_que_nao_existe'] },
      },
    });

    expect(resposta.statusCode).toBe(422);
  });

  it('PATCH mexe em metadado e preserva o formulario', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/anamnesis/templates/${template.id}`,
      headers: comToken(cenario.token),
      payload: { name: 'Anamnese inicial (2026)', description: 'Revisada' },
    });

    expect(resposta.statusCode).toBe(200);
    const corpo = corpoDe<{ name: string; schema: AnamnesisForm }>(resposta);
    expect(corpo.name).toBe('Anamnese inicial (2026)');
    expect(corpo.schema).toEqual(FORMULARIO);
  });

  it('nova versao desativa a anterior e mantem as respostas apontando para ela', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario, { therapyIds: [cenario.therapyId] });
    const anamnese = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar' },
    });

    const versao = await app.inject({
      method: 'POST',
      url: `/anamnesis/templates/${template.id}/versao`,
      headers: comToken(cenario.token),
      payload: { schema: FORMULARIO_V2 },
    });

    expect(versao.statusCode).toBe(201);
    const nova = corpoDe<{ id: string; version: number; isActive: boolean; therapyIds: string[] }>(
      versao,
    );
    expect(nova.version).toBe(2);
    expect(nova.isActive).toBe(true);
    expect(nova.therapyIds).toEqual([cenario.therapyId]);
    expect(nova.id).not.toBe(template.id);

    const antiga = await prisma.anamnesisTemplate.findUniqueOrThrow({
      where: { id: template.id },
    });
    expect(antiga.isActive).toBe(false);
    expect(antiga.version).toBe(1);

    // A resposta antiga continua presa a versao 1: e o que permite ler com
    // qual formulario ela foi respondida.
    const detalhe = await app.inject({
      method: 'GET',
      url: `/anamnesis/${anamnese.id}`,
      headers: comToken(cenario.token),
    });
    const corpo = corpoDe<{ templateId: string; templateVersion: number; answers: unknown }>(
      detalhe,
    );
    expect(corpo.templateId).toBe(template.id);
    expect(corpo.templateVersion).toBe(1);
    expect(corpo.answers).toEqual({ dor_principal: 'lombar' });
  });

  it('template de outra clinica e 404', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const outro = await criarCenario(app);
    const template = await criarTemplate(app, outro);

    const resposta = await app.inject({
      method: 'GET',
      url: `/anamnesis/templates/${template.id}`,
      headers: comToken(cenario.token),
    });

    expect(resposta.statusCode).toBe(404);
  });

  it('exige sessao valida', async () => {
    const app = await novaApp();
    await criarCenario(app);

    expect((await app.inject({ method: 'GET', url: '/anamnesis/templates' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/contraindications' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/prontuarios/${randomUUID()}`,
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('respostas de anamnese', () => {
  it('cifra a resposta e so devolve no detalhe', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);

    const criada = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar', alergias: ['latex'], gestante: false },
    });

    expect(criada.status).toBe('RASCUNHO');
    expect(criada.version).toBe(1);

    const linha = await prisma.anamnesis.findUniqueOrThrow({ where: { id: criada.id } });
    expect(linha.answersEncrypted).not.toContain('lombar');
    expect(linha.answersEncrypted?.startsWith('v1:')).toBe(true);
    expect(linha.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const { data } = readAnamnesisAnswers(
      linha.answersEncrypted ?? '',
      process.env['ANAMNESIS_ENCRYPTION_KEY'] ?? '',
    );
    expect(data.templateId).toBe(template.id);
    expect(data.answers).toEqual({ dor_principal: 'lombar', alergias: ['latex'], gestante: false });

    // A listagem do cliente traz metadados, e `hasAnswers` substitui a
    // resposta cifrada: o painel sabe que ha conteudo sem precisar decifrar.
    const lista = await app.inject({
      method: 'GET',
      url: `/anamnesis/clientes/${cenario.clientId}`,
      headers: comToken(cenario.token),
    });
    const itens = corpoDe<{ items: Array<Record<string, unknown>> }>(lista).items;
    expect(itens).toHaveLength(1);
    expect(itens[0]?.hasAnswers).toBe(true);
    expect(itens[0]).not.toHaveProperty('answers');
    expect(itens[0]).not.toHaveProperty('answersEncrypted');
  });

  it('recusa resposta incompleta de campo obrigatorio', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);

    const resposta = await app.inject({
      method: 'POST',
      url: `/anamnesis/clientes/${cenario.clientId}`,
      headers: comToken(cenario.token),
      payload: { templateId: template.id, answers: { gestante: true } },
    });

    expect(resposta.statusCode).toBe(422);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('ANAMNESIS_ANSWERS_INVALID');
    expect(await prisma.anamnesis.count({ where: { clientId: cenario.clientId } })).toBe(0);
  });

  it('recusa valor fora das opcoes declaradas', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);

    const resposta = await app.inject({
      method: 'POST',
      url: `/anamnesis/clientes/${cenario.clientId}`,
      headers: comToken(cenario.token),
      payload: {
        templateId: template.id,
        answers: { dor_principal: 'lombar', alergias: ['pollen'] },
      },
    });

    expect(resposta.statusCode).toBe(422);
  });

  it('recusa campo que nao existe no formulario', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);

    const resposta = await app.inject({
      method: 'POST',
      url: `/anamnesis/clientes/${cenario.clientId}`,
      headers: comToken(cenario.token),
      payload: { templateId: template.id, answers: { dor_principal: 'lombar', Reply: 42 } },
    });

    expect(resposta.statusCode).toBe(422);
  });

  it('numera versoes por cliente, nao por clinica', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);

    const primeira = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar' },
      enviar: true,
    });
    const segunda = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'cervical' },
      enviar: true,
    });

    expect(primeira.version).toBe(1);
    expect(segunda.version).toBe(2);

    const lista = await app.inject({
      method: 'GET',
      url: `/anamnesis/clientes/${cenario.clientId}`,
      headers: comToken(cenario.token),
    });
    const versoes = corpoDe<{ items: Array<{ version: number }> }>(lista).items.map(
      (item) => item.version,
    );
    expect(versoes).toEqual([2, 1]);
  });

  it('rascunho substitui o conteudo inteiro e envia valida', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);
    const rascunho = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar' },
    });

    const salvou = await app.inject({
      method: 'PUT',
      url: `/anamnesis/${rascunho.id}/rascunho`,
      headers: comToken(cenario.token),
      payload: { answers: { dor_principal: 'cervical', gestante: true } },
    });
    expect(salvou.statusCode).toBe(200);
    expect(corpoDe<{ answers: unknown }>(salvou).answers).toEqual({
      dor_principal: 'cervical',
      gestante: true,
    });

    const enviou = await app.inject({
      method: 'POST',
      url: `/anamnesis/${rascunho.id}/enviar`,
      headers: comToken(cenario.token),
      payload: { signed: true },
    });
    expect(enviou.statusCode).toBe(200);
    const corpo = corpoDe<{ status: string; submittedAt: string; signedAt: string }>(enviou);
    expect(corpo.status).toBe('ENVIADA');
    expect(corpo.submittedAt).not.toBeNull();
    expect(corpo.signedAt).not.toBeNull();
  });

  it('nao envia rascunho vazio', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);
    const rascunho = await registrarAnamnese(app, cenario, { templateId: template.id });

    const resposta = await app.inject({
      method: 'POST',
      url: `/anamnesis/${rascunho.id}/enviar`,
      headers: comToken(cenario.token),
      payload: {},
    });

    expect(resposta.statusCode).toBe(422);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('ANAMNESIS_EMPTY');
  });

  it('resposta enviada nao volta atras pela rota nem pelo banco', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);
    const enviada = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar' },
      enviar: true,
    });
    const antes = await prisma.anamnesis.findUniqueOrThrow({ where: { id: enviada.id } });

    const reescrever = await app.inject({
      method: 'PUT',
      url: `/anamnesis/${enviada.id}/rascunho`,
      headers: comToken(cenario.token),
      payload: { answers: { dor_principal: 'outra coisa' } },
    });
    expect(reescrever.statusCode).toBe(409);
    expect(corpoDe<{ error: string }>(reescrever).error).toBe('ANAMNESIS_IMMUTABLE');

    const reenviar = await app.inject({
      method: 'POST',
      url: `/anamnesis/${enviada.id}/enviar`,
      headers: comToken(cenario.token),
      payload: {},
    });
    expect(reenviar.statusCode).toBe(409);

    // O banco e a ultima linha: mesmo escrevendo direto, a resposta nao muda.
    await expect(
      prisma.anamnesis.update({
        where: { id: enviada.id },
        data: { answersEncrypted: 'v1:aaaa:bbbb:cccc' },
      }),
    ).rejects.toThrow();

    const depois = await prisma.anamnesis.findUniqueOrThrow({ where: { id: enviada.id } });
    expect(depois.answersEncrypted).toBe(antes.answersEncrypted);
    expect(depois.contentHash).toBe(antes.contentHash);
  });

  it('revisar aprova, registra quem revisou e vira a versao vigente', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);
    const enviada = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar' },
      enviar: true,
    });

    const revisada = await app.inject({
      method: 'POST',
      url: `/anamnesis/${enviada.id}/revisar`,
      headers: comToken(cenario.token),
      payload: { decision: 'APROVADA', reviewNotes: 'Atestado ok' },
    });
    expect(revisada.statusCode).toBe(200);
    const corpo = corpoDe<{ status: string; reviewedByName: string }>(revisada);
    expect(corpo.status).toBe('APROVADA');
    expect(corpo.reviewedByName).toBe('Admin de Teste');

    const prontuario = await app.inject({
      method: 'GET',
      url: `/prontuarios/${cenario.clientId}`,
      headers: comToken(cenario.token),
    });
    const situacao = corpoDe<{ situacao: { anamneseVigente: { version: number } } }>(
      prontuario,
    ).situacao;
    expect(situacao.anamneseVigente?.version).toBe(1);

    // Segunda revisao nao existe: a decisao ja foi tomada.
    const segunda = await app.inject({
      method: 'POST',
      url: `/anamnesis/${enviada.id}/revisar`,
      headers: comToken(cenario.token),
      payload: { decision: 'REJEITADA' },
    });
    expect(segunda.statusCode).toBe(409);
  });

  it('anamnese de outro cliente e 404, e de outra clinica tambem', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const outro = await criarCenario(app);
    const template = await criarTemplate(app, cenario);
    const anamnese = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar' },
    });

    const alheia = await app.inject({
      method: 'GET',
      url: `/anamnesis/${anamnese.id}`,
      headers: comToken(outro.token),
    });
    expect(alheia.statusCode).toBe(404);

    const listaAlheia = await app.inject({
      method: 'GET',
      url: `/anamnesis/clientes/${outro.clientId}`,
      headers: comToken(cenario.token),
    });
    expect(listaAlheia.statusCode).toBe(404);
  });

  it('detalha erro de integridade em vez de devolver formulario vazio', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);
    const rascunho = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar' },
    });

    // Adultera a coluna sem mexer no hash: e o caso que o `contentHash`
    // existe para pegar.
    await prisma.anamnesis.update({
      where: { id: rascunho.id },
      data: { answersEncrypted: 'v1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbb:cccc' },
    });

    const resposta = await app.inject({
      method: 'GET',
      url: `/anamnesis/${rascunho.id}`,
      headers: comToken(cenario.token),
    });

    expect(resposta.statusCode).toBe(500);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('ANAMNESIS_INTEGRITY');
  });

  it('lista as anamneses aguardando revisao, mais antiga primeiro', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);
    const primeira = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar' },
      enviar: true,
    });
    const segunda = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'cervical' },
      enviar: true,
    });

    const resposta = await app.inject({
      method: 'GET',
      url: '/anamnesis/pendentes',
      headers: comToken(cenario.token),
    });

    const itens = corpoDe<{ items: Array<{ id: string }> }>(resposta).items;
    expect(itens.map((item) => item.id)).toEqual([primeira.id, segunda.id]);
  });
});

describe('contraindicacoes e alertas', () => {
  async function cadastrarContraindicacao(
    app: App,
    cenario: Cenario,
    extras: Record<string, unknown> = {},
  ): Promise<{ id: string; code: string }> {
    const resposta = await app.inject({
      method: 'POST',
      url: '/contraindications',
      headers: comToken(cenario.token),
      payload: {
        code: 'GESTACAO',
        title: 'Gestacao',
        severity: 'ALTA',
        requiresMedicalClearance: true,
        ...extras,
      },
    });

    expect(resposta.statusCode).toBe(201);
    return corpoDe<{ id: string; code: string }>(resposta);
  }

  it('catalogo recusa codigo repetido na mesma clinica', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    await cadastrarContraindicacao(app, cenario);

    const repetido = await app.inject({
      method: 'POST',
      url: '/contraindications',
      headers: comToken(cenario.token),
      payload: { code: 'GESTACAO', title: 'Gestacao de novo' },
    });

    expect(repetido.statusCode).toBe(409);
  });

  it('registra condicao do catalogo herdando codigo e severidade', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const contraindicacao = await cadastrarContraindicacao(app, cenario);

    const resposta = await app.inject({
      method: 'POST',
      url: `/contraindications/clientes/${cenario.clientId}`,
      headers: comToken(cenario.token),
      payload: { contraindicationId: contraindicacao.id, title: 'Gestacao de 32 semanas' },
    });

    expect(resposta.statusCode).toBe(201);
    const corpo = corpoDe<{
      code: string;
      severity: string;
      requiresMedicalClearance: boolean;
      resolvedAt: string | null;
    }>(resposta);
    expect(corpo.code).toBe('GESTACAO');
    expect(corpo.severity).toBe('ALTA');
    expect(corpo.requiresMedicalClearance).toBe(true);
    expect(corpo.resolvedAt).toBeNull();
  });

  it('cria alerta na sessao e nao bloqueia o agendamento', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const contraindicacao = await cadastrarContraindicacao(app, cenario, {
      therapyIds: [cenario.therapyId],
    });

    await app.inject({
      method: 'POST',
      url: `/contraindications/clientes/${cenario.clientId}`,
      headers: comToken(cenario.token),
      payload: { contraindicationId: contraindicacao.id, title: 'Gestacao de 32 semanas' },
    });

    const sessao = await agendar(app, cenario);
    expect(sessao.statusCode).toBe(201);

    const alertas = await prisma.contraindicationAlert.findMany({
      where: { appointmentId: sessao.id },
    });
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.severity).toBe('ALTA');
    expect(alertas[0]?.decision).toBe('PENDENTE');

    const aviso = await prisma.notification.findMany({
      where: { appointmentId: sessao.id, type: 'ALERTA_CONTRAINDICACAO' },
    });
    expect(aviso.length).toBeGreaterThan(0);

    const listagem = await app.inject({
      method: 'GET',
      url: '/contraindications/alertas',
      headers: comToken(cenario.token),
    });
    const corpo = corpoDe<{
      items: Array<{ clientName: string; conditionTitle: string }>;
      total: number;
    }>(listagem);
    expect(corpo.total).toBe(1);
    expect(corpo.items[0]?.clientName).toBe('Ana Cliente');
    expect(corpo.items[0]?.conditionTitle).toBe('Gestacao de 32 semanas');
  });

  it('condicao resolvida nao gera alerta novo', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const contraindicacao = await cadastrarContraindicacao(app, cenario, {
      therapyIds: [cenario.therapyId],
    });

    const condicao = corpoDe<{ id: string }>(
      await app.inject({
        method: 'POST',
        url: `/contraindications/clientes/${cenario.clientId}`,
        headers: comToken(cenario.token),
        payload: { contraindicationId: contraindicacao.id, title: 'Gestacao' },
      }),
    );

    const resolveu = await app.inject({
      method: 'POST',
      url: `/contraindications/condicoes/${condicao.id}/resolver`,
      headers: comToken(cenario.token),
      payload: { notes: 'Parto concluido' },
    });
    expect(resolveu.statusCode).toBe(200);
    expect(corpoDe<{ resolvedAt: string | null }>(resolveu).resolvedAt).not.toBeNull();

    const sessao = await agendar(app, cenario);
    expect(await prisma.contraindicationAlert.count({ where: { appointmentId: sessao.id } })).toBe(
      0,
    );

    const segunda = await app.inject({
      method: 'POST',
      url: `/contraindications/condicoes/${condicao.id}/resolver`,
      headers: comToken(cenario.token),
      payload: {},
    });
    expect(segunda.statusCode).toBe(409);
  });

  it('registra a decisao do alerta uma vez so', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const contraindicacao = await cadastrarContraindicacao(app, cenario, {
      therapyIds: [cenario.therapyId],
    });
    await app.inject({
      method: 'POST',
      url: `/contraindications/clientes/${cenario.clientId}`,
      headers: comToken(cenario.token),
      payload: { contraindicationId: contraindicacao.id, title: 'Gestacao' },
    });
    const sessao = await agendar(app, cenario);
    const alerta = await prisma.contraindicationAlert.findFirstOrThrow({
      where: { appointmentId: sessao.id },
    });

    const decidido = await app.inject({
      method: 'POST',
      url: `/contraindications/alertas/${alerta.id}/decisao`,
      headers: comToken(cenario.token),
      payload: { decision: 'ACEITO', decisionNotes: 'Cliente autorizou' },
    });
    expect(decidido.statusCode).toBe(200);
    const corpo = corpoDe<{ alert: { decision: string; acknowledgedByName: string } }>(decidido);
    expect(corpo.alert.decision).toBe('ACEITO');
    expect(corpo.alert.acknowledgedByName).toBe('Admin de Teste');

    const repetido = await app.inject({
      method: 'POST',
      url: `/contraindications/alertas/${alerta.id}/decisao`,
      headers: comToken(cenario.token),
      payload: { decision: 'BLOQUEADO' },
    });
    expect(repetido.statusCode).toBe(409);

    const pendentes = await app.inject({
      method: 'GET',
      url: '/contraindications/alertas',
      headers: comToken(cenario.token),
    });
    expect(corpoDe<{ total: number }>(pendentes).total).toBe(0);

    const decididos = await app.inject({
      method: 'GET',
      url: '/contraindications/alertas?decision=ACEITO',
      headers: comToken(cenario.token),
    });
    expect(corpoDe<{ total: number }>(decididos).total).toBe(1);
  });

  it('avisa anamnese pendente quando a terapia exige', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    await prisma.therapy.update({
      where: { id: cenario.therapyId },
      data: { requiresAnamnesis: true },
    });
    await criarTemplate(app, cenario);

    const sessao = await agendar(app, cenario);
    expect(sessao.statusCode).toBe(201);

    const avisos = await prisma.notification.findMany({
      where: { appointmentId: sessao.id, type: 'ANAMNESE_PENDENTE' },
    });
    expect(avisos.length).toBeGreaterThan(0);
  });

  it('avisa clinica e profissional no mesmo canal sem colidir na chave', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    await prisma.therapy.update({
      where: { id: cenario.therapyId },
      data: { requiresAnamnesis: true },
    });
    await criarTemplate(app, cenario);

    // Profissional com acesso ao painel tem e-mail proprio: os dois recebem
    // por EMAIL e ainda assim sao duas linhas na outbox.
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        email: `painel-${userId.slice(0, 8)}@teste.local`,
        passwordHash: HASH_FIXTURE,
        name: 'Massista',
      },
    });
    await prisma.clinicMembership.create({
      data: { clinicId: cenario.clinicId, userId, role: 'PROFISSIONAL' },
    });
    await prisma.professional.update({
      where: { id: cenario.professionalId },
      data: { userId },
    });

    const sessao = await agendar(app, cenario);
    const avisos = await prisma.notification.findMany({
      where: { appointmentId: sessao.id, type: 'ANAMNESE_PENDENTE' },
      select: { channel: true, recipient: true, dedupeKey: true },
      orderBy: { recipient: 'asc' },
    });

    const porEmail = avisos.filter((aviso) => aviso.channel === 'EMAIL');
    expect(porEmail).toHaveLength(2);
    expect(new Set(avisos.map((aviso) => aviso.dedupeKey)).size).toBe(avisos.length);
    expect(porEmail.map((aviso) => aviso.recipient)).toContain(
      `contato-${cenario.clinicId.slice(0, 8)}@teste.local`,
    );
  });

  it('nao avisa anamnese pendente quando ja existe versao aprovada', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    await prisma.therapy.update({
      where: { id: cenario.therapyId },
      data: { requiresAnamnesis: true },
    });
    const template = await criarTemplate(app, cenario);

    const enviada = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar' },
      enviar: true,
    });
    await app.inject({
      method: 'POST',
      url: `/anamnesis/${enviada.id}/revisar`,
      headers: comToken(cenario.token),
      payload: { decision: 'APROVADA' },
    });

    const sessao = await agendar(app, cenario);
    expect(
      await prisma.notification.count({
        where: { appointmentId: sessao.id, type: 'ANAMNESE_PENDENTE' },
      }),
    ).toBe(0);
  });

  it('vincula a versao vigente quando a sessao entra em atendimento', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);
    const enviada = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar' },
      enviar: true,
    });
    await app.inject({
      method: 'POST',
      url: `/anamnesis/${enviada.id}/revisar`,
      headers: comToken(cenario.token),
      payload: { decision: 'APROVADA' },
    });

    const sessao = await agendar(app, cenario);
    // O dominio so aceita AGENDADO_PENDENTE -> CONFIRMADO -> EM_ATENDIMENTO.
    const confirmacao = await app.inject({
      method: 'PATCH',
      url: `/appointments/${sessao.id}/status`,
      headers: comToken(cenario.token),
      payload: { status: 'CONFIRMADO' },
    });
    expect(confirmacao.statusCode).toBe(200);

    const inicio = await app.inject({
      method: 'PATCH',
      url: `/appointments/${sessao.id}/status`,
      headers: comToken(cenario.token),
      payload: { status: 'EM_ATENDIMENTO' },
    });
    expect(inicio.statusCode).toBe(200);

    const vinculo = await prisma.appointmentAnamnesis.findUnique({
      where: { appointmentId: sessao.id },
    });
    expect(vinculo?.anamnesisId).toBe(enviada.id);

    // Versao nova e aprovada depois: a sessao continua presa a versao 1, que
    // e a que estava vigente quando o atendimento comecou.
    const segunda = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'cervical' },
      enviar: true,
    });
    await app.inject({
      method: 'POST',
      url: `/anamnesis/${segunda.id}/revisar`,
      headers: comToken(cenario.token),
      payload: { decision: 'APROVADA' },
    });

    const vinculoDepois = await prisma.appointmentAnamnesis.findUnique({
      where: { appointmentId: sessao.id },
    });
    expect(vinculoDepois?.anamnesisId).toBe(enviada.id);
  });
});

describe('prontuario', () => {
  it('reune anamnese, condicoes, alertas e sessoes', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const template = await criarTemplate(app, cenario);
    const contraindicacao = corpoDe<{ id: string }>(
      await app.inject({
        method: 'POST',
        url: '/contraindications',
        headers: comToken(cenario.token),
        payload: {
          code: 'DOR_CRONICA',
          title: 'Dor cronica',
          severity: 'MEDIA',
          therapyIds: [cenario.therapyId],
        },
      }),
    );

    await app.inject({
      method: 'POST',
      url: `/contraindications/clientes/${cenario.clientId}`,
      headers: comToken(cenario.token),
      payload: { contraindicationId: contraindicacao.id, title: 'Lombalgia cronica' },
    });

    const rascunho = await registrarAnamnese(app, cenario, {
      templateId: template.id,
      answers: { dor_principal: 'lombar' },
      enviar: true,
    });
    await app.inject({
      method: 'POST',
      url: `/anamnesis/${rascunho.id}/revisar`,
      headers: comToken(cenario.token),
      payload: { decision: 'APROVADA' },
    });

    const sessao = await agendar(app, cenario);

    const resposta = await app.inject({
      method: 'GET',
      url: `/prontuarios/${cenario.clientId}`,
      headers: comToken(cenario.token),
    });
    expect(resposta.statusCode).toBe(200);

    const prontuario = corpoDe<{
      client: { name: string };
      situacao: {
        anamneseVigente: { version: number } | null;
        anamnesePendente: number;
        condicoesAtivas: number;
        alertasPendentes: number;
        sessoesRealizadas: number;
      };
      anamneses: Array<Record<string, unknown>>;
      sessoes: Array<{ id: string; anamnesisVersion: number | null }>;
      condicoes: Array<{ title: string }>;
      alertas: Array<{ decision: string }>;
    }>(resposta);

    expect(prontuario.client.name).toBe('Ana Cliente');
    expect(prontuario.situacao.anamneseVigente?.version).toBe(1);
    expect(prontuario.situacao.anamnesePendente).toBe(0);
    expect(prontuario.situacao.condicoesAtivas).toBe(1);
    expect(prontuario.situacao.alertasPendentes).toBe(1);
    expect(prontuario.anamneses).toHaveLength(1);
    // O prontuario nao decifra: a resposta fica em `GET /anamnesis/:id`.
    expect(prontuario.anamneses[0]).not.toHaveProperty('answers');
    expect(prontuario.sessoes[0]?.id).toBe(sessao.id);
    expect(prontuario.condicoes[0]?.title).toBe('Lombalgia cronica');
    expect(prontuario.alertas[0]?.decision).toBe('PENDENTE');
  });

  it('profissional le o prontuario do cliente da propria clinica', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const tokenProfissional = await criarProfissional(app, cenario);

    const resposta = await app.inject({
      method: 'GET',
      url: `/prontuarios/${cenario.clientId}`,
      headers: comToken(tokenProfissional),
    });

    expect(resposta.statusCode).toBe(200);
  });

  it('prontuario de cliente de outra clinica e 404', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const outro = await criarCenario(app);

    const resposta = await app.inject({
      method: 'GET',
      url: `/prontuarios/${cenario.clientId}`,
      headers: comToken(outro.token),
    });

    expect(resposta.statusCode).toBe(404);
  });
});
