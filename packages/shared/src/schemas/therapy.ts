import { z } from 'zod';

import {
  booleanQuerySchema,
  hexColorSchema,
  moneySchema,
  pageMetaSchema,
  paginationSchema,
  slugSchema,
} from './common.js';

/** Cardapio de terapias: o que a clinica oferece e a que preco. */

const durationMinutesSchema = z.number().int().min(5).max(600);
const bufferMinutesSchema = z.number().int().min(0).max(240);
const ageSchema = z.number().int().min(0).max(120);
const imageUrlSchema = z.string().trim().max(300).url('Informe uma URL valida');

export const therapySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  durationMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  priceCents: z.number().int(),
  color: z.string().nullable(),
  imageUrl: z.string().nullable(),
  requiresAnamnesis: z.boolean(),
  requiresMedicalClearance: z.boolean(),
  minNoticeMinutes: z.number().int(),
  minAge: z.number().int().nullable(),
  maxAge: z.number().int().nullable(),
  position: z.number().int(),
  active: z.boolean(),
});

export const therapyCreateSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome muito curto').max(120),
    /** Opcional: quando ausente, a API deriva do nome. */
    slug: slugSchema.optional(),
    description: z.string().trim().max(1200).optional(),
    category: z.string().trim().max(60).optional(),
    durationMinutes: durationMinutesSchema.default(60),
    bufferMinutes: bufferMinutesSchema.default(0),
    priceCents: moneySchema,
    color: hexColorSchema.optional(),
    imageUrl: imageUrlSchema.optional(),
    requiresAnamnesis: z.boolean().default(true),
    requiresMedicalClearance: z.boolean().default(false),
    minNoticeMinutes: z.number().int().min(0).max(20_160).default(0),
    minAge: ageSchema.optional(),
    maxAge: ageSchema.optional(),
    position: z.number().int().min(0).max(100_000).default(0),
    active: z.boolean().default(true),
  })
  .refine(
    (value) =>
      value.minAge === undefined || value.maxAge === undefined || value.minAge <= value.maxAge,
    {
      path: ['maxAge'],
      message: 'Idade maxima deve ser maior ou igual a minima',
    },
  );

export const therapyUpdateSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome muito curto').max(120).optional(),
    slug: slugSchema.optional(),
    description: z.union([z.literal(''), z.string().trim().max(1200)]).optional(),
    category: z.union([z.literal(''), z.string().trim().max(60)]).optional(),
    durationMinutes: durationMinutesSchema.optional(),
    bufferMinutes: bufferMinutesSchema.optional(),
    priceCents: moneySchema.optional(),
    color: z.union([z.literal(''), hexColorSchema]).optional(),
    imageUrl: z.union([z.literal(''), imageUrlSchema]).optional(),
    requiresAnamnesis: z.boolean().optional(),
    requiresMedicalClearance: z.boolean().optional(),
    minNoticeMinutes: z.number().int().min(0).max(20_160).optional(),
    minAge: ageSchema.nullable().optional(),
    maxAge: ageSchema.nullable().optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => value.minAge == null || value.maxAge == null || value.minAge <= value.maxAge, {
    path: ['maxAge'],
    message: 'Idade maxima deve ser maior ou igual a minima',
  });

export const therapyListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  includeInactive: booleanQuerySchema,
});

export const therapyListResponseSchema = z.object({
  items: z.array(therapySchema),
  meta: pageMetaSchema,
});

export type Therapy = z.infer<typeof therapySchema>;
export type TherapyCreate = z.infer<typeof therapyCreateSchema>;
export type TherapyUpdate = z.infer<typeof therapyUpdateSchema>;
export type TherapyListQuery = z.infer<typeof therapyListQuerySchema>;
