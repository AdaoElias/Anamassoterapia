import { z } from 'zod';

import { slotSchema } from './appointment.js';
import { emailSchema, idSchema, phoneSchema } from './common.js';

/**
 * Portal publico do cliente.
 *
 * Sem login: o visitante escolhe terapia, profissional e horario e se
 * identifica por nome e telefone. O cliente e achado (ou criado) pelo
 * telefone dentro da clinica do link, e a sessao nasce `AGENDADO_PENDENTE`
 * para a clinica confirmar.
 */

export const portalClinicSchema = z.object({
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  phone: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  addressCity: z.string().nullable(),
  addressState: z.string().nullable(),
  bookingTerms: z.string().nullable(),
});

export const portalTherapySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  durationMinutes: z.number().int(),
  priceCents: z.number().int(),
  color: z.string().nullable(),
  imageUrl: z.string().nullable(),
});

export const portalTherapyListResponseSchema = z.object({
  items: z.array(portalTherapySchema),
});

export const portalProfessionalSchema = z.object({
  id: z.string(),
  name: z.string(),
  bio: z.string().nullable(),
  color: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  registrationType: z.string().nullable(),
});

export const portalProfessionalListResponseSchema = z.object({
  items: z.array(portalProfessionalSchema),
});

export const portalSlotListResponseSchema = z.object({
  items: z.array(slotSchema),
});

export const portalBookingCreateSchema = z.object({
  therapyId: idSchema,
  professionalId: idSchema,
  startAt: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  phone: phoneSchema,
  email: z.union([z.literal(''), emailSchema]).optional(),
  notes: z.string().trim().max(500).optional(),
  marketingOptIn: z.boolean().default(false),
});

export const portalBookingResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  priceCents: z.number().int(),
  therapyName: z.string(),
  professionalName: z.string(),
  clientName: z.string(),
  clinicName: z.string(),
  clinicSlug: z.string(),
  timezone: z.string(),
});

export type PortalClinic = z.infer<typeof portalClinicSchema>;
export type PortalTherapy = z.infer<typeof portalTherapySchema>;
export type PortalProfessional = z.infer<typeof portalProfessionalSchema>;
export type PortalBookingCreate = z.infer<typeof portalBookingCreateSchema>;
export type PortalBooking = z.infer<typeof portalBookingResponseSchema>;
