import { z } from 'zod';

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
} from '../domain/notification.js';
import { idSchema } from './common.js';

/**
 * Painel de notificacoes: o que foi avisado, para quem e se deu certo.
 *
 * A listagem e por tenant e sempre com `clientId` no filtro implicito da
 * clinica. O corpo da mensagem viaja na resposta porque este e o unico lugar
 * onde o texto enviado fica visivel para o humano -- mas o painel le, e nao
 * edita: reescrever o texto depois undermines a auditoria do que o cliente
 * recebeu de fato.
 */

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export const notificationStatusSchema = z.enum(NOTIFICATION_STATUSES);

export const LIMITE_PAGINA = 100;

export const notificationListQuerySchema = z.object({
  status: notificationStatusSchema.optional(),
  channel: notificationChannelSchema.optional(),
  type: notificationTypeSchema.optional(),
  /** Busca no destinatario, tipo ou nome do cliente. */
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITE_PAGINA).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const notificationSchema = z.object({
  id: z.string(),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  appointmentId: z.string().nullable(),
  channel: notificationChannelSchema,
  type: notificationTypeSchema,
  recipient: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  status: notificationStatusSchema,
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  scheduledFor: z.string(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});

/** Contagem por situacao, para o painel mostrar o que precisa de atencao. */
export const notificationSummarySchema = z.object({
  total: z.number().int(),
  pendente: z.number().int(),
  enviando: z.number().int(),
  enviado: z.number().int(),
  erro: z.number().int(),
  cancelado: z.number().int(),
});

export const notificationListResponseSchema = z.object({
  items: z.array(notificationSchema),
  total: z.number().int(),
  resumo: notificationSummarySchema,
});

export const notificationResendResponseSchema = z.object({
  notification: notificationSchema,
});

export const notificationResendParamsSchema = z.object({ id: idSchema });

export type Notification = z.infer<typeof notificationSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;
export type NotificationSummary = z.infer<typeof notificationSummarySchema>;
