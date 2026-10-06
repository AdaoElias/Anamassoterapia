import type {
  Commission,
  FinancialEntry,
  FinancialEntryCancel,
  FinancialEntryCreate,
  FinancialEntryListQuery,
  FinancialEntryPaymentInput,
  Package,
  PackageCreate,
  PackageDetail,
  PackageStatusUpdate,
  ResumoFinanceiro,
} from '@massoterapia/shared';

import { ApiError, apiFetch } from './api';

/**
 * Financeiro: lancamentos (recebido x a receber), pacotes, comissoes e o
 * resumo do periodo. Mesmo contrato das outras libs: os tipos vem do schema
 * que a API valida, e a clinica nunca entra na URL -- ela sempre vem da
 * sessao do usuario.
 */

export interface Meta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListaDe<T> {
  items: T[];
  meta: Meta;
}

function querystring(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === undefined || valor === '') continue;
    search.set(chave, String(valor));
  }
  const texto = search.toString();
  return texto === '' ? '' : `?${texto}`;
}

/** Texto de erro padronizado para os formularios do financeiro. */
export function mensagemDeErro(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Nao foi possivel salvar. Tente novamente.';
}

/** Raiz das queries do financeiro, para invalidar por area (inclusive o resumo). */
export const chavesFinanceiro = {
  lancamentos: (filtro: FinancialEntryListQuery) => ['financeiro', 'lancamentos', filtro] as const,
  pacotes: ['financeiro', 'pacotes'] as const,
  comissoes: ['financeiro', 'comissoes'] as const,
  resumo: (de: string, ate: string) => ['financeiro', 'resumo', de, ate] as const,
};

// --- Lancamentos ------------------------------------------------------

export function listarLancamentos(
  filtro: FinancialEntryListQuery,
): Promise<ListaDe<FinancialEntry>> {
  return apiFetch<ListaDe<FinancialEntry>>(
    `/finance/lancamentos${querystring({
      page: filtro.page,
      perPage: filtro.perPage,
      kind: filtro.kind,
      status: filtro.status,
      method: filtro.method,
      clientId: filtro.clientId,
      de: filtro.de,
      ate: filtro.ate,
    })}`,
  );
}

export function criarLancamento(body: FinancialEntryCreate): Promise<FinancialEntry> {
  return apiFetch<FinancialEntry>('/finance/lancamentos', { method: 'POST', body });
}

export function pagarLancamento(
  id: string,
  body: FinancialEntryPaymentInput,
): Promise<FinancialEntry> {
  return apiFetch<FinancialEntry>(`/finance/lancamentos/${id}/pagar`, { method: 'POST', body });
}

export function cancelarLancamento(
  id: string,
  body: FinancialEntryCancel,
): Promise<FinancialEntry> {
  return apiFetch<FinancialEntry>(`/finance/lancamentos/${id}/cancelar`, { method: 'POST', body });
}

// --- Pacotes ----------------------------------------------------------

export function listarPacotes(filtro: {
  status?: Package['status'] | undefined;
  clientId?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
}): Promise<ListaDe<Package>> {
  return apiFetch<ListaDe<Package>>(
    `/finance/pacotes${querystring({
      page: filtro.page,
      perPage: filtro.perPage,
      status: filtro.status,
      clientId: filtro.clientId,
    })}`,
  );
}

export function obterPacote(id: string): Promise<PackageDetail> {
  return apiFetch<PackageDetail>(`/finance/pacotes/${id}`);
}

export function criarPacote(body: PackageCreate): Promise<PackageDetail> {
  return apiFetch<PackageDetail>('/finance/pacotes', { method: 'POST', body });
}

export function mudarStatusPacote(id: string, body: PackageStatusUpdate): Promise<Package> {
  return apiFetch<Package>(`/finance/pacotes/${id}/status`, { method: 'POST', body });
}

export function usarSessao(pacoteId: string, sessaoId: string): Promise<PackageDetail> {
  return apiFetch<PackageDetail>(`/finance/pacotes/${pacoteId}/sessoes/${sessaoId}/usar`, {
    method: 'POST',
  });
}

export function disponibilizarSessao(pacoteId: string, sessaoId: string): Promise<PackageDetail> {
  return apiFetch<PackageDetail>(
    `/finance/pacotes/${pacoteId}/sessoes/${sessaoId}/disponibilizar`,
    {
      method: 'POST',
    },
  );
}

// --- Comissoes --------------------------------------------------------

export function listarComissoes(filtro: {
  status?: Commission['status'] | undefined;
  professionalId?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
}): Promise<ListaDe<Commission>> {
  return apiFetch<ListaDe<Commission>>(
    `/finance/comissoes${querystring({
      page: filtro.page,
      perPage: filtro.perPage,
      status: filtro.status,
      professionalId: filtro.professionalId,
    })}`,
  );
}

export function aprovarComissao(id: string): Promise<Commission> {
  return apiFetch<Commission>(`/finance/comissoes/${id}/aprovar`, { method: 'POST' });
}

export function pagarComissao(id: string): Promise<Commission> {
  return apiFetch<Commission>(`/finance/comissoes/${id}/pagar`, { method: 'POST' });
}

export function cancelarComissao(id: string): Promise<Commission> {
  return apiFetch<Commission>(`/finance/comissoes/${id}/cancelar`, { method: 'POST' });
}

// --- Resumo -----------------------------------------------------------

export function obterResumo(periodo: {
  de?: string | undefined;
  ate?: string | undefined;
}): Promise<ResumoFinanceiro> {
  return apiFetch<ResumoFinanceiro>(
    `/finance/resumo${querystring({ de: periodo.de, ate: periodo.ate })}`,
  );
}
