import { z } from 'zod';

import { booleanQuerySchema, idSchema } from './common.js';

/**
 * Disponibilidade dos profissionais.
 *
 * Uma regra semanal recorrente (`AvailabilityRule`) define as janelas de
 * trabalho; `AvailabilityException` cobre folgas e janelas extras de uma data;
 * `ClinicHoliday` fecha a clinica inteira. Horarios sao minutos desde a
 * meia-noite no fuso da clinica -- a conversao para UTC acontece so no motor
 * de slots.
 */

export const weekdaySchema = z
  .number()
  .int()
  .min(0, 'Dia da semana invalido')
  .max(6, 'Dia da semana invalido');

/** Minutos desde a meia-noite. `1440` e permitido como fim de dia. */
export const minuteOfDaySchema = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);

export const slotGranularitySchema = z
  .number()
  .int()
  .min(5, 'Granularidade minima de 5 minutos')
  .max(240, 'Granularidade maxima de 4 horas');

export const availabilityExceptionTypeSchema = z.enum(['BLOQUEIO', 'EXTRA']);

export const AVAILABILITY_EXCEPTION_TYPE_LABELS = {
  BLOQUEIO: 'Bloqueio',
  EXTRA: 'Janela extra',
} as const;

interface JanelaParcial {
  startMinute?: number | undefined;
  endMinute?: number | undefined;
}

function validarOrdem(janela: JanelaParcial, ctx: z.RefinementCtx): void {
  if (
    janela.startMinute !== undefined &&
    janela.endMinute !== undefined &&
    janela.startMinute >= janela.endMinute
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['endMinute'],
      message: 'Horario final deve ser depois do inicial',
    });
  }
}

interface RegraParcial extends JanelaParcial {
  effectiveFrom?: string | undefined;
  effectiveTo?: string | undefined;
}

function validarRegra(regra: RegraParcial, ctx: z.RefinementCtx): void {
  validarOrdem(regra, ctx);
  const { effectiveFrom: de, effectiveTo: ate } = regra;
  if (ate !== undefined && ate !== '' && de !== undefined && ate < de) {
    ctx.addIssue({
      code: 'custom',
      path: ['effectiveTo'],
      message: 'Vigencia final antes da inicial',
    });
  }
}

const regraBase = z.object({
  professionalId: idSchema,
  weekday: weekdaySchema,
  startMinute: minuteOfDaySchema,
  endMinute: minuteOfDaySchema,
  slotGranularityMinutes: slotGranularitySchema.default(15),
  /** Regra retroativa e erro de agendamento: a vigencia comeca no passado maximo hoje. */
  effectiveFrom: z.iso.date(),
  effectiveTo: z.union([z.literal(''), z.iso.date()]).optional(),
  active: z.boolean().default(true),
});

export const availabilityRuleCreateSchema = regraBase.superRefine(validarRegra);
export const availabilityRuleUpdateSchema = regraBase.partial().superRefine(validarRegra);

export const availabilityRuleSchema = z.object({
  id: z.string(),
  professionalId: z.string(),
  weekday: z.number().int(),
  startMinute: z.number().int(),
  endMinute: z.number().int(),
  slotGranularityMinutes: z.number().int(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  active: z.boolean(),
});

export const availabilityRuleListResponseSchema = z.object({
  items: z.array(availabilityRuleSchema),
});

export const availabilityRuleQuerySchema = z.object({
  professionalId: idSchema,
  includeInactive: booleanQuerySchema,
});

interface ExcecaoParcial extends JanelaParcial {
  type?: 'BLOQUEIO' | 'EXTRA' | undefined;
}

function validarExcecao(excecao: ExcecaoParcial, ctx: z.RefinementCtx): void {
  const { startMinute: inicio, endMinute: fim, type } = excecao;
  const algumLado = inicio !== undefined || fim !== undefined;

  if (type === 'EXTRA' && (inicio === undefined || fim === undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: ['startMinute'],
      message: 'Janela extra exige horario inicial e final',
    });
  }

  if (algumLado && (inicio === undefined || fim === undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: ['endMinute'],
      message: 'Informe horario inicial e final juntos',
    });
  }

  validarOrdem(excecao, ctx);
}

const excecaoBase = z.object({
  professionalId: idSchema,
  date: z.iso.date(),
  type: availabilityExceptionTypeSchema,
  startMinute: minuteOfDaySchema.optional(),
  endMinute: minuteOfDaySchema.optional(),
  reason: z.string().trim().max(200).optional(),
  active: z.boolean().default(true),
});

export const availabilityExceptionCreateSchema = excecaoBase.superRefine(validarExcecao);

export const availabilityExceptionSchema = z.object({
  id: z.string(),
  professionalId: z.string(),
  date: z.string(),
  type: availabilityExceptionTypeSchema,
  startMinute: z.number().int().nullable(),
  endMinute: z.number().int().nullable(),
  reason: z.string().nullable(),
  active: z.boolean(),
});

export const availabilityExceptionListResponseSchema = z.object({
  items: z.array(availabilityExceptionSchema),
});

export const availabilityExceptionQuerySchema = z.object({
  professionalId: idSchema,
  from: z.iso.date(),
  to: z.iso.date(),
});

export const clinicHolidayCreateSchema = z.object({
  date: z.iso.date(),
  description: z.string().trim().max(120).optional(),
});

export const clinicHolidaySchema = z.object({
  id: z.string(),
  date: z.string(),
  description: z.string().nullable(),
});

export const clinicHolidayListResponseSchema = z.object({
  items: z.array(clinicHolidaySchema),
});

export const clinicHolidayQuerySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});

export type AvailabilityRule = z.infer<typeof availabilityRuleSchema>;
export type AvailabilityRuleCreate = z.infer<typeof availabilityRuleCreateSchema>;
export type AvailabilityRuleUpdate = z.infer<typeof availabilityRuleUpdateSchema>;
export type AvailabilityException = z.infer<typeof availabilityExceptionSchema>;
export type AvailabilityExceptionCreate = z.infer<typeof availabilityExceptionCreateSchema>;
export type ClinicHoliday = z.infer<typeof clinicHolidaySchema>;
export type ClinicHolidayCreate = z.infer<typeof clinicHolidayCreateSchema>;
