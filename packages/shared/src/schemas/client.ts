import { z } from 'zod';

import {
  birthDateSchema,
  booleanQuerySchema,
  clearableCepSchema,
  clearableCpfSchema,
  clearableEmailSchema,
  clearablePhoneSchema,
  pageMetaSchema,
  paginationSchema,
} from './common.js';

/** Cadastro de clientes da clinica. */

const clearableBirthDateSchema = z.union([z.literal(''), birthDateSchema]);
const clearableText = (max: number) => z.union([z.literal(''), z.string().trim().max(max)]);

export const clientSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  cpf: z.string().nullable(),
  /** `YYYY-MM-DD`, ou nulo. */
  birthDate: z.string().nullable(),
  gender: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressCity: z.string().nullable(),
  addressState: z.string().nullable(),
  addressZip: z.string().nullable(),
  notes: z.string().nullable(),
  marketingOptIn: z.boolean(),
  active: z.boolean(),
});

export const clientCreateSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120),
  email: clearableEmailSchema.optional(),
  phone: clearablePhoneSchema.optional(),
  cpf: clearableCpfSchema.optional(),
  birthDate: clearableBirthDateSchema.optional(),
  gender: z.string().trim().max(40).optional(),
  addressLine1: z.string().trim().max(160).optional(),
  addressCity: z.string().trim().max(80).optional(),
  addressState: z.string().trim().toUpperCase().length(2, 'Use a sigla da UF').optional(),
  addressZip: clearableCepSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
  marketingOptIn: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const clientUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120).optional(),
  email: clearableEmailSchema.optional(),
  phone: clearablePhoneSchema.optional(),
  cpf: clearableCpfSchema.optional(),
  birthDate: clearableBirthDateSchema.optional(),
  gender: clearableText(40).optional(),
  addressLine1: clearableText(160).optional(),
  addressCity: clearableText(80).optional(),
  addressState: z
    .union([z.literal(''), z.string().trim().toUpperCase().length(2, 'Use a sigla da UF')])
    .optional(),
  addressZip: clearableCepSchema.optional(),
  notes: clearableText(1000).optional(),
  marketingOptIn: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const clientListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  includeInactive: booleanQuerySchema,
});

export const clientListResponseSchema = z.object({
  items: z.array(clientSchema),
  meta: pageMetaSchema,
});

export type Client = z.infer<typeof clientSchema>;
export type ClientCreate = z.infer<typeof clientCreateSchema>;
export type ClientUpdate = z.infer<typeof clientUpdateSchema>;
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;
