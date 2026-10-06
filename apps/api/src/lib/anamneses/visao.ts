import { type AnamnesisForm, anamnesisFormSchema } from '@massoterapia/shared';

import type { Prisma } from '../../generated/prisma/client.js';
import { paraDataISO } from '../cadastros.js';
import { revelar } from './servico.js';

/**
 * Selecoes e formatadores das respostas de prontuario.
 *
 * Fica num modulo proprio porque tres rotas precisam das mesmas formas:
 * anamnese (lista e detalhe), contraindicacao (condicoes e alertas) e
 * prontuario (tudo junto). Duplicar esses formatadores em cada rota daria
 * tres lugares para o contrato divergir, e o contrato e o que o painel
 * consome.
 */

/** `schema` entra no select porque o rascunho e validado contra ele. */
export const anamnesisSelect = {
  id: true,
  clientId: true,
  version: true,
  status: true,
  answersEncrypted: true,
  contentHash: true,
  signedAt: true,
  submittedAt: true,
  reviewedAt: true,
  reviewNotes: true,
  createdAt: true,
  template: { select: { id: true, name: true, version: true, schema: true } },
  reviewedBy: { select: { name: true } },
} as const;

export type LinhaAnamnesis = Prisma.AnamnesisGetPayload<{ select: typeof anamnesisSelect }>;

/** Lista e prontuario: metadados, sem a resposta. */
export const anamnesisListaSelect = {
  id: true,
  clientId: true,
  version: true,
  status: true,
  answersEncrypted: true,
  contentHash: true,
  signedAt: true,
  submittedAt: true,
  reviewedAt: true,
  reviewNotes: true,
  createdAt: true,
  template: { select: { id: true, name: true, version: true } },
  reviewedBy: { select: { name: true } },
} as const;

export type LinhaAnamnesisLista = Prisma.AnamnesisGetPayload<{
  select: typeof anamnesisListaSelect;
}>;

export function respostaAnamnesis(linha: LinhaAnamnesis | LinhaAnamnesisLista) {
  return {
    id: linha.id,
    clientId: linha.clientId,
    templateId: linha.template?.id ?? null,
    templateName: linha.template?.name ?? null,
    templateVersion: linha.template?.version ?? null,
    version: linha.version,
    status: linha.status,
    // `hasAnswers` e o que permite ao painel mostrar "rascunho vazio" sem
    // tentar decifrar: a coluna nula e o unico caso legitimo sem conteudo.
    hasAnswers: linha.answersEncrypted !== null,
    contentHash: linha.contentHash,
    signedAt: linha.signedAt?.toISOString() ?? null,
    submittedAt: linha.submittedAt?.toISOString() ?? null,
    reviewedAt: linha.reviewedAt?.toISOString() ?? null,
    reviewedByName: linha.reviewedBy?.name ?? null,
    reviewNotes: linha.reviewNotes,
    createdAt: linha.createdAt.toISOString(),
  };
}

/** Detalhe: metadados + resposta decifrada + formulario que a pediu. */
export function detalheAnamnesis(linha: LinhaAnamnesis) {
  return {
    ...respostaAnamnesis(linha),
    schema: linha.template === null ? null : anamnesisFormSchema.parse(linha.template.schema),
    answers: revelar(linha).answers,
  };
}

/** Formulario vazio: nunca usado, mas mantem o tipo sem `null`. */
export const FORMULARIO_VAZIO: AnamnesisForm = {
  type: 'object',
  order: [],
  required: [],
  properties: {},
};

export function formularioDe(linha: LinhaAnamnesis): AnamnesisForm {
  return linha.template === null
    ? FORMULARIO_VAZIO
    : anamnesisFormSchema.parse(linha.template.schema);
}

export const condicaoSelect = {
  id: true,
  clientId: true,
  contraindicationId: true,
  code: true,
  title: true,
  description: true,
  severity: true,
  requiresMedicalClearance: true,
  source: true,
  diagnosedAt: true,
  resolvedAt: true,
  notes: true,
  createdAt: true,
} as const;

export type LinhaCondicao = Prisma.ClientContraindicationGetPayload<{
  select: typeof condicaoSelect;
}>;

export function respostaCondicao(linha: LinhaCondicao) {
  return {
    ...linha,
    diagnosedAt: paraDataISO(linha.diagnosedAt),
    resolvedAt: paraDataISO(linha.resolvedAt),
    createdAt: linha.createdAt.toISOString(),
  };
}

export const alertaSelect = {
  id: true,
  appointmentId: true,
  clientContraindicationId: true,
  contraindicationId: true,
  severity: true,
  message: true,
  decision: true,
  decisionNotes: true,
  acknowledgedAt: true,
  createdAt: true,
  clientCondition: { select: { title: true } },
  acknowledgedBy: { select: { name: true } },
  appointment: {
    select: {
      startAt: true,
      client: { select: { id: true, name: true } },
      therapy: { select: { name: true } },
      professional: { select: { name: true } },
    },
  },
} as const;

export type LinhaAlerta = Prisma.ContraindicationAlertGetPayload<{ select: typeof alertaSelect }>;

export function respostaAlerta(linha: LinhaAlerta) {
  return {
    id: linha.id,
    appointmentId: linha.appointmentId,
    clientId: linha.appointment.client.id,
    clientName: linha.appointment.client.name,
    therapyName: linha.appointment.therapy.name,
    professionalName: linha.appointment.professional.name,
    startAt: linha.appointment.startAt.toISOString(),
    clientContraindicationId: linha.clientContraindicationId,
    conditionTitle: linha.clientCondition?.title ?? null,
    contraindicationId: linha.contraindicationId,
    severity: linha.severity,
    message: linha.message,
    decision: linha.decision,
    decisionNotes: linha.decisionNotes,
    acknowledgedAt: linha.acknowledgedAt?.toISOString() ?? null,
    acknowledgedByName: linha.acknowledgedBy?.name ?? null,
    createdAt: linha.createdAt.toISOString(),
  };
}

export const CATALOGO_SELECT = {
  id: true,
  code: true,
  title: true,
  description: true,
  severity: true,
  requiresMedicalClearance: true,
  active: true,
  createdAt: true,
  therapies: { select: { therapyId: true } },
} as const;

export type LinhaCatalogo = Prisma.ContraindicationGetPayload<{ select: typeof CATALOGO_SELECT }>;

export function respostaCatalogo(linha: LinhaCatalogo) {
  return {
    id: linha.id,
    code: linha.code,
    title: linha.title,
    description: linha.description,
    severity: linha.severity,
    requiresMedicalClearance: linha.requiresMedicalClearance,
    active: linha.active,
    therapyIds: linha.therapies.map((vinculo) => vinculo.therapyId),
    createdAt: linha.createdAt.toISOString(),
  };
}

export const TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  version: true,
  schema: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
  therapies: { select: { therapyId: true } },
} as const;

export type LinhaTemplate = Prisma.AnamnesisTemplateGetPayload<{ select: typeof TEMPLATE_SELECT }>;

export function respostaTemplate(linha: LinhaTemplate) {
  return {
    id: linha.id,
    name: linha.name,
    description: linha.description,
    version: linha.version,
    // Revalidado na leitura: `schema` e dado cru do banco e o contrato
    // compartilhado e quem garante a forma. Divergencia aqui e bug de
    // escrita, e um erro honesto e melhor que um formulario quebrado.
    schema: anamnesisFormSchema.parse(linha.schema),
    isDefault: linha.isDefault,
    isActive: linha.isActive,
    therapyIds: linha.therapies.map((vinculo) => vinculo.therapyId),
    createdAt: linha.createdAt.toISOString(),
  };
}

export function naoEncontradoAnamnese(): { error: string; message: string } {
  return { error: 'ANAMNESIS_NOT_FOUND', message: 'Anamnese nao encontrada.' };
}

export function naoEncontradoCliente(): { error: string; message: string } {
  return { error: 'CLIENT_NOT_FOUND', message: 'Cliente nao encontrado.' };
}
