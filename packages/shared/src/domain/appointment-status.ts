/**
 * Ciclo de vida do agendamento.
 *
 * AGENDADO_PENDENTE  criado pelo cliente, aguardando confirmacao da clinica
 * CONFIRMADO         aceite pela clinica ou pagamento confirmado
 * EM_ATENDIMENTO     profissional marcou inicio
 * CONCLUIDO          sessao realizada, gera lancamento financeiro
 * CANCELADO          cancelado (informar o motivo em statusHistory)
 * NO_SHOW            cliente faltou
 *
 * Regra: somente PENDENTE, CONFIRMADO e EM_ATENDIMENTO ocupam a agenda
 * e por isso entram na constraint de exclusao do banco.
 */
export const APPOINTMENT_STATUSES = [
  'AGENDADO_PENDENTE',
  'CONFIRMADO',
  'EM_ATENDIMENTO',
  'CONCLUIDO',
  'CANCELADO',
  'NO_SHOW',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Status que ocupam agenda e bloqueiam o profissional na agenda. */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = [
  'AGENDADO_PENDENTE',
  'CONFIRMADO',
  'EM_ATENDIMENTO',
];

/** Status que NSO bloqueiam mais o horario e liberam o valor a receber. */
export const RELEASING_STATUSES: readonly AppointmentStatus[] = [
  'CONCLUIDO',
  'CANCELADO',
  'NO_SHOW',
];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  AGENDADO_PENDENTE: 'Aguardando confirmacao',
  CONFIRMADO: 'Confirmado',
  EM_ATENDIMENTO: 'Em atendimento',
  CONCLUIDO: 'Concluido',
  CANCELADO: 'Cancelado',
  NO_SHOW: 'Nao compareceu',
};

/** Transicoes permitidas. Qualquer outra combinacao e rejeitada pelo dominio. */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  AGENDADO_PENDENTE: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['EM_ATENDIMENTO', 'CONCLUIDO', 'CANCELADO', 'NO_SHOW'],
  EM_ATENDIMENTO: ['CONCLUIDO', 'CANCELADO'],
  CONCLUIDO: [],
  CANCELADO: ['AGENDADO_PENDENTE'],
  NO_SHOW: ['AGENDADO_PENDENTE'],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return APPOINTMENT_TRANSITIONS[from].includes(to);
}

export function blocksSlot(status: AppointmentStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}

export function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return typeof value === 'string' && (APPOINTMENT_STATUSES as readonly string[]).includes(value);
}
