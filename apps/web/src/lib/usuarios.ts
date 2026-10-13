import type {
  Membership,
  MembershipInvite,
  MembershipInviteResponse,
  MembershipUpdate,
} from '@massoterapia/shared';

import { apiFetch } from './api';
import type { FiltroLista, Lista } from './cadastros';

/**
 * Operacoes de gestao de usuarios da clinica (`/users`).
 *
 * Os tipos vem de `@massoterapia/shared`: a mesma validacao que a API usa e a
 * que o formulario usa. O id manipulado e o da membership, nao o do usuario:
 * e a membership que concede acesso a clinica.
 */

/** Monta a query string ignorando campos ausentes ou vazios. */
function querystring(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === undefined || valor === '') continue;
    search.set(chave, String(valor));
  }
  const texto = search.toString();
  return texto === '' ? '' : `?${texto}`;
}

export const chaveUsuarios = ['usuarios'] as const;

export function listarUsuarios(filtro: FiltroLista = {}): Promise<Lista<Membership>> {
  return apiFetch<Lista<Membership>>(
    `/users${querystring({ search: filtro.search, includeInactive: filtro.includeInactive })}`,
  );
}

export function convidarUsuario(body: MembershipInvite): Promise<MembershipInviteResponse> {
  return apiFetch<MembershipInviteResponse>('/users/invites', { method: 'POST', body });
}

export function atualizarUsuario(id: string, body: MembershipUpdate): Promise<Membership> {
  return apiFetch<Membership>(`/users/${id}`, { method: 'PATCH', body });
}

export function desativarUsuario(id: string): Promise<void> {
  return apiFetch<void>(`/users/${id}`, { method: 'DELETE' });
}
