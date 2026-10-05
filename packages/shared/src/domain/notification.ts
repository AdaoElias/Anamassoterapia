/**
 * Canais, tipos e situacao das notificacoes.
 *
 * Espelham os enums `NotificationChannel`, `NotificationType` e
 * `NotificationStatus` do Prisma. A lista de tipos e maior do que o que a
 * API dispara hoje: os tipos de anamnese e de financeiro ganham emissor nas
 * etapas 6 e 7, e o enum ja reservou o lugar.
 *
 * A `Notification` e a fila de verdade -- o pg-boss so acorda o processo
 * para entregar. Por isso o registro carrega `attempts`, `lastError`,
 * `externalId` e `dedupeKey`: da para responder "o que aconteceu com este
 * aviso" sem depender do historico do worker.
 */
export const NOTIFICATION_CHANNELS = ['WHATSAPP', 'EMAIL', 'SMS'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  SMS: 'SMS',
};

export const NOTIFICATION_TYPES = [
  'CONFIRMACAO_AGENDAMENTO',
  'LEMBRETE',
  'LEMBRETE_ANAMNESE',
  'ANAMNESE_PENDENTE',
  'CANCELAMENTO',
  'REAGENDAMENTO',
  'PAGAMENTO_PENDENTE',
  'PAGAMENTO_RECEBIDO',
  'NOVO_AGENDAMENTO',
  'ALERTA_CONTRAINDICACAO',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  CONFIRMACAO_AGENDAMENTO: 'Confirmacao de agendamento',
  LEMBRETE: 'Lembrete de horario',
  LEMBRETE_ANAMNESE: 'Lembrete de anamnese',
  ANAMNESE_PENDENTE: 'Anamnese pendente',
  CANCELAMENTO: 'Cancelamento',
  REAGENDAMENTO: 'Reagendamento',
  PAGAMENTO_PENDENTE: 'Pagamento pendente',
  PAGAMENTO_RECEBIDO: 'Pagamento recebido',
  NOVO_AGENDAMENTO: 'Novo agendamento',
  ALERTA_CONTRAINDICACAO: 'Alerta de contraindicacao',
};

/**
 * WhatsApp nao e e-mail: mensagem iniciada pela empresa depende de aceite
 * previo do cliente. Por isso o unico tipo disparado sem checagem de
 * consentimento e o operacional (`LEMBRETE`, e os avisos que sao resposta a um
 * pedido do proprio cliente).
 */
export const NOTIFICATION_TYPES_OPERACIONAIS: readonly NotificationType[] = [
  'CONFIRMACAO_AGENDAMENTO',
  'LEMBRETE',
  'LEMBRETE_ANAMNESE',
  'ANAMNESE_PENDENTE',
  'CANCELAMENTO',
  'REAGENDAMENTO',
  'PAGAMENTO_PENDENTE',
  'PAGAMENTO_RECEBIDO',
  'ALERTA_CONTRAINDICACAO',
];

export function isOperationalNotification(type: NotificationType): boolean {
  return NOTIFICATION_TYPES_OPERACIONAIS.includes(type);
}

export const NOTIFICATION_STATUSES = [
  'PENDENTE',
  'ENVIANDO',
  'ENVIADO',
  'ERRO',
  'CANCELADO',
] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  PENDENTE: 'Na fila',
  ENVIANDO: 'Enviando',
  ENVIADO: 'Enviado',
  ERRO: 'Falhou',
  CANCELADO: 'Cancelado',
};

/** Situacoes que ainda aceitam uma tentativa de envio. */
export const NOTIFICATION_STATUS_PENDENTES: readonly NotificationStatus[] = [
  'PENDENTE',
  'ENVIANDO',
  'ERRO',
];
