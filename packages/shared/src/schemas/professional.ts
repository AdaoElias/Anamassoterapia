import { z } from 'zod';

import {
  booleanQuerySchema,
  clearableEmailSchema,
  clearablePhoneSchema,
  hexColorSchema,
  idSchema,
  pageMetaSchema,
  paginationSchema,
} from './common.js';

/**
 * Cadastro de profissionais. Nesta etapa o profissional NAO tem login:
 * `userId` fica nulo e o convite para acessar o painel entra depois.
 */

const commissionSchema = z
  .number()
  .int()
  .min(0, 'Comissao nao pode ser negativa')
  .max(10_000, 'Comissao no maximo 100% (10000 basis points)');

export const professionalSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  registrationType: z.string().nullable(),
  bio: z.string().nullable(),
  color: z.string().nullable(),
  defaultCommissionBasisPoints: z.number().int(),
  active: z.boolean(),
  /** Terapias habilitadas para este profissional. */
  therapyIds: z.array(z.string()),
});

export const professionalCreateSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120),
  email: clearableEmailSchema.optional(),
  phone: clearablePhoneSchema.optional(),
  registrationNumber: z.string().trim().max(40).optional(),
  registrationType: z.string().trim().max(20).optional(),
  bio: z.string().trim().max(600).optional(),
  color: hexColorSchema.optional(),
  defaultCommissionBasisPoints: commissionSchema.default(0),
  active: z.boolean().default(true),
  therapyIds: z.array(idSchema).max(200).default([]),
});

export const professionalUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120).optional(),
  email: clearableEmailSchema.optional(),
  phone: clearablePhoneSchema.optional(),
  registrationNumber: z.union([z.literal(''), z.string().trim().max(40)]).optional(),
  registrationType: z.union([z.literal(''), z.string().trim().max(20)]).optional(),
  bio: z.union([z.literal(''), z.string().trim().max(600)]).optional(),
  color: z.union([z.literal(''), hexColorSchema]).optional(),
  defaultCommissionBasisPoints: commissionSchema.optional(),
  active: z.boolean().optional(),
  /** Quando enviado, substitui o conjunto de terapias habilitadas. */
  therapyIds: z.array(idSchema).max(200).optional(),
});

export const professionalListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  includeInactive: booleanQuerySchema,
  therapyId: idSchema.optional(),
});

export const professionalListResponseSchema = z.object({
  items: z.array(professionalSchema),
  meta: pageMetaSchema,
});

export type Professional = z.infer<typeof professionalSchema>;
export type ProfessionalCreate = z.infer<typeof professionalCreateSchema>;
export type ProfessionalUpdate = z.infer<typeof professionalUpdateSchema>;
export type ProfessionalListQuery = z.infer<typeof professionalListQuerySchema>;
