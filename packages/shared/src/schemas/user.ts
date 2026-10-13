import { z } from 'zod';

import { ROLES } from '../domain/roles.js';
import {
  booleanQuerySchema,
  emailSchema,
  idSchema,
  pageMetaSchema,
  paginationSchema,
} from './common.js';

/**
 * Gestao de usuarios da clinica (secao 5.2 do deploy).
 *
 * O cadastro de pessoas da operacao vive em `clinic_memberships`: e a
 * membership (e nao o `User`) que concede acesso a uma clinica. O `User` e a
 * identidade global de login e pode pertencer a mais de uma clinica -- por
 * isso a lista e por tenant e nao por usuario.
 */

export const membershipRoleSchema = z.enum(ROLES);

/**
 * Papeis que um ADMIN pode conceder por convite. `CLIENTE` fica de fora: o
 * cliente do portal nao faz login (o link publico e a credencial), entao criar
 * uma membership de cliente aqui so poluiria a lista.
 */
const staffRoleSchema = z.enum(['ADMIN', 'PROFISSIONAL']);

export const membershipSchema = z.object({
  /** Id da membership (nao do usuario): e a chave das acoes de role/atividade. */
  id: idSchema,
  userId: idSchema,
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  role: membershipRoleSchema,
  jobTitle: z.string().nullable(),
  active: z.boolean(),
  /** Nulo enquanto a pessoa nunca entrou; o painel mostra "convite pendente". */
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export const membershipListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  includeInactive: booleanQuerySchema,
});

export const membershipListResponseSchema = z.object({
  items: z.array(membershipSchema),
  meta: pageMetaSchema,
});

export const membershipInviteSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120),
  email: emailSchema,
  role: staffRoleSchema.default('PROFISSIONAL'),
  jobTitle: z.string().trim().max(80).optional(),
});

export const membershipUpdateSchema = z.object({
  role: membershipRoleSchema.optional(),
  active: z.boolean().optional(),
  jobTitle: z.union([z.literal(''), z.string().trim().max(80)]).optional(),
});

export const membershipInviteResponseSchema = z.object({
  membership: membershipSchema,
  /**
   * Link para a pessoa definir a propria senha. So vem preenchido quando o
   * envio de e-mail esta desligado (`NOTIFIER_DRIVER=log`), para o operador
   * repassar manualmente; em producao o link vai por e-mail e fica `null`.
   */
  inviteLink: z.string().nullable(),
});

export type Membership = z.infer<typeof membershipSchema>;
export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type MembershipListQuery = z.infer<typeof membershipListQuerySchema>;
export type MembershipInvite = z.infer<typeof membershipInviteSchema>;
export type MembershipUpdate = z.infer<typeof membershipUpdateSchema>;
export type MembershipInviteResponse = z.infer<typeof membershipInviteResponseSchema>;
