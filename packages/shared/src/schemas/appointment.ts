import { z } from 'zod';

import { APPOINTMENT_STATUSES } from '../domain/appointment-status.js';
import { APPOINTMENT_SOURCES, CANCELLATION_REASONS } from '../domain/financial.js';
import { idSchema } from './common.js';

/**
 * Agenda: sessoes agendadas e o calculo de horarios livres.
 *
 * `startAt`/`endAt` trafegam como instantes ISO em UTC; o fuso da clinica
 * aparece so na apresentacao. O `id` do profissional no slot permite montar a
 * agenda por profissional.
 */

export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);

/** Reexportado do dominio financeiro para uso direto no contrato da agenda. */
export const appointmentSourceSchema = z.enum(APPOINTMENT_SOURCES);

export const cancellationReasonSchema = z.enum(CANCELLATION_REASONS);

/** Intervalo de datas do calendario. Mais que isso esconde erro de digitacao. */
export const MAX_RANGE_DAYS = 62;

const dataISO = z.iso.date();

function dentroDoLimite(de: string, ate: string): boolean {
  const inicio = new Date(`${de}T00:00:00.000Z`).getTime();
  const fim = new Date(`${ate}T00:00:00.000Z`).getTime();
  return (fim - inicio) / 86_400_000 <= MAX_RANGE_DAYS;
}

// --- Horarios livres -------------------------------------------------

export const slotQuerySchema = z
  .object({
    therapyId: idSchema,
    from: dataISO,
    /** Ausente: assume o mesmo dia de `from`. */
    to: dataISO.optional(),
    professionalId: idSchema.optional(),
  })
  .refine((valor) => dentroDoLimite(valor.from, valor.to ?? valor.from), {
    path: ['to'],
    message: `Intervalo maximo de ${MAX_RANGE_DAYS} dias`,
  });

export const slotSchema = z.object({
  professionalId: z.string(),
  date: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  startMinute: z.number().int(),
  endMinute: z.number().int(),
});

export const slotListResponseSchema = z.object({
  items: z.array(slotSchema),
});

// --- Agenda ----------------------------------------------------------

export const appointmentSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  professionalId: z.string(),
  professionalName: z.string(),
  therapyId: z.string(),
  therapyName: z.string(),
  roomId: z.string().nullable(),
  roomName: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string(),
  status: appointmentStatusSchema,
  source: appointmentSourceSchema,
  priceCents: z.number().int(),
  notes: z.string().nullable(),
  sessionNotes: z.string().nullable(),
  cancellationReason: cancellationReasonSchema.nullable(),
  cancelledAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const appointmentListQuerySchema = z
  .object({
    from: dataISO,
    to: dataISO,
    professionalId: idSchema.optional(),
    clientId: idSchema.optional(),
    status: appointmentStatusSchema.optional(),
  })
  .refine((valor) => dentroDoLimite(valor.from, valor.to), {
    path: ['to'],
    message: `Intervalo maximo de ${MAX_RANGE_DAYS} dias`,
  });

export const appointmentListResponseSchema = z.object({
  items: z.array(appointmentSchema),
});

export const appointmentCreateSchema = z.object({
  clientId: idSchema,
  professionalId: idSchema,
  therapyId: idSchema,
  startAt: z.iso.datetime({ offset: true }),
  roomId: z.union([z.literal(''), idSchema]).optional(),
  notes: z.string().trim().max(1000).optional(),
  status: appointmentStatusSchema.optional(),
});

export const appointmentUpdateSchema = z.object({
  startAt: z.iso.datetime({ offset: true }).optional(),
  professionalId: idSchema.optional(),
  therapyId: idSchema.optional(),
  roomId: z.union([z.literal(''), idSchema]).optional(),
  notes: z.union([z.literal(''), z.string().trim().max(1000)]).optional(),
});

export const appointmentStatusUpdateSchema = z.object({
  status: appointmentStatusSchema,
  reason: z.string().trim().max(300).optional(),
  cancellationReason: cancellationReasonSchema.optional(),
});

export type Appointment = z.infer<typeof appointmentSchema>;
export type AppointmentCreate = z.infer<typeof appointmentCreateSchema>;
export type AppointmentUpdate = z.infer<typeof appointmentUpdateSchema>;
export type AppointmentStatusUpdate = z.infer<typeof appointmentStatusUpdateSchema>;
export type Slot = z.infer<typeof slotSchema>;
export type SlotQuery = z.infer<typeof slotQuerySchema>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
