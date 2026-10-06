import { z } from 'zod';

import {
  COMMISSION_STATUSES,
  FINANCIAL_ENTRY_KINDS,
  FINANCIAL_ENTRY_STATUSES,
  PACKAGE_SESSION_STATUSES,
  PACKAGE_STATUSES,
  PAYMENT_METHODS,
} from '../domain/financial.js';
import { idSchema, moneySchema, pageMetaSchema, paginationSchema } from './common.js';

/**
 * Financeiro: lancamentos, pacotes, comissoes e resumo.
 *
 * Dinheiro em centavos desde o schema: o mesmo Int que o Prisma guarda.
 * Datas civis (`YYYY-MM-DD`) nas colunas `@db.Date`; instantes ISO com fuso
 * nos timestamps.
 */

/** Data civil `YYYY-MM-DD` para filtros e vencimentos. */
export const dateQuerySchema = z.iso.date();

// --- Lancamentos financeiros ------------------------------------------

export const financialEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(FINANCIAL_ENTRY_KINDS),
  status: z.enum(FINANCIAL_ENTRY_STATUSES),
  method: z.enum(PAYMENT_METHODS).nullable(),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  appointmentId: z.string().nullable(),
  packageId: z.string().nullable(),
  amountCents: z.number().int(),
  /** `YYYY-MM-DD`, ou nulo quando o vencimento nao se aplica. */
  dueDate: z.string().nullable(),
  /** Instante ISO, preenchido quando a entrada foi liquidada. */
  paidAt: z.string().nullable(),
  description: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

export const financialEntryListQuerySchema = paginationSchema.extend({
  kind: z.enum(FINANCIAL_ENTRY_KINDS).optional(),
  status: z.enum(FINANCIAL_ENTRY_STATUSES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  clientId: idSchema.optional(),
  /** Filtra pelo vencimento (`dueDate`). */
  de: dateQuerySchema.optional(),
  ate: dateQuerySchema.optional(),
});

export const financialEntryListResponseSchema = z.object({
  items: z.array(financialEntrySchema),
  meta: pageMetaSchema,
});

/**
 * Criacao de lancamento. Regra de status implicita por design: `method`
 * presente lanca como PAGO (pagamento na hora); ausente lanca como PENDENTE
 * (a receber), para ser liquidado depois em `/lancamentos/:id/pagar`.
 * `paidAt` so entra junto com `method`.
 */
export const financialEntryCreateSchema = z.object({
  kind: z.enum(FINANCIAL_ENTRY_KINDS),
  method: z.enum(PAYMENT_METHODS).optional(),
  clientId: idSchema.optional(),
  appointmentId: idSchema.optional(),
  packageId: idSchema.optional(),
  amountCents: moneySchema,
  dueDate: dateQuerySchema.optional(),
  paidAt: z.iso.datetime().optional(),
  description: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(3).max(80).optional(),
});

export const financialEntryPaymentInputSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  paidAt: z.iso.datetime().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const financialEntryCancelSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});

// --- Pacotes de sessoes ------------------------------------------------

export const packageSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  name: z.string(),
  totalSessions: z.number().int(),
  priceCents: z.number().int(),
  validFrom: z.string(),
  validUntil: z.string(),
  status: z.enum(PACKAGE_STATUSES),
  notes: z.string().nullable(),
  /** O saldo e o count das sessoes; nunca um contador guardado no pacote. */
  sessoesUsadas: z.number().int(),
  sessoesRestantes: z.number().int(),
  createdAt: z.string(),
});

export const packageListQuerySchema = paginationSchema.extend({
  status: z.enum(PACKAGE_STATUSES).optional(),
  clientId: idSchema.optional(),
});

export const packageListResponseSchema = z.object({
  items: z.array(packageSchema),
  meta: pageMetaSchema,
});

export const packageCreateSchema = z
  .object({
    clientId: idSchema,
    name: z.string().trim().min(2, 'Nome muito curto').max(120),
    totalSessions: z.coerce.number().int().min(1).max(999),
    priceCents: moneySchema,
    validFrom: dateQuerySchema,
    validUntil: dateQuerySchema,
    notes: z.string().trim().max(600).optional(),
    /**
     * Pagamento na venda. Presente: cria a receita como PAGO. Ausente:
     * cria a receita a receber, para ser liquidada nos lancamentos.
     */
    payment: z
      .object({
        method: z.enum(PAYMENT_METHODS),
        paidAt: z.iso.datetime().optional(),
      })
      .optional(),
  })
  .refine((pacote) => pacote.validUntil >= pacote.validFrom, {
    message: 'A validade final nao pode ser menor que a inicial.',
    path: ['validUntil'],
  });

export const packageStatusUpdateSchema = z.object({
  status: z.enum(['CONCLUIDO', 'CANCELADO', 'EXPIRADO']),
});

export const packageSessionSchema = z.object({
  id: z.string(),
  status: z.enum(PACKAGE_SESSION_STATUSES),
  appointmentId: z.string().nullable(),
  consumedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

export const packageDetailSchema = packageSchema.extend({
  sessions: z.array(packageSessionSchema),
});

// --- Comissoes ---------------------------------------------------------

export const commissionSchema = z.object({
  id: z.string(),
  professionalId: z.string(),
  professionalName: z.string(),
  appointmentId: z.string().nullable(),
  baseAmountCents: z.number().int(),
  percentBasisPoints: z.number().int(),
  amountCents: z.number().int(),
  status: z.enum(COMMISSION_STATUSES),
  periodStart: z.string(),
  periodEnd: z.string(),
  paidAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

export const commissionListQuerySchema = paginationSchema.extend({
  professionalId: idSchema.optional(),
  status: z.enum(COMMISSION_STATUSES).optional(),
});

export const commissionListResponseSchema = z.object({
  items: z.array(commissionSchema),
  meta: pageMetaSchema,
});

// --- Resumo do periodo -------------------------------------------------

export const resumoQuerySchema = z.object({
  de: dateQuerySchema.optional(),
  ate: dateQuerySchema.optional(),
});

export const resumoFinanceiroSchema = z.object({
  de: z.string(),
  ate: z.string(),
  /** Receita liquidada no periodo (paidAt dentro de [de, ate]). */
  recebido: z.number().int(),
  /** Despesa liquidada no periodo. */
  despesas: z.number().int(),
  /** recebido - despesas. */
  saldoPeriodo: z.number().int(),
  /** Receita a receber com vencimento dentro do periodo. */
  aReceber: z.number().int(),
  /** Dentre `aReceber`, o que ja venceu antes de hoje. */
  aReceberVencido: z.number().int(),
  recebidoPorMetodo: z.array(
    z.object({
      method: z.enum(PAYMENT_METHODS),
      total: z.number().int(),
      quantidade: z.number().int(),
    }),
  ),
  aReceberPorCliente: z.array(
    z.object({
      clientName: z.string(),
      total: z.number().int(),
    }),
  ),
  comissoes: z.object({
    /** Prevista + aprovada, ainda nao pagas. */
    aPagar: z.number().int(),
    /** Pagas dentro do periodo. */
    pagas: z.number().int(),
  }),
});

// --- Tipos -------------------------------------------------------------

export type FinancialEntry = z.infer<typeof financialEntrySchema>;
export type FinancialEntryCreate = z.infer<typeof financialEntryCreateSchema>;
export type FinancialEntryPaymentInput = z.infer<typeof financialEntryPaymentInputSchema>;
export type FinancialEntryCancel = z.infer<typeof financialEntryCancelSchema>;
export type FinancialEntryListQuery = z.infer<typeof financialEntryListQuerySchema>;
export type Package = z.infer<typeof packageSchema>;
export type PackageCreate = z.infer<typeof packageCreateSchema>;
export type PackageDetail = z.infer<typeof packageDetailSchema>;
export type PackageSession = z.infer<typeof packageSessionSchema>;
export type PackageStatusUpdate = z.infer<typeof packageStatusUpdateSchema>;
export type Commission = z.infer<typeof commissionSchema>;
export type CommissionListQuery = z.infer<typeof commissionListQuerySchema>;
export type ResumoFinanceiro = z.infer<typeof resumoFinanceiroSchema>;
export type ResumoQuery = z.infer<typeof resumoQuerySchema>;
