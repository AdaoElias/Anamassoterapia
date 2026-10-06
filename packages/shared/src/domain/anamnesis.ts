/**
 * Ciclo de vida da anamnese e das contraindicacoes.
 *
 * Espelham os enums `AnamnesisStatus`, `AlertSeverity` e `AlertDecision` do
 * Prisma.
 *
 * A anamnese responde de novo **cria versao nova**: nada sobrescreve a
 * resposta anterior. O prontuario precisa provar o que o profissional sabia
 * no momento da sessao, e dado de saude nao pode ser alterado em silencio
 * (LGPD art. 5 II e XI). O banco garante a imutabilidade do conteudo depois
 * de `ENVIADA`; aqui fica o vocabulario.
 *
 * O alerta de contraindicacao **avisa, nao bloqueia**. Quem avalia a
 * contraindicacao real e o profissional com o cliente na mesa; o sistema
 * garante e que a decisao fique registrada (`ACEITO` ou `BLOQUEADO`).
 */

export const ANAMNESIS_STATUSES = [
  'RASCUNHO',
  'ENVIADA',
  'APROVADA',
  'REJEITADA',
  'EXPIRADA',
] as const;

export type AnamnesisStatus = (typeof ANAMNESIS_STATUSES)[number];

export const ANAMNESIS_STATUS_LABELS: Record<AnamnesisStatus, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADA: 'Aguardando revisao',
  APROVADA: 'Aprovada',
  REJEITADA: 'Rejeitada',
  EXPIRADA: 'Expirada',
};

/** Unico status em que a resposta ainda pode mudar. */
export const ANAMNESIS_STATUS_EDITAVEL: AnamnesisStatus = 'RASCUNHO';

/** Status que valem como anamnese vigente para uma sessao. */
export const ANAMNESIS_STATUS_VIGENTES: readonly AnamnesisStatus[] = ['APROVADA'];

export function isAnamnesisVigente(status: AnamnesisStatus): boolean {
  return ANAMNESIS_STATUS_VIGENTES.includes(status);
}

export const ALERT_SEVERITIES = ['BAIXA', 'MEDIA', 'ALTA'] as const;

export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  BAIXA: 'Baixa',
  MEDIA: 'Media',
  ALTA: 'Alta',
};

export const ALERT_DECISIONS = ['PENDENTE', 'ACEITO', 'BLOQUEADO'] as const;

export type AlertDecision = (typeof ALERT_DECISIONS)[number];

export const ALERT_DECISION_LABELS: Record<AlertDecision, string> = {
  PENDENTE: 'Aguardando decisao',
  ACEITO: 'Atendimento autorizado',
  BLOQUEADO: 'Atendimento bloqueado',
};

/**
 * Decisoes que o profissional pode registrar. `PENDENTE` nao e uma decisao:
 * e a ausencia dela, e nao entra no contrato de escrita.
 */
export const ALERT_DECISOES_REGISTRADAS: readonly AlertDecision[] = ['ACEITO', 'BLOQUEADO'];

/**
 * Ordem de bloqueio: a contraindicacao mais grave decide o alerta. Sem isso,
 * um alerta `BAIXA` aceito esconderia um `ALTA` da mesma sessao.
 */
export const ALERT_SEVERIDADE_ORDEM: Record<AlertSeverity, number> = {
  ALTA: 3,
  MEDIA: 2,
  BAIXA: 1,
};

export function maiorSeveridade(severidades: readonly AlertSeverity[]): AlertSeverity {
  let maior: AlertSeverity = 'BAIXA';
  for (const severidade of severidades) {
    if (ALERT_SEVERIDADE_ORDEM[severidade] > ALERT_SEVERIDADE_ORDEM[maior]) maior = severidade;
  }
  return maior;
}
