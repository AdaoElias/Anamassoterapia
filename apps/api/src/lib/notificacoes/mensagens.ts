import {
  APPOINTMENT_STATUS_LABELS,
  type AppointmentStatus,
  CANCELLATION_REASON_LABELS,
  type CancellationReason,
  componentesLocais,
  type NotificationChannel,
  type NotificationType,
} from '@massoterapia/shared';

/**
 * Texto das notificacoes.
 *
 * Funcoes puras, sem banco e sem data de "agora": recebem o contexto ja
 * montado e devolvem o texto. Isso deixa o conteudo testavel sozinho
 * (o que o cliente le de verdade) e mantem a concerncao de negocio fora da
 * fila -- quem decide *quando* avisar e o gatilho, nao o texto.
 *
 * WhatsApp nao interpreta markdown: negrito, lista e link viram asterisco e
 * barra invertida. Por isso o corpo e texto corrido, com quebras de linha.
 */

export interface ContextoSessao {
  clinica: string;
  fuso: string;
  status: AppointmentStatus;
  cliente: string;
  profissional: string;
  terapia: string;
  inicio: Date;
  motivo?: CancellationReason | null;
  inicioAnterior?: Date | null;
}

export interface MensagemPronta {
  /** `null` em WhatsApp: nao ha assunto, so o corpo. */
  assunto: string | null;
  corpo: string;
}

/** `05/01/2099 as 09:00` no fuso da clinica. */
export function formatarQuando(instante: Date, fuso: string): string {
  const c = componentesLocais(instante, fuso);
  const data = `${String(c.day).padStart(2, '0')}/${String(c.month).padStart(2, '0')}/${c.year}`;
  const hora = `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
  return `${data} as ${hora}`;
}

function sessaoResumo(contexto: ContextoSessao): string {
  return [
    `Quando: ${formatarQuando(contexto.inicio, contexto.fuso)}`,
    `Terapia: ${contexto.terapia}`,
    `Profissional: ${contexto.profissional}`,
  ].join('\n');
}

/**
 * Tipos que existem no enum mas so ganham texto proprio depois -- anamnese e
 * financeiro chegam nas Etapas 6 e 7. A linha do registro ja existe; o texto e
 * o aviso generico, e o registro fica honesto sobre isso.
 */
function corpoDeEtapaFutura(contexto: ContextoSessao): string {
  const nome = contexto.cliente.split(' ')[0] ?? contexto.cliente;
  return (
    `Oi, ${nome}! Aviso da ${contexto.clinica} sobre a sua sessao de ` +
    `${formatarQuando(contexto.inicio, contexto.fuso)}.`
  );
}

function corpoDe(tipo: NotificationType, contexto: ContextoSessao): string {
  const nome = contexto.cliente.split(' ')[0] ?? contexto.cliente;

  switch (tipo) {
    case 'CONFIRMACAO_AGENDAMENTO': {
      if (contexto.status === 'AGENDADO_PENDENTE') {
        return (
          `Oi, ${nome}! Recebemos seu pedido de horario na ${contexto.clinica}.\n\n` +
          `${sessaoResumo(contexto)}\n\n` +
          `A clinica confirma em breve. Precisa mudar, fale com a gente.`
        );
      }
      return (
        `Oi, ${nome}! Seu horario na ${contexto.clinica} esta confirmado.\n\n` +
        `${sessaoResumo(contexto)}\n\n` +
        `Precisa mudar, fale com a gente.`
      );
    }

    case 'LEMBRETE':
      return (
        `Oi, ${nome}! Passando para lembrar do seu horario na ${contexto.clinica}.\n\n` +
        `${sessaoResumo(contexto)}\n\n` +
        `Ate breve!`
      );

    case 'CANCELAMENTO': {
      const motivo =
        contexto.motivo === undefined || contexto.motivo === null
          ? ''
          : `\nMotivo: ${CANCELLATION_REASON_LABELS[contexto.motivo]}`;
      return (
        `Oi, ${nome}! Seu horario na ${contexto.clinica} foi cancelado.\n\n` +
        `${sessaoResumo(contexto)}${motivo}\n\n` +
        `Para remarcar, fale com a gente.`
      );
    }

    case 'REAGENDAMENTO':
      return (
        `Oi, ${nome}! Seu horario na ${contexto.clinica} foi remarcado.\n\n` +
        `Antes: ${formatarQuando(contexto.inicioAnterior ?? contexto.inicio, contexto.fuso)}\n` +
        `Agora: ${formatarQuando(contexto.inicio, contexto.fuso)}\n` +
        `Terapia: ${contexto.terapia}\n` +
        `Profissional: ${contexto.profissional}\n\n` +
        `Se nao der para vir, avise com antecedencia.`
      );

    case 'NOVO_AGENDAMENTO':
      return (
        `Novo agendamento na agenda da ${contexto.clinica}.\n\n` +
        `Cliente: ${contexto.cliente}\n` +
        `Quando: ${formatarQuando(contexto.inicio, contexto.fuso)}\n` +
        `Terapia: ${contexto.terapia}\n` +
        `Profissional: ${contexto.profissional}\n` +
        `Status: ${APPOINTMENT_STATUS_LABELS[contexto.status]}`
      );

    case 'ANAMNESE_PENDENTE':
    case 'LEMBRETE_ANAMNESE':
    case 'ALERTA_CONTRAINDICACAO':
    case 'PAGAMENTO_PENDENTE':
    case 'PAGAMENTO_RECEBIDO':
      return corpoDeEtapaFutura(contexto);
  }
}

function assuntoDe(tipo: NotificationType, contexto: ContextoSessao): string {
  switch (tipo) {
    case 'CONFIRMACAO_AGENDAMENTO':
      return contexto.status === 'AGENDADO_PENDENTE'
        ? `Pedido de agendamento - ${contexto.clinica}`
        : `Agendamento confirmado - ${contexto.clinica}`;
    case 'LEMBRETE':
      return `Lembrete de horario - ${contexto.clinica}`;
    case 'CANCELAMENTO':
      return `Agendamento cancelado - ${contexto.clinica}`;
    case 'REAGENDAMENTO':
      return `Agendamento remarcado - ${contexto.clinica}`;
    case 'NOVO_AGENDAMENTO':
      return `Novo agendamento - ${contexto.clinica}`;
    case 'ANAMNESE_PENDENTE':
    case 'LEMBRETE_ANAMNESE':
    case 'ALERTA_CONTRAINDICACAO':
    case 'PAGAMENTO_PENDENTE':
    case 'PAGAMENTO_RECEBIDO':
      return `Aviso da ${contexto.clinica}`;
  }
}

export function montarMensagem(
  tipo: NotificationType,
  canal: NotificationChannel,
  contexto: ContextoSessao,
): MensagemPronta {
  return {
    assunto: canal === 'EMAIL' ? assuntoDe(tipo, contexto) : null,
    corpo: corpoDe(tipo, contexto),
  };
}
