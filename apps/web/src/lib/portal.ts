import type {
  PortalBooking,
  PortalBookingCreate,
  PortalClinic,
  PortalProfessional,
  PortalTherapy,
  Slot,
} from '@massoterapia/shared';

import { apiFetch } from './api';

/**
 * Portal publico de agendamento sobre o cliente HTTP.
 *
 * Diferente do resto do app, nada aqui exige login: a clinica vem do slug da
 * URL e o contrato e o mesmo `@massoterapia/shared` que a API valida.
 */

export interface Lista<T> {
  items: T[];
}

function querystring(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === undefined || valor === '') continue;
    search.set(chave, valor);
  }
  const texto = search.toString();
  return texto === '' ? '' : `?${texto}`;
}

export const chavesPortal = {
  clinica: (slug: string) => ['portal', slug, 'clinica'] as const,
  terapias: (slug: string) => ['portal', slug, 'terapias'] as const,
  profissionais: (slug: string, therapyId: string) =>
    ['portal', slug, 'profissionais', therapyId] as const,
  slots: (slug: string, therapyId: string, from: string, professionalId: string) =>
    ['portal', slug, 'slots', therapyId, from, professionalId] as const,
};

export function obterClinicaPublica(slug: string): Promise<PortalClinic> {
  return apiFetch<PortalClinic>(`/public/clinics/${slug}`);
}

export function listarTerapiasPublicas(slug: string): Promise<Lista<PortalTherapy>> {
  return apiFetch<Lista<PortalTherapy>>(`/public/clinics/${slug}/therapies`);
}

export function listarProfissionaisPublicos(
  slug: string,
  therapyId: string,
): Promise<Lista<PortalProfessional>> {
  return apiFetch<Lista<PortalProfessional>>(
    `/public/clinics/${slug}/therapies/${therapyId}/professionals`,
  );
}

export function listarSlotsPublicos(
  slug: string,
  params: { therapyId: string; professionalId: string; from: string; to: string },
): Promise<Lista<Slot>> {
  return apiFetch<Lista<Slot>>(
    `/public/clinics/${slug}/slots${querystring({
      therapyId: params.therapyId,
      professionalId: params.professionalId,
      from: params.from,
      to: params.to,
    })}`,
  );
}

export function agendarPublico(slug: string, body: PortalBookingCreate): Promise<PortalBooking> {
  return apiFetch<PortalBooking>(`/public/clinics/${slug}/appointments`, {
    method: 'POST',
    body,
  });
}
