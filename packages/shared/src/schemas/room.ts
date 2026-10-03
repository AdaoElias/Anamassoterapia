import { z } from 'zod';

import { booleanQuerySchema, pageMetaSchema, paginationSchema } from './common.js';

export const roomSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});

export const roomCreateSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da sala').max(80),
});

export const roomUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da sala').max(80).optional(),
  active: z.boolean().optional(),
});

export const roomListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(80).optional(),
  includeInactive: booleanQuerySchema,
});

export const roomListResponseSchema = z.object({
  items: z.array(roomSchema),
  meta: pageMetaSchema,
});

export type Room = z.infer<typeof roomSchema>;
export type RoomCreate = z.infer<typeof roomCreateSchema>;
export type RoomUpdate = z.infer<typeof roomUpdateSchema>;
export type RoomListQuery = z.infer<typeof roomListQuerySchema>;
