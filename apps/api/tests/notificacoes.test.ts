import { randomUUID } from 'node:crypto';

import { diaDaSemanaDaData, parseDataLocal, utcDeLocal } from '@massoterapia/shared';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import {
  type ContextoSessao,
  formatarQuando,
  montarMensagem,
} from '../src/lib/notificacoes/mensagens.js';
import { processarNotificacao } from '../src/lib/notificacoes/processar.js';
import type { Canais, Registrador } from '../src/lib/notificacoes/transportes.js';
import { disconnectPrisma, prisma } from '../src/lib/prisma.js';

/**
 * Notificacoes: texto, gatilho e envio.
 *
 * A fila nunca sobe na suite -- `iniciarFila` fica no `index.ts`. Isso e o
 * que permite verificar o estado real das linhas na outbox (`PENDENTE`)
 * depois que a rota grava, sem um worker correndo por tras comendo o
 * registro antes do `expect`. O envio, entao, e testado chamando
 * `processarNotificacao` com canais falsos.
 */

const TZ = 'America/Sao_Paulo';
const HASH_FIXTURE = '$argon2id$v=19$m=19456,t=2,p=1$c2VudG8$hash';

/** Data futura e distante, para nao esbarrar no relogio real. */
const DIA = '2099-01-05';
const DOW = diaDaSemanaDaData(DIA);

const senhaCorreta = (hashGuardado: string, senha: string): Promise<boolean> =>
  Promise.resolve(senha === 'Senha@123' && hashGuardado === HASH_FIXTURE);

const apps: App[] = [];
const criadas: string[] = [];

const logMudo: Registrador = { info: () => {}, warn: () => {}, error: () => {} };

async function novaApp(): Promise<App> {
  const app = await buildApp({ verificarSenha: senhaCorreta });
  await app.ready();
  apps.push(app);
  return app;
}

interface Cenario {
  clinicId: string;
  slug: string;
  userId: string;
  email: string;
  token: string;
  professionalId: string;
  therapyId: string;
}

/** Clinica com telefone e e-mail: e ela que recebe o aviso de novo pedido. */
async function criarCenario(app: App): Promise<Cenario> {
  const clinicId = randomUUID();
  const userId = randomUUID();
  const email = `${randomUUID()}@teste.local`;
  const professionalId = randomUUID();
  const therapyId = randomUUID();
  const sufixo = clinicId.slice(0, 8);

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
    data: { id: userId, email, passwordHash: HASH_FIXTURE, name: 'Usuario de Teste' },
  });
  await prisma.clinicMembership.create({ data: { clinicId, userId, role: 'ADMIN' } });
  await prisma.professional.create({
    data: { id: professionalId, clinicId, name: 'Profissional de Teste' },
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
  await prisma.availabilityRule.create({
    data: {
      clinicId,
      professionalId,
      weekday: DOW,
      startMinute: 9 * 60,
      endMinute: 18 * 60,
      slotGranularityMinutes: 60,
      effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    },
  });

  criadas.push(clinicId);

  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, senha: 'Senha@123' },
  });
  const token = corpoDe<{ accessToken: string }>(login).accessToken;

  return { clinicId, slug: `clinica-${sufixo}`, userId, email, token, professionalId, therapyId };
}

function corpoDe<T>(resposta: { json(): unknown }): T {
  return resposta.json() as T;
}

function comToken(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function localHora(hora: number, dia = DIA): string {
  return utcDeLocal({ ...parseDataLocal(dia), hour: hora, minute: 0 }, TZ).toISOString();
}

/** Reserva pelo portal publico: e o caminho que gera o aviso mais completo. */
async function agendarPeloPortal(
  app: App,
  cenario: Cenario,
  hora: number,
  campos: { phone?: string; email?: string; marketingOptIn?: boolean } = {},
): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: `/public/clinics/${cenario.slug}/appointments`,
    payload: {
      therapyId: cenario.therapyId,
      professionalId: cenario.professionalId,
      startAt: localHora(hora),
      name: 'Ana Cliente',
      phone: campos.phone ?? '5551999998888',
      ...(campos.email === undefined ? {} : { email: campos.email }),
      ...(campos.marketingOptIn === undefined ? {} : { marketingOptIn: campos.marketingOptIn }),
    },
  });

  expect(resposta.statusCode).toBe(201);
  return corpoDe<{ id: string }>(resposta).id;
}

async function notificacoes(appointmentId: string) {
  return prisma.notification.findMany({ where: { appointmentId }, orderBy: { createdAt: 'asc' } });
}

function resumo(appointmentId: string): Promise<string[]> {
  return notificacoes(appointmentId).then((linhas) =>
    linhas.map((linha) => `${linha.type}:${linha.channel}:${linha.status}`),
  );
}

afterEach(async () => {
  const doTeste = criadas.splice(0, criadas.length);
  if (doTeste.length === 0) return;

  await prisma.appointment.deleteMany({ where: { clinicId: { in: doTeste } } });
  await prisma.clinic.deleteMany({ where: { id: { in: doTeste } } });
});

afterAll(async () => {
  for (const app of apps) {
    await app.close();
  }
  await disconnectPrisma();
});

describe('texto das notificacoes', () => {
  const contexto: ContextoSessao = {
    clinica: 'Clinica Aurora',
    fuso: TZ,
    status: 'AGENDADO_PENDENTE',
    cliente: 'Ana Souza',
    profissional: 'Dra. Beatriz',
    terapia: 'Massagem Relaxante',
    inicio: utcDeLocal({ ...parseDataLocal(DIA), hour: 9, minute: 0 }, TZ),
  };

  it('formata a data no fuso da clinica, e nao no do servidor', () => {
    expect(formatarQuando(contexto.inicio, TZ)).toBe('05/01/2099 as 09:00');
    expect(formatarQuando(contexto.inicio, 'UTC')).toBe('05/01/2099 as 12:00');
  });

  it('usa o texto de pedido quando a reserva ainda nao foi confirmada', () => {
    const { corpo } = montarMensagem('CONFIRMACAO_AGENDAMENTO', 'WHATSAPP', contexto);
    expect(corpo).toContain('Recebemos seu pedido de horario');
    expect(corpo).toContain('05/01/2099 as 09:00');
    // WhatsApp nao tem assunto.
    expect(montarMensagem('CONFIRMACAO_AGENDAMENTO', 'WHATSAPP', contexto).assunto).toBeNull();
  });

  it('usa o texto de confirmado depois que a clinica aceitou', () => {
    const confirmado = montarMensagem('CONFIRMACAO_AGENDAMENTO', 'EMAIL', {
      ...contexto,
      status: 'CONFIRMADO',
    });
    expect(confirmado.corpo).toContain('esta confirmado');
    expect(confirmado.assunto).toBe('Agendamento confirmado - Clinica Aurora');
  });

  it('compara o horario antigo e o novo no reagendamento', () => {
    const { corpo } = montarMensagem('REAGENDAMENTO', 'WHATSAPP', {
      ...contexto,
      inicioAnterior: utcDeLocal({ ...parseDataLocal(DIA), hour: 14, minute: 0 }, TZ),
    });
    expect(corpo).toContain('Antes: 05/01/2099 as 14:00');
    expect(corpo).toContain('Agora: 05/01/2099 as 09:00');
  });

  it('traduz o motivo do cancelamento', () => {
    const { corpo } = montarMensagem('CANCELAMENTO', 'EMAIL', {
      ...contexto,
      motivo: 'CONDICAO_CLINICA',
    });
    expect(corpo).toContain('foi cancelado');
    expect(corpo).toContain('Motivo: Condicao clinica contraindicada');
  });

  it('trata o aviso para a clinica como mensagem interna, com status', () => {
    const { corpo } = montarMensagem('NOVO_AGENDAMENTO', 'EMAIL', contexto);
    expect(corpo).toContain('Cliente: Ana Souza');
    expect(corpo).toContain('Status: Aguardando confirmacao');
  });
});

describe('gatilhos de agenda', () => {
  it('avisa o cliente e a clinica, e agenda o lembrete', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const appointmentId = await agendarPeloPortal(app, cenario, 9, {
      email: 'ana@teste.local',
      marketingOptIn: true,
    });

    const linhas = await notificacoes(appointmentId);

    // Cliente: pedido recebido + lembrete, nos dois canais (aceitou WhatsApp).
    const doCliente = linhas.filter((linha) => linha.type !== 'NOVO_AGENDAMENTO');
    expect(doCliente.map((l) => `${l.type}:${l.channel}`).sort()).toEqual([
      'CONFIRMACAO_AGENDAMENTO:EMAIL',
      'CONFIRMACAO_AGENDAMENTO:WHATSAPP',
      'LEMBRETE:EMAIL',
      'LEMBRETE:WHATSAPP',
    ]);

    // Clinica: o pedido veio do portal, entao ela e avisada.
    const daClinica = linhas.filter((linha) => linha.type === 'NOVO_AGENDAMENTO');
    expect(daClinica.map((l) => l.channel).sort()).toEqual(['EMAIL', 'WHATSAPP']);
    expect(
      daClinica.every(
        (l) => l.recipient.endsWith('@teste.local') || l.recipient === '5551300000001',
      ),
    ).toBe(true);

    // Nada foi enviado: a fila nao sobe na suite, e o lembrete e o dia anterior.
    expect(linhas.every((linha) => linha.status === 'PENDENTE')).toBe(true);
    const lembrete = linhas.find((linha) => linha.type === 'LEMBRETE' && linha.channel === 'EMAIL');
    expect(lembrete?.scheduledFor.toISOString()).toBe(localHora(9, '2099-01-04'));
    expect(lembrete?.subject).toBe('Lembrete de horario - Clinica de Teste');
  });

  it('respeita o consentimento: sem aceite nao sai WhatsApp, mas sai e-mail', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const appointmentId = await agendarPeloPortal(app, cenario, 10, {
      email: 'ana@teste.local',
      marketingOptIn: false,
    });

    // O consentimento e do cliente. A clinica continua recebendo por WhatsApp:
    // o telefone dela e o contato comercial, nao uma mensagem de marketing.
    const doCliente = (await notificacoes(appointmentId)).filter(
      (linha) => linha.type !== 'NOVO_AGENDAMENTO',
    );
    expect(doCliente.map((linha) => linha.channel)).not.toContain('WHATSAPP');
    expect(doCliente.map((linha) => linha.channel)).toContain('EMAIL');
    expect(doCliente.every((linha) => linha.recipient === 'ana@teste.local')).toBe(true);
  });

  it('nao avisa a clinica quando o agendimento sai do painel dela', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const cliente = await prisma.client.create({
      data: {
        clinicId: cenario.clinicId,
        name: 'Cliente do Painel',
        email: 'painel@teste.local',
        phone: '5551988887777',
        marketingOptIn: true,
      },
    });

    const criada = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: comToken(cenario.token),
      payload: {
        clientId: cliente.id,
        professionalId: cenario.professionalId,
        therapyId: cenario.therapyId,
        startAt: localHora(11),
      },
    });
    expect(criada.statusCode).toBe(201);

    const appointmentId = corpoDe<{ id: string }>(criada).id;
    const linhas = await notificacoes(appointmentId);

    expect(linhas.some((linha) => linha.type === 'NOVO_AGENDAMENTO')).toBe(false);
    // Quem agenda pelo painel e avisado: ele pode nao estar olhando o celular.
    expect(linhas.some((linha) => linha.type === 'CONFIRMACAO_AGENDAMENTO')).toBe(true);
  });

  it('confirma, cancela e aposenta o lembrete na transicao de status', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const appointmentId = await agendarPeloPortal(app, cenario, 13, {
      email: 'ana@teste.local',
      marketingOptIn: true,
    });

    const confirmou = await app.inject({
      method: 'PATCH',
      url: `/appointments/${appointmentId}/status`,
      headers: comToken(cenario.token),
      payload: { status: 'CONFIRMADO' },
    });
    expect(confirmou.statusCode).toBe(200);

    const aposConfirmar = await notificacoes(appointmentId);
    const confirmacao = aposConfirmar.filter(
      (linha) => linha.type === 'CONFIRMACAO_AGENDAMENTO' && linha.channel === 'EMAIL',
    );
    expect(confirmacao).toHaveLength(2);
    expect(confirmacao[1]?.subject).toBe('Agendamento confirmado - Clinica de Teste');
    // O lembrete continua de pe: a sessao agora esta confirmada.
    expect(
      aposConfirmar
        .filter((linha) => linha.type === 'LEMBRETE')
        .every((l) => l.status === 'PENDENTE'),
    ).toBe(true);

    const cancelou = await app.inject({
      method: 'PATCH',
      url: `/appointments/${appointmentId}/status`,
      headers: comToken(cenario.token),
      payload: { status: 'CANCELADO', cancellationReason: 'CLIENTE_DESISTIU' },
    });
    expect(cancelou.statusCode).toBe(200);

    const depois = await resumo(appointmentId);
    // 4 do cliente (2 confirmacao + 2 lembrete) + 2 da clinica + 2 do cancelamento.
    expect(depois.filter((linha) => linha.endsWith(':LEMBRETE:PENDENTE'))).toHaveLength(0);
    expect(depois.filter((linha) => linha === 'LEMBRETE:EMAIL:CANCELADO')).toHaveLength(1);
    expect(depois.filter((linha) => linha === 'LEMBRETE:WHATSAPP:CANCELADO')).toHaveLength(1);
    expect(depois.filter((linha) => linha.startsWith('CANCELAMENTO:'))).toHaveLength(2);

    const cancelamento = (await notificacoes(appointmentId)).find(
      (linha) => linha.type === 'CANCELAMENTO' && linha.channel === 'EMAIL',
    );
    expect(cancelamento?.body).toContain('Motivo: Cliente desistiu');
  });

  it('reagendamento avisa a troca e troca o lembrete pelo horario novo', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const appointmentId = await agendarPeloPortal(app, cenario, 15, {
      email: 'ana@teste.local',
      marketingOptIn: true,
    });

    const remarcou = await app.inject({
      method: 'PATCH',
      url: `/appointments/${appointmentId}`,
      headers: comToken(cenario.token),
      payload: { startAt: localHora(16) },
    });
    expect(remarcou.statusCode).toBe(200);

    const linhas = await notificacoes(appointmentId);
    const reagendamentos = linhas.filter((linha) => linha.type === 'REAGENDAMENTO');
    expect(reagendamentos).toHaveLength(2);
    expect(reagendamentos[0]?.body).toContain('Antes: 05/01/2099 as 15:00');

    const lembretes = linhas.filter(
      (linha) => linha.type === 'LEMBRETE' && linha.channel === 'EMAIL',
    );
    expect(lembretes).toHaveLength(2);
    expect(lembretes[0]?.status).toBe('CANCELADO');
    expect(lembretes[1]?.status).toBe('PENDENTE');
    expect(lembretes[1]?.scheduledFor.toISOString()).toBe(localHora(16, '2099-01-04'));
  });

  it('editar sem mexer no horario nao gera aviso', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const appointmentId = await agendarPeloPortal(app, cenario, 17, { marketingOptIn: true });

    const editou = await app.inject({
      method: 'PATCH',
      url: `/appointments/${appointmentId}`,
      headers: comToken(cenario.token),
      payload: { notes: 'Levar propria toalha' },
    });
    expect(editou.statusCode).toBe(200);

    expect(await resumo(appointmentId)).not.toContain('REAGENDAMENTO:EMAIL:PENDENTE');
  });
});

describe('envio da notificacao', () => {
  interface EnvioRegistrado {
    canal: string;
    para: string;
  }

  interface CanaisFalsos {
    canais: Canais;
    enviados: EnvioRegistrado[];
  }

  /**
   * Canais falsos com falha programavel. O worker real so e testado assim: o
   * Evolution API e o SMTP nao ficam no caminho da suite, e o que importa aqui
   * e a transicao de status da linha, nao a entrega.
   */
  function canais(quebrado: 'nenhum' | 'WHATSAPP' | 'EMAIL' = 'nenhum'): CanaisFalsos {
    const enviados: EnvioRegistrado[] = [];

    const enviar = (
      canal: 'WHATSAPP' | 'EMAIL',
      para: string,
      identificador: string,
      erro: string,
    ): Promise<string> => {
      enviados.push({ canal, para });
      return canal === quebrado ? Promise.reject(new Error(erro)) : Promise.resolve(identificador);
    };

    return {
      enviados,
      canais: {
        whatsapp: {
          enviar({ para }) {
            return enviar('WHATSAPP', para, 'WA-EXTERNO-1', 'Evolution API fora do ar');
          },
        },
        email: {
          enviar({ para }) {
            return enviar('EMAIL', para, 'MSG-EXTERNA-1', 'SMTP recusou a conexao');
          },
        },
      },
    };
  }

  async function criarLinha(
    clinicId: string,
    channel: 'WHATSAPP' | 'EMAIL' | 'SMS',
    scheduledFor: Date,
  ): Promise<string> {
    const linha = await prisma.notification.create({
      data: {
        clinicId,
        channel,
        type: 'LEMBRETE',
        recipient: '5551999998888',
        subject: channel === 'EMAIL' ? 'Lembrete' : null,
        body: 'Oi, Ana! Passando para lembrar.',
        scheduledFor,
      },
    });
    criadas.push(clinicId);
    return linha.id;
  }

  it('marca como enviada e guarda o identificador do transporte', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const id = await criarLinha(cenario.clinicId, 'EMAIL', new Date(Date.now() - 60_000));

    const { canais: canaisFalsos, enviados } = canais();
    const resultado = await processarNotificacao(id, logMudo, canaisFalsos);

    expect(resultado.situacao).toBe('ENVIADO');
    expect(resultado.externalId).toBe('MSG-EXTERNA-1');
    expect(enviados).toEqual([{ canal: 'EMAIL', para: '5551999998888' }]);

    const linha = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(linha.status).toBe('ENVIADO');
    expect(linha.attempts).toBe(1);
    expect(linha.sentAt).not.toBeNull();
    expect(linha.lastError).toBeNull();
  });

  it('nao reenvia o que ja saiu', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const id = await criarLinha(cenario.clinicId, 'WHATSAPP', new Date(Date.now() - 60_000));

    const { canais: canaisFalsos, enviados } = canais();
    await processarNotificacao(id, logMudo, canaisFalsos);
    const segunda = await processarNotificacao(id, logMudo, canaisFalsos);

    expect(segunda.situacao).toBe('IGNORADO');
    expect(enviados).toHaveLength(1);
  });

  it('registra a falha e deixa a linha pronta para nova tentativa', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const id = await criarLinha(cenario.clinicId, 'EMAIL', new Date(Date.now() - 60_000));

    const resultado = await processarNotificacao(id, logMudo, canais('EMAIL').canais);

    expect(resultado.situacao).toBe('ERRO');
    expect(resultado.erro).toBe('SMTP recusou a conexao');

    const linha = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(linha.status).toBe('ERRO');
    expect(linha.attempts).toBe(1);
    expect(linha.lastError).toBe('SMTP recusou a conexao');
    expect(linha.sentAt).toBeNull();
  });

  it('conta cada tentativa, inclusive depois da falha', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const id = await criarLinha(cenario.clinicId, 'WHATSAPP', new Date(Date.now() - 60_000));

    const primeira = await processarNotificacao(id, logMudo, canais('WHATSAPP').canais);
    const segunda = await processarNotificacao(id, logMudo, canais('WHATSAPP').canais);
    const terceira = await processarNotificacao(id, logMudo, canais().canais);

    expect(primeira.tentativas).toBe(1);
    expect(segunda.tentativas).toBe(2);
    expect(terceira.situacao).toBe('ENVIADO');

    const linha = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(linha.attempts).toBe(3);
    expect(linha.status).toBe('ENVIADO');
  });

  it('nao envia antes da hora marcada e devolve o instante para rearmar', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const venceEm = new Date(Date.now() + 3_600_000);
    const id = await criarLinha(cenario.clinicId, 'EMAIL', venceEm);

    const { canais: canaisFalsos, enviados } = canais();
    const resultado = await processarNotificacao(id, logMudo, canaisFalsos);

    expect(resultado.situacao).toBe('ADIADO');
    expect(resultado.reagendarPara).toEqual(venceEm);
    expect(enviados).toHaveLength(0);
  });

  it('ignora linha ja cancelada', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const id = await criarLinha(cenario.clinicId, 'EMAIL', new Date(Date.now() - 60_000));

    await prisma.notification.update({ where: { id }, data: { status: 'CANCELADO' } });

    const { canais: canaisFalsos, enviados } = canais();
    const resultado = await processarNotificacao(id, logMudo, canaisFalsos);

    expect(resultado.situacao).toBe('IGNORADO');
    expect(enviados).toHaveLength(0);
  });

  it('falha visivel em canal sem transporte, em vez de marcar como enviado', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const id = await criarLinha(cenario.clinicId, 'SMS', new Date(Date.now() - 60_000));

    const resultado = await processarNotificacao(id, logMudo, canais().canais);

    expect(resultado.situacao).toBe('ERRO');
    expect(resultado.erro).toContain('SMS');

    const linha = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(linha.status).toBe('ERRO');
  });
});

describe('painel de notificacoes', () => {
  interface ItemPainel {
    id: string;
    clientName: string | null;
    recipient: string;
    status: string;
    attempts: number;
    lastError: string | null;
    subject: string | null;
    body: string;
  }

  interface ResumoPainel {
    total: number;
    pendente: number;
    enviando: number;
    enviado: number;
    erro: number;
    cancelado: number;
  }

  interface ListaPainel {
    items: ItemPainel[];
    total: number;
    resumo: ResumoPainel;
  }

  async function criarCliente(clinicId: string, nome: string, email: string): Promise<string> {
    const cliente = await prisma.client.create({
      data: { clinicId, name: nome, email, phone: '5551999998888', marketingOptIn: true },
    });
    return cliente.id;
  }

  async function criarAviso(
    clinicId: string,
    dados: {
      status?: 'PENDENTE' | 'ENVIANDO' | 'ENVIADO' | 'ERRO' | 'CANCELADO';
      channel?: 'WHATSAPP' | 'EMAIL' | 'SMS';
      clientId?: string;
      recipient?: string;
      attempts?: number;
      lastError?: string;
      scheduledFor?: Date;
      criadoEm?: Date;
    } = {},
  ): Promise<string> {
    const linha = await prisma.notification.create({
      data: {
        clinicId,
        clientId: dados.clientId ?? null,
        channel: dados.channel ?? 'EMAIL',
        type: 'LEMBRETE',
        recipient: dados.recipient ?? 'ana@teste.local',
        subject: 'Lembrete de horario - Clinica de Teste',
        body: 'Oi, Ana! Passando para lembrar do seu horario.',
        status: dados.status ?? 'PENDENTE',
        attempts: dados.attempts ?? 0,
        lastError: dados.lastError ?? null,
        scheduledFor: dados.scheduledFor ?? new Date(Date.now() + 3_600_000),
        ...(dados.criadoEm === undefined ? {} : { createdAt: dados.criadoEm }),
      },
    });
    criadas.push(clinicId);
    return linha.id;
  }

  /** Usuario sem permissao de escrita: o painel tem dados de contato do cliente. */
  async function tokenDeProfissional(app: App, cenario: Cenario): Promise<string> {
    const email = `prof-${randomUUID()}@teste.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash: HASH_FIXTURE, name: 'Profissional de Teste' },
    });
    await prisma.clinicMembership.create({
      data: { clinicId: cenario.clinicId, userId: user.id, role: 'PROFISSIONAL' },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, senha: 'Senha@123' },
    });
    return corpoDe<{ accessToken: string }>(login).accessToken;
  }

  it('lista da clinica do usuario, com o nome do cliente e o resumo por situacao', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const outro = await criarCenario(app);

    const clientId = await criarCliente(cenario.clinicId, 'Ana Souza', 'ana@teste.local');
    await criarAviso(cenario.clinicId, {
      status: 'ERRO',
      attempts: 3,
      lastError: 'SMTP recusou',
      clientId,
      recipient: 'ana@teste.local',
      criadoEm: new Date('2099-01-01T10:00:00.000Z'),
    });
    await criarAviso(cenario.clinicId, {
      status: 'ENVIADO',
      clientId,
      recipient: 'ana@teste.local',
      criadoEm: new Date('2099-01-02T10:00:00.000Z'),
    });
    await criarAviso(cenario.clinicId, {
      status: 'PENDENTE',
      clientId,
      recipient: 'ana@teste.local',
      criadoEm: new Date('2099-01-03T10:00:00.000Z'),
    });
    // A clinica vizinha nao aparece: o tenant vem da sessao, nao da URL.
    await criarAviso(outro.clinicId);

    const resposta = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: comToken(cenario.token),
    });

    expect(resposta.statusCode).toBe(200);
    const corpo = corpoDe<ListaPainel>(resposta);

    expect(corpo.total).toBe(3);
    expect(corpo.items).toHaveLength(3);
    expect(corpo.items.every((linha) => linha.clientName === 'Ana Souza')).toBe(true);
    // Mais recente primeiro: o aviso que a clinica acabou de ver e o primeiro.
    expect(corpo.items.map((linha) => linha.status)).toEqual(['PENDENTE', 'ENVIADO', 'ERRO']);
    expect(corpo.resumo).toEqual({
      total: 3,
      pendente: 1,
      enviando: 0,
      enviado: 1,
      erro: 1,
      cancelado: 0,
    });
  });

  it('filtra por situacao e busca por destinatario ou nome do cliente', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const clientId = await criarCliente(cenario.clinicId, 'Bruno Lima', 'bruno@teste.local');
    await criarAviso(cenario.clinicId, {
      status: 'ERRO',
      clientId,
      recipient: 'bruno@teste.local',
    });
    await criarAviso(cenario.clinicId, {
      status: 'ENVIADO',
      clientId,
      recipient: 'outro@teste.local',
    });
    await criarAviso(cenario.clinicId, {
      status: 'ERRO',
      recipient: '5551977776666',
    });

    const comFiltro = await app.inject({
      method: 'GET',
      url: '/notifications?status=ERRO&limit=1',
      headers: comToken(cenario.token),
    });
    const corpoFiltro = corpoDe<ListaPainel>(comFiltro);
    expect(corpoFiltro.total).toBe(2);
    // O limite vale, mas o total da pagina continua sendo da clinic inteira.
    expect(corpoFiltro.items).toHaveLength(1);
    // O resumo ignora o filtro: e a contagem que diz se ha falha a tratar.
    expect(corpoFiltro.resumo.erro).toBe(2);
    expect(corpoFiltro.resumo.enviado).toBe(1);

    const porNome = await app.inject({
      method: 'GET',
      url: '/notifications?search=bruno',
      headers: comToken(cenario.token),
    });
    const corpoNome = corpoDe<ListaPainel>(porNome);
    // A busca e "destinatario OU nome do cliente": os dois avisos do Bruno
    // entram, mesmo o que foi enviado para outro endereco.
    expect(corpoNome.total).toBe(2);
    expect(corpoNome.items.every((linha) => linha.clientName === 'Bruno Lima')).toBe(true);

    const porDestinatario = await app.inject({
      method: 'GET',
      url: '/notifications?search=55519777',
      headers: comToken(cenario.token),
    });
    expect(corpoDe<ListaPainel>(porDestinatario).total).toBe(1);

    const invalido = await app.inject({
      method: 'GET',
      url: '/notifications?status=SITUACAO_QUE_NAO_EXISTE',
      headers: comToken(cenario.token),
    });
    expect(invalido.statusCode).toBe(422);
    expect(corpoDe<{ error: string }>(invalido).error).toBe('VALIDATION_ERROR');
  });

  it('nao deixa quem nao e ADMIN ver o painel', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    await criarAviso(cenario.clinicId);
    const token = await tokenDeProfissional(app, cenario);

    const listagem = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: comToken(token),
    });
    expect(listagem.statusCode).toBe(403);
    expect(corpoDe<{ error: string }>(listagem).error).toBe('FORBIDDEN');
  });

  it('reenvio limpa a falha, zera as tentativas e joga para agora', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const clientId = await criarCliente(cenario.clinicId, 'Ana Souza', 'ana@teste.local');
    const id = await criarAviso(cenario.clinicId, {
      status: 'ERRO',
      clientId,
      attempts: 3,
      lastError: 'SMTP recusou a conexao',
      scheduledFor: new Date(Date.now() + 86_400_000),
    });
    await prisma.notification.update({ where: { id }, data: { sentAt: new Date() } });

    const resposta = await app.inject({
      method: 'POST',
      url: `/notifications/${id}/reenviar`,
      headers: comToken(cenario.token),
    });

    expect(resposta.statusCode).toBe(200);
    const { notification } = corpoDe<{ notification: ItemPainel & { scheduledFor: string } }>(
      resposta,
    );
    expect(notification.status).toBe('PENDENTE');
    expect(notification.attempts).toBe(0);
    expect(notification.lastError).toBeNull();
    // Sem reagendar para agora o worker devolveria a linha para a data original.
    expect(Math.abs(new Date(notification.scheduledFor).getTime() - Date.now())).toBeLessThan(
      10_000,
    );

    const linha = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(linha.status).toBe('PENDENTE');
    expect(linha.attempts).toBe(0);
    expect(linha.lastError).toBeNull();
    expect(linha.sentAt).toBeNull();
    expect(linha.externalId).toBeNull();
  });

  it('reenvia tambem o aviso que o cliente diz que nao recebeu', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);

    const id = await criarAviso(cenario.clinicId, {
      status: 'ENVIADO',
      attempts: 1,
      scheduledFor: new Date(Date.now() - 60_000),
    });

    const resposta = await app.inject({
      method: 'POST',
      url: `/notifications/${id}/reenviar`,
      headers: comToken(cenario.token),
    });

    expect(resposta.statusCode).toBe(200);
    expect(corpoDe<{ notification: ItemPainel }>(resposta).notification.status).toBe('PENDENTE');
  });

  it('recusa o que esta em envio, o cancelado e o que e de outra clinica', async () => {
    const app = await novaApp();
    const cenario = await criarCenario(app);
    const outro = await criarCenario(app);

    const emVoo = await criarAviso(cenario.clinicId, { status: 'ENVIANDO' });
    const cancelado = await criarAviso(cenario.clinicId, { status: 'CANCELADO' });
    const alheio = await criarAviso(outro.clinicId, { status: 'ERRO' });

    const emVooResposta = await app.inject({
      method: 'POST',
      url: `/notifications/${emVoo}/reenviar`,
      headers: comToken(cenario.token),
    });
    expect(emVooResposta.statusCode).toBe(409);
    expect(corpoDe<{ error: string }>(emVooResposta).error).toBe('NOTIFICATION_IN_FLIGHT');
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: emVoo } })).status).toBe(
      'ENVIANDO',
    );

    const canceladoResposta = await app.inject({
      method: 'POST',
      url: `/notifications/${cancelado}/reenviar`,
      headers: comToken(cenario.token),
    });
    expect(canceladoResposta.statusCode).toBe(409);
    expect(corpoDe<{ error: string }>(canceladoResposta).error).toBe('NOTIFICATION_CANCELLED');

    // 404 e nao 403: o painel nem confirma que o aviso existe em outra clinica.
    const alheioResposta = await app.inject({
      method: 'POST',
      url: `/notifications/${alheio}/reenviar`,
      headers: comToken(cenario.token),
    });
    expect(alheioResposta.statusCode).toBe(404);
    expect(corpoDe<{ error: string }>(alheioResposta).error).toBe('NOTIFICATION_NOT_FOUND');
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: alheio } })).status).toBe(
      'ERRO',
    );
  });

  it('exige sessao valida', async () => {
    const app = await novaApp();
    await criarCenario(app);

    const listagem = await app.inject({ method: 'GET', url: '/notifications' });
    expect(listagem.statusCode).toBe(401);
  });
});
