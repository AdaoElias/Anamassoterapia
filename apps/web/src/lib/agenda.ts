import type {
  Appointment,
  AppointmentCreate,
  AppointmentStatusUpdate,
  AppointmentUpdate,
  AvailabilityException,
  AvailabilityExceptionCreate,
  AvailabilityRule,
  AvailabilityRuleCreate,
  AvailabilityRuleUpdate,
  ClinicHoliday,
  ClinicHolidayCreate,
  Slot,
} from '@massoterapia/shared';

import { apiFetch } from './api';

/**
 * Operacoes de agenda e disponibilidade sobre o cliente HTTP.
 *
 * Os tipos do contrato vem de `@massoterapia/shared`: o mesmo schema que
 * valida na API e o que tipa o formulario.
 */

export interface Lista<T> {
  items: T[];
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

export const chavesAgenda = {
  slots: (therapyId: string, from: string, professionalId?: string) =>
    ['agenda', 'slots', therapyId, from, professionalId ?? 'todos'] as const,
  agendamentos: (from: string, to: string, professionalId?: string) =>
    ['agenda', 'agendamentos', from, to, professionalId ?? 'todos'] as const,
  regras: (professionalId: string) => ['disponibilidade', 'regras', professionalId] as const,
  excecoes: (professionalId: string, from: string, to: string) =>
    ['disponibilidade', 'excecoes', professionalId, from, to] as const,
  feriados: (from: string, to: string) => ['disponibilidade', 'feriados', from, to] as const,
};

// --- Horarios livres -------------------------------------------------

export function listarSlots(params: {
  therapyId: string;
  from: string;
  to?: string | undefined;
  professionalId?: string | undefined;
}): Promise<Lista<Slot>> {
  return apiFetch<Lista<Slot>>(
    `/appointments/slots${querystring({
      therapyId: params.therapyId,
      from: params.from,
      to: params.to,
      professionalId: params.professionalId,
    })}`,
  );
}

// --- Sessoes ---------------------------------------------------------

export function listarAgendamentos(params: {
  from: string;
  to: string;
  professionalId?: string | undefined;
  status?: string | undefined;
}): Promise<Lista<Appointment>> {
  return apiFetch<Lista<Appointment>>(
    `/appointments${querystring({
      from: params.from,
      to: params.to,
      professionalId: params.professionalId,
      status: params.status,
    })}`,
  );
}

export function criarAgendamento(body: AppointmentCreate): Promise<Appointment> {
  return apiFetch<Appointment>('/appointments', { method: 'POST', body });
}

export function atualizarAgendamento(id: string, body: AppointmentUpdate): Promise<Appointment> {
  return apiFetch<Appointment>(`/appointments/${id}`, { method: 'PATCH', body });
}

export function mudarStatusAgendamento(
  id: string,
  body: AppointmentStatusUpdate,
): Promise<Appointment> {
  return apiFetch<Appointment>(`/appointments/${id}/status`, { method: 'PATCH', body });
}

// --- Disponibilidade -------------------------------------------------

export function listarRegras(
  professionalId: string,
  includeInactive = false,
): Promise<Lista<AvailabilityRule>> {
  return apiFetch<Lista<AvailabilityRule>>(
    `/availability/rules${querystring({ professionalId, includeInactive })}`,
  );
}

export function criarRegra(body: AvailabilityRuleCreate): Promise<AvailabilityRule> {
  return apiFetch<AvailabilityRule>('/availability/rules', { method: 'POST', body });
}

export function atualizarRegra(
  id: string,
  body: AvailabilityRuleUpdate,
): Promise<AvailabilityRule> {
  return apiFetch<AvailabilityRule>(`/availability/rules/${id}`, { method: 'PATCH', body });
}

export function desativarRegra(id: string): Promise<void> {
  return apiFetch<void>(`/availability/rules/${id}`, { method: 'DELETE' });
}

export function listarExcecoes(
  professionalId: string,
  from: string,
  to: string,
): Promise<Lista<AvailabilityException>> {
  return apiFetch<Lista<AvailabilityException>>(
    `/availability/exceptions${querystring({ professionalId, from, to })}`,
  );
}

export function criarExcecao(body: AvailabilityExceptionCreate): Promise<AvailabilityException> {
  return apiFetch<AvailabilityException>('/availability/exceptions', { method: 'POST', body });
}

export function removerExcecao(id: string): Promise<void> {
  return apiFetch<void>(`/availability/exceptions/${id}`, { method: 'DELETE' });
}

export function listarFeriados(from: string, to: string): Promise<Lista<ClinicHoliday>> {
  return apiFetch<Lista<ClinicHoliday>>(`/availability/holidays${querystring({ from, to })}`);
}

export function criarFeriado(body: ClinicHolidayCreate): Promise<ClinicHoliday> {
  return apiFetch<ClinicHoliday>('/availability/holidays', { method: 'POST', body });
}

export function removerFeriado(id: string): Promise<void> {
  return apiFetch<void>(`/availability/holidays/${id}`, { method: 'DELETE' });
}
