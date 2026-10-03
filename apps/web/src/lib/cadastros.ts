import type {
  Client,
  ClientCreate,
  ClientUpdate,
  Clinic,
  ClinicUpdate,
  Professional,
  ProfessionalCreate,
  ProfessionalUpdate,
  Room,
  RoomCreate,
  RoomUpdate,
  Therapy,
  TherapyCreate,
  TherapyUpdate,
} from '@massoterapia/shared';

import { ApiError, apiFetch } from './api';

/**
 * Operacoes de cadastro sobre o cliente HTTP.
 *
 * Os tipos vem de `@massoterapia/shared`: a mesma validacao que a API usa
 * e a que o formulario usa, entao o contrato nao diverge.
 */

export interface Paginacao {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Lista<T> {
  items: T[];
  meta: Paginacao;
}

export interface FiltroLista {
  search?: string | undefined;
  includeInactive?: boolean | undefined;
}

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

/** Texto de erro padronizado para os formularios de cadastro. */
export function mensagemDeErro(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Nao foi possivel salvar. Tente novamente.';
}

export const chavesConsulta = {
  clinica: ['clinica'] as const,
  salas: ['salas'] as const,
  terapias: ['terapias'] as const,
  profissionais: ['profissionais'] as const,
  clientes: ['clientes'] as const,
};

// --- Clinica ---------------------------------------------------------

export function obterClinica(): Promise<Clinic> {
  return apiFetch<Clinic>('/clinics/current');
}

export function atualizarClinica(body: ClinicUpdate): Promise<Clinic> {
  return apiFetch<Clinic>('/clinics/current', { method: 'PATCH', body });
}

// --- Salas -----------------------------------------------------------

export function listarSalas(filtro: FiltroLista = {}): Promise<Lista<Room>> {
  return apiFetch<Lista<Room>>(
    `/clinics/current/rooms${querystring({
      search: filtro.search,
      includeInactive: filtro.includeInactive,
    })}`,
  );
}

export function criarSala(body: RoomCreate): Promise<Room> {
  return apiFetch<Room>('/clinics/current/rooms', { method: 'POST', body });
}

export function atualizarSala(id: string, body: RoomUpdate): Promise<Room> {
  return apiFetch<Room>(`/clinics/current/rooms/${id}`, { method: 'PATCH', body });
}

export function desativarSala(id: string): Promise<void> {
  return apiFetch<void>(`/clinics/current/rooms/${id}`, { method: 'DELETE' });
}

// --- Terapias --------------------------------------------------------

export function listarTerapias(filtro: FiltroLista = {}): Promise<Lista<Therapy>> {
  return apiFetch<Lista<Therapy>>(
    `/therapies${querystring({
      search: filtro.search,
      includeInactive: filtro.includeInactive,
    })}`,
  );
}

export function criarTerapia(body: TherapyCreate): Promise<Therapy> {
  return apiFetch<Therapy>('/therapies', { method: 'POST', body });
}

export function atualizarTerapia(id: string, body: TherapyUpdate): Promise<Therapy> {
  return apiFetch<Therapy>(`/therapies/${id}`, { method: 'PATCH', body });
}

export function desativarTerapia(id: string): Promise<void> {
  return apiFetch<void>(`/therapies/${id}`, { method: 'DELETE' });
}

// --- Profissionais ---------------------------------------------------

export function listarProfissionais(filtro: FiltroLista = {}): Promise<Lista<Professional>> {
  return apiFetch<Lista<Professional>>(
    `/professionals${querystring({
      search: filtro.search,
      includeInactive: filtro.includeInactive,
    })}`,
  );
}

export function criarProfissional(body: ProfessionalCreate): Promise<Professional> {
  return apiFetch<Professional>('/professionals', { method: 'POST', body });
}

export function atualizarProfissional(id: string, body: ProfessionalUpdate): Promise<Professional> {
  return apiFetch<Professional>(`/professionals/${id}`, { method: 'PATCH', body });
}

export function desativarProfissional(id: string): Promise<void> {
  return apiFetch<void>(`/professionals/${id}`, { method: 'DELETE' });
}

// --- Clientes --------------------------------------------------------

export function listarClientes(filtro: FiltroLista = {}): Promise<Lista<Client>> {
  return apiFetch<Lista<Client>>(
    `/clients${querystring({
      search: filtro.search,
      includeInactive: filtro.includeInactive,
    })}`,
  );
}

export function criarCliente(body: ClientCreate): Promise<Client> {
  return apiFetch<Client>('/clients', { method: 'POST', body });
}

export function atualizarCliente(id: string, body: ClientUpdate): Promise<Client> {
  return apiFetch<Client>(`/clients/${id}`, { method: 'PATCH', body });
}

export function desativarCliente(id: string): Promise<void> {
  return apiFetch<void>(`/clients/${id}`, { method: 'DELETE' });
}
