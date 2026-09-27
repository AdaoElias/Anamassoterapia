/**
 * Papeis de acesso. A ordem de declaracao NAO implica hierarquia:
 * cada papel tem um escopo explicito e a checagem acontece por papel.
 */
export const ROLES = ['ADMIN', 'PROFISSIONAL', 'CLIENTE'] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  PROFISSIONAL: 'Profissional',
  CLIENTE: 'Cliente',
};

/** Papeis que podem acessar o painel de gestao da clinica. */
export const MANAGEMENT_ROLES: readonly Role[] = ['ADMIN'];

/** Papeis que podem acessar dados de saude (anamnese/prontuario). */
export const CLINICAL_ROLES: readonly Role[] = ['ADMIN', 'PROFISSIONAL'];

/** Papeis autorizados a agendar em nome de terceiros. */
export const SCHEDULER_ROLES: readonly Role[] = ['ADMIN', 'PROFISSIONAL'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
