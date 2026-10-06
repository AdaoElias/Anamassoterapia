/**
 * Origem do agendamento, usada para metricas de captacao e para
 * decidir quem tem permissao de cancelar.
 */
export const APPOINTMENT_SOURCES = [
  'PORTAL_CLIENTE',
  'ADMIN',
  'PROFISSIONAL',
  'IMPORTADO',
] as const;

export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const APPOINTMENT_SOURCE_LABELS: Record<AppointmentSource, string> = {
  PORTAL_CLIENTE: 'Portal do cliente',
  ADMIN: 'Painel da clinica',
  PROFISSIONAL: 'Feito pelo profissional',
  IMPORTADO: 'Importado',
};

export const CANCELLATION_REASONS = [
  'CLIENTE_DESISTIU',
  'CLIENTE_REAGENDOU',
  'FALTA_DO_PROFISSIONAL',
  'CONDICAO_CLINICA',
  'FORCA_MAIOR',
  'NAO_INFORMADO',
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const CANCELLATION_REASON_LABELS: Record<CancellationReason, string> = {
  CLIENTE_DESISTIU: 'Cliente desistiu',
  CLIENTE_REAGENDOU: 'Cliente reagendou',
  FALTA_DO_PROFISSIONAL: 'Falta do profissional',
  CONDICAO_CLINICA: 'Condicao clinica contraindicada',
  FORCA_MAIOR: 'Forca maior',
  NAO_INFORMADO: 'Nao informado',
};

/**
 * Formas de pagamento. DINHEIRO e PIX sao liquidados na hora;
 * os demais geram lancamento a receber.
 */
export const PAYMENT_METHODS = [
  'PIX',
  'DINHEIRO',
  'CARTAO_DEBITO',
  'CARTAO_CREDITO',
  'BOLETO',
  'TRANSFERENCIA',
  'ASSINATURA',
  'PACOTE',
  'OUTRO',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  CARTAO_DEBITO: 'Cartao de debito',
  CARTAO_CREDITO: 'Cartao de credito',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferencia',
  ASSINATURA: 'Assinatura',
  PACOTE: 'Pacote de sessoes',
  OUTRO: 'Outro',
};

export const FINANCIAL_ENTRY_STATUSES = ['PENDENTE', 'PAGO', 'CANCELADO', 'INADIMPENTE'] as const;

export type FinancialEntryStatus = (typeof FINANCIAL_ENTRY_STATUSES)[number];

export const FINANCIAL_ENTRY_STATUS_LABELS: Record<FinancialEntryStatus, string> = {
  PENDENTE: 'A receber',
  PAGO: 'Recebido',
  CANCELADO: 'Cancelado',
  INADIMPENTE: 'Inadimplente',
};

export const FINANCIAL_ENTRY_KINDS = ['RECEITA', 'DESPESA', 'COMISSAO'] as const;

export type FinancialEntryKind = (typeof FINANCIAL_ENTRY_KINDS)[number];

export const PACKAGE_STATUSES = ['ATIVO', 'CONCLUIDO', 'CANCELADO', 'EXPIRADO'] as const;

export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const PACKAGE_STATUS_LABELS: Record<PackageStatus, string> = {
  ATIVO: 'Ativo',
  CONCLUIDO: 'Concluido',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Expirado',
};

export const PACKAGE_SESSION_STATUSES = [
  'DISPONIVEL',
  'UTILIZADA',
  'CANCELADA',
  'EXPIRADA',
] as const;

export type PackageSessionStatus = (typeof PACKAGE_SESSION_STATUSES)[number];

export const PACKAGE_SESSION_STATUS_LABELS: Record<PackageSessionStatus, string> = {
  DISPONIVEL: 'Disponivel',
  UTILIZADA: 'Utilizada',
  CANCELADA: 'Cancelada',
  EXPIRADA: 'Expirada',
};

export const COMMISSION_STATUSES = ['PREVISTA', 'APROVADA', 'PAGA', 'CANCELADA'] as const;

export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  PREVISTA: 'Prevista',
  APROVADA: 'Aprovada',
  PAGA: 'Paga',
  CANCELADA: 'Cancelada',
};
