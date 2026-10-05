import {
  blocksSlot,
  CONSENT_FLAG_WHATSAPP,
  type NotificationChannel,
  type NotificationType,
  temConsentimento,
} from '@massoterapia/shared';

import { env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../prisma.js';
import { enfileirar } from './fila.js';
import { type ContextoSessao, montarMensagem } from './mensagens.js';

/**
 * Gatilhos: evento de negocio -> linhas na outbox.
 *
 * Sao chamados *depois* do commit da transacao que muda o agendamento, nunca
 * dentro dela. Notificar antes do commit e como avisar "seu horario foi
 * cancelado" sobre uma reserva que ainda pode voltar -- e, se a transacao
 * falhar depois, fica um aviso que ninguem pode cancelar.
 *
 * WhatsApp so com consentimento; e-mail de aviso operacional sempre. O
 * motivo: confirmacao e lembrete sao transacionais (o cliente pediu), mas
 * exigir consentimento de marketing para confirmar um horario que ele mesmo
 * marcou faria a agenda parecer quebrada.
 */

const sessaoSelect = {
  id: true,
  clinicId: true,
  startAt: true,
  status: true,
  source: true,
  cancellationReason: true,
  clinic: { select: { name: true, timezone: true, phone: true, email: true } },
  client: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      marketingOptIn: true,
      user: { select: { consentFlags: true } },
    },
  },
  professional: { select: { name: true } },
  therapy: { select: { name: true } },
} as const;

type Sessao = Prisma.AppointmentGetPayload<{ select: typeof sessaoSelect }>;
type ClienteDaSessao = Sessao['client'];

interface Destinatario {
  canal: NotificationChannel;
  endereco: string;
}

interface Pedido {
  type: NotificationType;
  canal: NotificationChannel;
  destinatario: string;
  assunto: string | null;
  corpo: string;
  agendadaPara: Date;
  /**
   * `null` em aviso que acontece uma unica vez por reserva (confirmacao,
   * cancelamento): repetir a transicao nao gera aviso novo. No lembrete a
   * chave leva o horario, porque reagendar precisa de um lembrete novo.
   */
  chaveDedupe: string | null;
}

async function carregarSessao(appointmentId: string): Promise<Sessao | null> {
  return prisma.appointment.findUnique({ where: { id: appointmentId }, select: sessaoSelect });
}

/** Consentimento de WhatsApp: o aceite do portal ou a flag do usuario. */
function consentiuWhatsApp(cliente: ClienteDaSessao): boolean {
  if (cliente.marketingOptIn) return true;
  return (
    cliente.user !== null && temConsentimento(cliente.user.consentFlags, CONSENT_FLAG_WHATSAPP)
  );
}

function destinosDoCliente(sessao: Sessao): Destinatario[] {
  const destinos: Destinatario[] = [];

  if (sessao.client.phone !== null && consentiuWhatsApp(sessao.client)) {
    destinos.push({ canal: 'WHATSAPP', endereco: sessao.client.phone });
  }

  if (sessao.client.email !== null) {
    destinos.push({ canal: 'EMAIL', endereco: sessao.client.email });
  }

  return destinos;
}

function destinosDaClinica(sessao: Sessao): Destinatario[] {
  const destinos: Destinatario[] = [];

  if (sessao.clinic.phone !== null) {
    destinos.push({ canal: 'WHATSAPP', endereco: sessao.clinic.phone });
  }

  if (sessao.clinic.email !== null) {
    destinos.push({ canal: 'EMAIL', endereco: sessao.clinic.email });
  }

  return destinos;
}

function contextoDe(sessao: Sessao, inicioAnterior: Date | null = null): ContextoSessao {
  return {
    clinica: sessao.clinic.name,
    fuso: sessao.clinic.timezone,
    status: sessao.status,
    cliente: sessao.client.name,
    profissional: sessao.professional.name,
    terapia: sessao.therapy.name,
    inicio: sessao.startAt,
    motivo: sessao.cancellationReason,
    inicioAnterior,
  };
}

/**
 * Lembrete: `REMINDER_LEAD_MINUTES` antes do horario.
 *
 * Duas condicoes de corte. horario proximo demais (menos que a antecedencia)
 * nao gera lembrete porque a confirmacao ja avisa do mesmo dia. Status que
 * nao ocupa agenda nao gera lembrete porque o horario ja foi liberado --
 * quem vale la e o cancelamento, tratado por `cancelarLembretes`.
 */
function pedidosDeLembrete(sessao: Sessao): Pedido[] {
  if (!blocksSlot(sessao.status)) return [];

  const lead = env.REMINDER_LEAD_MINUTES * 60_000;
  const agendadaPara = new Date(sessao.startAt.getTime() - lead);

  if (agendadaPara.getTime() <= Date.now()) return [];

  return destinosDoCliente(sessao).map((destino) => {
    const { assunto, corpo } = montarMensagem('LEMBRETE', destino.canal, contextoDe(sessao));
    return {
      type: 'LEMBRETE' satisfies NotificationType,
      canal: destino.canal,
      destinatario: destino.endereco,
      assunto,
      corpo,
      agendadaPara,
      chaveDedupe: `LEMBRETE:${sessao.id}:${destino.canal}:${sessao.startAt.toISOString()}`,
    };
  });
}

/** Agenda um aviso imediato: confirmacao, cancelamento, reagendamento, novo horario. */
function pedidoImediato(
  sessao: Sessao,
  tipo: NotificationType,
  destinos: Destinatario[],
  marca: string,
  contexto: ContextoSessao = contextoDe(sessao),
): Pedido[] {
  return destinos.map((destino) => {
    const { assunto, corpo } = montarMensagem(tipo, destino.canal, contexto);
    return {
      type: tipo,
      canal: destino.canal,
      destinatario: destino.endereco,
      assunto,
      corpo,
      agendadaPara: new Date(),
      chaveDedupe: `${tipo}:${sessao.id}:${destino.canal}:${marca}`,
    };
  });
}

/**
 * Grava as linhas e acorda o worker.
 *
 * `dedupeKey` com `upsert` e o que segura o lembrete de rodar duas vezes:
 * o job repetido encontra a linha pelo indice unico em vez de criar outra.
 */
async function registrar(sessao: Sessao, pedidos: Pedido[]): Promise<void> {
  for (const pedido of pedidos) {
    const dados = {
      clinicId: sessao.clinicId,
      clientId: sessao.client.id,
      appointmentId: sessao.id,
      channel: pedido.canal,
      type: pedido.type,
      recipient: pedido.destinatario,
      subject: pedido.assunto,
      body: pedido.corpo,
      scheduledFor: pedido.agendadaPara,
    };

    const linha =
      pedido.chaveDedupe === null
        ? await prisma.notification.create({ data: dados })
        : await prisma.notification.upsert({
            where: { dedupeKey: pedido.chaveDedupe },
            create: { ...dados, dedupeKey: pedido.chaveDedupe },
            update: {},
          });

    enfileirar(linha.id, linha.scheduledFor);
  }
}

/**
 * Lembrete que ainda nao saiu e perde o sentido: o horario foi cancelado,
 * concluido ou o cliente faltou. A linha vai para CANCELADO em vez de ser
 * apagada -- o aviso estava previsto e nao será enviado.
 *
 * `ENVIANDO` fica de fora de proposito: se o worker pegou a linha agora, o
 * envio vai acontecer em outra transacao e nao ha o que impedir.
 */
async function cancelarLembretes(sessao: Sessao): Promise<void> {
  await prisma.notification.updateMany({
    where: {
      appointmentId: sessao.id,
      type: 'LEMBRETE',
      status: { in: ['PENDENTE', 'ERRO'] },
    },
    data: { status: 'CANCELADO' },
  });
}

/**
 * Reserva recem-criada: o cliente e avisado e a clinica recebe o pedido.
 *
 * A clinica so e notificada quando o pedido nao saiu do painel dela: quem
 * agenda pelo painel ja sabe, e o aviso seria ruido -- e mostraria para o
 * profissional um pedido que ele proprio fez.
 */
export async function avisarNovoAgendamento(appointmentId: string): Promise<void> {
  const sessao = await carregarSessao(appointmentId);
  if (sessao === null) return;

  const pedidos: Pedido[] = [
    ...pedidoImediato(sessao, 'CONFIRMACAO_AGENDAMENTO', destinosDoCliente(sessao), 'criacao'),
  ];

  if (sessao.source !== 'ADMIN') {
    pedidos.push(
      ...pedidoImediato(sessao, 'NOVO_AGENDAMENTO', destinosDaClinica(sessao), 'criacao'),
    );
  }

  pedidos.push(...pedidosDeLembrete(sessao));

  await registrar(sessao, pedidos);
}

/** Confirmacao da clinica: muda o status para CONFIRMADO. */
export async function avisarConfirmacao(appointmentId: string): Promise<void> {
  const sessao = await carregarSessao(appointmentId);
  if (sessao === null || sessao.status !== 'CONFIRMADO') return;

  await registrar(
    sessao,
    pedidoImediato(sessao, 'CONFIRMACAO_AGENDAMENTO', destinosDoCliente(sessao), 'confirmacao'),
  );
}

/** Cancelamento: avisa o cliente e aposenta o lembrete. */
export async function avisarCancelamento(appointmentId: string): Promise<void> {
  const sessao = await carregarSessao(appointmentId);
  if (sessao === null) return;

  await registrar(
    sessao,
    pedidoImediato(sessao, 'CANCELAMENTO', destinosDoCliente(sessao), 'cancelamento'),
  );

  await cancelarLembretes(sessao);
}

/**
 * Reagendamento: o horario antigo avisado deixa de valer, entao o lembrete
 * antigo e cancelado e um novo e criado para a data nova.
 */
export async function avisarReagendamento(
  appointmentId: string,
  inicioAnterior: Date,
): Promise<void> {
  const sessao = await carregarSessao(appointmentId);
  if (sessao === null) return;

  await cancelarLembretes(sessao);

  await registrar(sessao, [
    ...pedidoImediato(
      sessao,
      'REAGENDAMENTO',
      destinosDoCliente(sessao),
      inicioAnterior.toISOString(),
      contextoDe(sessao, inicioAnterior),
    ),
    ...pedidosDeLembrete(sessao),
  ]);
}

/**
 * Volta para AGENDADO_PENDENTE (depois de cancelamento ou no-show): o horario
 * volta a valer na agenda, entao o lembrete precisa ser rearmado.
 */
export async function rearmarLembrete(appointmentId: string): Promise<void> {
  const sessao = await carregarSessao(appointmentId);
  if (sessao === null) return;

  await registrar(sessao, pedidosDeLembrete(sessao));
}
