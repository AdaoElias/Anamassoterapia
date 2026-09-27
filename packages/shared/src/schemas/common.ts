import { z } from 'zod';

import {
  isValidBrazilianPhone,
  isValidCnpj,
  isValidCpf,
  normalizeBrazilianPhone,
  normalizeCep,
  normalizeCnpj,
  normalizeCpf,
  normalizeSearchText,
} from '../utils/brazilian.js';

/** Centavos. Inteiro para nunca acumular erro de ponto flutuante no financeiro. */
export const moneySchema = z
  .int({ error: 'Valor deve ser informado em centavos (inteiro)' })
  .nonnegative('Valor nao pode ser negativo')
  .max(100_000_00 * 1000, 'Valor acima do limite permitido');

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'E-mail muito curto')
  .max(254, 'E-mail muito longo')
  .email('E-mail invalido');

/** Senha: minimo 8, com letra e numero. Longa vale mais que complexa. */
export const passwordSchema = z
  .string()
  .min(8, 'A senha deve ter ao menos 8 caracteres')
  .max(128, 'A senha deve ter no maximo 128 caracteres')
  .regex(/[A-Za-z]/, 'A senha deve conter ao menos uma letra')
  .regex(/[0-9]/, 'A senha deve conter ao menos um numero');

export const cpfSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeCpf(value);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'CPF invalido' });
    return z.NEVER;
  }
  return normalized;
});

export const cnpjSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeCnpj(value);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'CNPJ invalido' });
    return z.NEVER;
  }
  return normalized;
});

export const phoneSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeBrazilianPhone(value);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'Telefone invalido' });
    return z.NEVER;
  }
  return normalized;
});

export const cepSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeCep(value);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'CEP invalido' });
    return z.NEVER;
  }
  return normalized;
});

/** Data de nascimento: ISO 8601 apenas com data, sem fuso, e idade plausivel. */
export const birthDateSchema = z.iso.date().refine(
  (value) => {
    const birth = new Date(`${value}T00:00:00.000Z`);
    const now = new Date();
    const age = now.getFullYear() - birth.getFullYear();
    return age >= 0 && age <= 120;
  },
  { message: 'Data de nascimento invalida' },
);

/** Slug seguro para URL publica de agendamento. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug deve conter apenas letras, numeros e hifens');

/** Telefone opcional, mas se enviado precisa ser valido. */
export const optionalPhoneSchema = z
  .union([z.literal(''), phoneSchema])
  .optional()
  .transform((value) => (value === '' ? null : value));

export const optionalEmailSchema = z
  .union([z.literal(''), emailSchema])
  .optional()
  .transform((value) => (value === '' ? null : value));

/** Busca livre: normalizada para comparacao sem acento e sem caixa. */
export const searchSchema = z
  .string()
  .max(120)
  .optional()
  .transform((value) => (value ? normalizeSearchText(value) : undefined));

export const idSchema = z.string().uuid('Identificador invalido');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function paginate({ page, perPage }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * perPage, take: perPage };
}

export function buildPageMeta({ page, perPage, total }: Pagination & { total: number }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return {
    page,
    perPage,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  } satisfies {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/** Reexporta os validades para consumo direto em formularios. */
export { isValidBrazilianPhone, isValidCnpj, isValidCpf };
