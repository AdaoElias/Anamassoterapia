import { z } from 'zod';

import {
  clearableCepSchema,
  clearableCnpjSchema,
  clearableEmailSchema,
  clearablePhoneSchema,
} from './common.js';

/**
 * Perfil da clinica (tenant) e salas de atendimento.
 *
 * A clinica nao tem create/delete nesta etapa: o tenant nasce no seed e o
 * onboarding multi-tenant fica para depois. O que existe e editar o perfil
 * da clinica da sessao e gerenciar as salas dela.
 */

const timezoneSchema = z
  .string()
  .trim()
  .min(1, 'Informe o fuso horario')
  .max(64)
  .refine((tz) => {
    try {
      // `Intl` e a unica validacao de IANA que existe sem dependencia extra.
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Fuso horario invalido');

export const clinicSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  cnpj: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  timezone: z.string(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  addressCity: z.string().nullable(),
  addressState: z.string().nullable(),
  addressZip: z.string().nullable(),
  bookingTerms: z.string().nullable(),
  active: z.boolean(),
});

/** `''` limpa o campo no PATCH; uma string preenchida substitui o valor. */
const clearableText = (max: number) => z.union([z.literal(''), z.string().trim().max(max)]);

export const clinicUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120).optional(),
  legalName: clearableText(160).optional(),
  cnpj: clearableCnpjSchema.optional(),
  email: clearableEmailSchema.optional(),
  phone: clearablePhoneSchema.optional(),
  timezone: timezoneSchema.optional(),
  addressLine1: clearableText(160).optional(),
  addressLine2: clearableText(160).optional(),
  addressCity: clearableText(80).optional(),
  addressState: z
    .union([z.literal(''), z.string().trim().toUpperCase().length(2, 'Use a sigla da UF')])
    .optional(),
  addressZip: clearableCepSchema.optional(),
  bookingTerms: clearableText(5000).optional(),
});

export type Clinic = z.infer<typeof clinicSchema>;
export type ClinicUpdate = z.infer<typeof clinicUpdateSchema>;
