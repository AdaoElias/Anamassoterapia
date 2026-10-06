import { createHash } from 'node:crypto';

import {
  ALERT_SEVERITY_LABELS,
  type AlertSeverity,
  blocksSlot,
  type NotificationChannel,
  type NotificationType,
} from '@massoterapia/shared';

import type { Prisma } from '../../generated/prisma/client.js';
import { enfileirar } from '../notificacoes/fila.js';
import { type ContextoSessao, montarMensagem } from '../notificacoes/mensagens.js';
import { prisma } from '../prisma.js';
import { anamneseVigente } from './servico.js';

/**
 * Avaliacao clinica no momento em que a sessao entra na agenda.
 *
 * Roda **depois** do commit da sessao, junto com os gatilhos de notificacao,
 * e nunca dentro da transacao: o aviso e um efeito colateral, e falhar aqui
 * nao pode desfazer uma reserva que ja tem horario travado.
 *
 * Tres responsabilidades, e nenhuma delas bloqueia:
 *
 * 1. **Contraindicacao**: cruza as condicoes de saude ativas do cliente com
 *    as contraindicacoes que a clinica vinculou a terapia e cria um
 *    `ContraindicationAlert` por combinacao. O sistema avisa; quem decide e o
 *    profissional com o cliente na mesa.
 * 2. **Anamnese**: terapia com `requiresAnamnesis` e cliente sem versao
 *    aprovada gera aviso para a equipe. Nao bloqueia a agenda -- a agenda e
 *    da clinica. O que nao pode acontecer e o atendimento sem o documento.
 * 3. **Aviso**: as duas situacoes viram linhas na outbox, com a mesma
 *    idempotencia dos outros gatilhos (`dedupeKey` + `upsert`).
 */

const sessaoSelect = {
  id: true,
  clinicId: true,
  clientId: true,
  startAt: true,
  status: true,
  therapy: { select: { id: true, name: true, requiresAnamnesis: true } },
  client: { select: { id: true, name: true } },
  professional: { select: { name: true, user: { select: { email: true } } } },
  clinic: { select: { name: true, timezone: true, phone: true, email: true } },
} as const;

type Sessao = Prisma.AppointmentGetPayload<{ select: typeof sessaoSelect }>;

interface Destinatario {
  canal: NotificationChannel;
  endereco: string;
}

interface CondicaoAtiva {
  id: string;
  title: string;
  code: string;
  contraindicationId: string | null;
  severity: AlertSeverity;
  requiresMedicalClearance: boolean;
}

interface Vinculo {
  contraindicationId: string;
  codigo: string;
  titulo: string;
  severity: AlertSeverity | null;
  requiresMedicalClearance: boolean | null;
}

export interface ResultadoAvaliacao {
  /** Alertas novos nesta sessao. Alerta repetido nao conta. */
  alertasCriados: number;
  anamnesePendente: boolean;
}

function contextoDe(sessao: Sessao, detalhe: string | null): ContextoSessao {
  return {
    clinica: sessao.clinic.name,
    fuso: sessao.clinic.timezone,
    status: sessao.status,
    cliente: sessao.client.name,
    profissional: sessao.professional.name,
    terapia: sessao.therapy.name,
    inicio: sessao.startAt,
    detalhe,
  };
}

/**
 * A equipe recebe o aviso. O telefone da clinica e contato comercial e vai
 * direto; o profissional so por e-mail, e apenas quando tem acesso ao painel
 * -- que e o canal que ele autorizou ao entrar.
 */
function destinosDaEquipe(sessao: Sessao): Destinatario[] {
  const destinos: Destinatario[] = [];

  if (sessao.clinic.phone !== null) {
    destinos.push({ canal: 'WHATSAPP', endereco: sessao.clinic.phone });
  }
  if (sessao.clinic.email !== null) {
    destinos.push({ canal: 'EMAIL', endereco: sessao.clinic.email });
  }
  if (sessao.professional.user !== null) {
    destinos.push({ canal: 'EMAIL', endereco: sessao.professional.user.email });
  }

  return destinos;
}

async function avisar(
  sessao: Sessao,
  tipo: NotificationType,
  contexto: ContextoSessao,
): Promise<void> {
  for (const destino of destinosDaEquipe(sessao)) {
    const { assunto, corpo } = montarMensagem(tipo, destino.canal, contexto);
    // O destinatario entra na chave: clinica e profissional podem receber
    // no mesmo canal e cada um precisa da sua linha na outbox. O endereco
    // vai como digest para nao repetir dado pessoal em campo indexado.
    const dedupeKey = `${tipo}:${sessao.id}:${destino.canal}:${createHash('sha256')
      .update(destino.endereco.toLowerCase())
      .digest('hex')
      .slice(0, 16)}`;

    const linha = await prisma.notification.upsert({
      where: { dedupeKey },
      create: {
        clinicId: sessao.clinicId,
        clientId: sessao.client.id,
        appointmentId: sessao.id,
        channel: destino.canal,
        type: tipo,
        recipient: destino.endereco,
        subject: assunto,
        body: corpo,
        scheduledFor: new Date(),
        dedupeKey,
      },
      update: {},
    });

    enfileirar(linha.id, linha.scheduledFor);
  }
}

/**
 * Condicoes do cliente que casam com as contraindicacoes da terapia.
 *
 * O casamento e por `contraindicationId` quando a condicao veio do catalogo,
 * e por codigo quando ela foi registrada avulsa. Sem catalogo e sem codigo
 * conhecido nao da para afirmar nada -- e "nao da para afirmar" e exatamente
 * o caso em que o sistema **nao** gera alerta.
 */
async function condicoesQueCombinam(
  clinicId: string,
  clientId: string,
  therapyId: string,
): Promise<Array<{ condicao: CondicaoAtiva; vinculo: Vinculo }>> {
  const condicoes: CondicaoAtiva[] = await prisma.clientContraindication.findMany({
    where: { clinicId, clientId, resolvedAt: null },
  });
  if (condicoes.length === 0) return [];

  const vinculos = await prisma.therapyContraindication.findMany({
    where: { clinicId, therapyId },
    include: { contraindication: { select: { id: true, code: true, title: true } } },
  });
  if (vinculos.length === 0) return [];

  const pares: Array<{ condicao: CondicaoAtiva; vinculo: Vinculo }> = [];

  for (const condicao of condicoes) {
    const achado = vinculos.find((candidato) =>
      condicao.contraindicationId !== null
        ? candidato.contraindicationId === condicao.contraindicationId
        : candidato.contraindication.code === condicao.code,
    );
    if (achado === undefined) continue;

    pares.push({
      condicao,
      vinculo: {
        contraindicationId: achado.contraindicationId,
        codigo: achado.contraindication.code,
        titulo: achado.contraindication.title,
        severity: achado.severity,
        requiresMedicalClearance: achado.requiresMedicalClearance,
      },
    });
  }

  return pares;
}

/** Cria os alertas que ainda nao existem para esta sessao. */
async function criarAlertas(
  sessao: Sessao,
  pares: Array<{ condicao: CondicaoAtiva; vinculo: Vinculo }>,
): Promise<number> {
  if (pares.length === 0) return 0;

  const jaAvisadas = await prisma.contraindicationAlert.findMany({
    where: {
      appointmentId: sessao.id,
      clientContraindicationId: { in: pares.map((par) => par.condicao.id) },
    },
    select: { clientContraindicationId: true },
  });
  const jaAvisados = new Set(jaAvisadas.map((linha) => linha.clientContraindicationId));

  let criados = 0;

  for (const { condicao, vinculo } of pares) {
    if (jaAvisados.has(condicao.id)) continue;

    // O override da clinica vence a condicao do cliente: quem configurou a
    // terapia e quem sabe o risco naquele atendimento.
    const severity = vinculo.severity ?? condicao.severity;
    const exigeAtestado = vinculo.requiresMedicalClearance ?? condicao.requiresMedicalClearance;

    const message =
      `${condicao.title} (${vinculo.titulo}, severidade ${ALERT_SEVERITY_LABELS[severity]}).` +
      `${exigeAtestado ? ' Exige atestado medico para autorizar a sessao.' : ''}`;

    await prisma.contraindicationAlert.create({
      data: {
        clinicId: sessao.clinicId,
        appointmentId: sessao.id,
        clientContraindicationId: condicao.id,
        contraindicationId: vinculo.contraindicationId,
        severity,
        message,
      },
    });

    criados += 1;
  }

  return criados;
}

/**
 * Avalia a sessao recem-criada. Devolve o que aconteceu para o chamador
 * registrar no log; quem decide o que fazer com o resultado e a rota.
 */
export async function avaliarSessao(appointmentId: string): Promise<ResultadoAvaliacao> {
  const sessao = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: sessaoSelect,
  });

  if (sessao === null) return { alertasCriados: 0, anamnesePendente: false };

  // Sessao cancelada ou com falta nao vai ser atendida: avisar contraindicao
  // dela seria repetir o mesmo alerta toda vez que o cliente desiste.
  if (!blocksSlot(sessao.status)) return { alertasCriados: 0, anamnesePendente: false };

  const pares = await condicoesQueCombinam(sessao.clinicId, sessao.clientId, sessao.therapy.id);
  const alertasCriados = await criarAlertas(sessao, pares);

  if (alertasCriados > 0) {
    await avisar(
      sessao,
      'ALERTA_CONTRAINDICACAO',
      contextoDe(sessao, pares[0]?.condicao.title ?? null),
    );
  }

  let anamnesePendente = false;

  if (sessao.therapy.requiresAnamnesis) {
    const vigente = await anamneseVigente(sessao.clinicId, sessao.clientId);

    if (vigente === null) {
      anamnesePendente = true;
      await avisar(
        sessao,
        'ANAMNESE_PENDENTE',
        contextoDe(sessao, 'Esta terapia exige anamnese aprovada e o cliente ainda nao tem uma.'),
      );
    }
  }

  return { alertasCriados, anamnesePendente };
}

/**
 * Congela a versao da anamnese usada na sessao.
 *
 * Roda quando a sessao entra em atendimento: e o momento em que o
 * profissional le o prontuario. Guardar o id aqui e o que permite provar,
 * depois, que ele leu a versao 2 mesmo que hoje exista a 4.
 */
export async function vincularAnamnese(appointmentId: string): Promise<void> {
  const sessao = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, clinicId: true, clientId: true },
  });
  if (sessao === null) return;

  const vigente = await anamneseVigente(sessao.clinicId, sessao.clientId);
  if (vigente === null) return;

  await prisma.appointmentAnamnesis.upsert({
    where: { appointmentId: sessao.id },
    create: { clinicId: sessao.clinicId, appointmentId: sessao.id, anamnesisId: vigente.id },
    update: {},
  });
}
