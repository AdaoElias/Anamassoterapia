import { z } from 'zod';

import {
  ALERT_DECISIONS,
  ALERT_DECISOES_REGISTRADAS,
  ALERT_SEVERITIES,
  ANAMNESIS_STATUSES,
} from '../domain/anamnesis.js';
import { booleanQuerySchema, idSchema } from './common.js';

/**
 * Prontuario: formulario de anamnese, versoes do cliente, condicoes de saude
 * e alertas de contraindicacao.
 *
 * Regra que atravessa o arquivo: **quem responde a anamnese nao edita o
 * formulario e quem revisa nao reescreve a resposta**. Mudar o formulario
 * cria uma versao nova do template; corrigir uma resposta cria uma versao
 * nova da anamnese. Isso e o que permite provar, anos depois, com qual
 * formulario e com qual resposta o atendimento foi feito.
 */

const chaveSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'Chave de campo deve ser snake_case minusculo');

/** Subconjunto de JSON Schema que o portal sabe renderizar e a API validar. */
export const anamnesisPropertySchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean', 'array']),
  title: z.string().trim().min(1, 'Todo campo precisa de um titulo').max(160),
  description: z.string().trim().max(300).optional(),
  enum: z.array(z.string().trim().min(1).max(120)).min(1).max(40).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().min(0).max(4000).optional(),
  maxLength: z.number().int().min(1).max(4000).optional(),
  /** `textarea` e `date` mudam o controle no portal; `text` e o padrao. */
  format: z.enum(['text', 'textarea', 'date']).optional(),
});

/**
 * Formulario do template.
 *
 * `order` existe porque o `jsonb` do Postgres **nao preserva a ordem das
 * chaves**: sem a lista explicita, os campos do formulario sairiam em ordem
 * alfabetica no portal. E `properties` sozinho nao diz o que e obrigatorio.
 */
export const anamnesisFormSchema = z
  .object({
    type: z.literal('object'),
    order: z.array(chaveSchema).min(1, 'Formulario precisa de ao menos um campo').max(120),
    required: z.array(chaveSchema).max(120).default([]),
    properties: z.record(chaveSchema, anamnesisPropertySchema),
  })
  .superRefine((form, ctx) => {
    for (const chave of form.order) {
      if (form.properties[chave] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['order'],
          message: `O campo "${chave}" esta na ordem mas nao tem definicao`,
        });
      }
    }

    for (const chave of Object.keys(form.properties)) {
      if (!form.order.includes(chave)) {
        ctx.addIssue({
          code: 'custom',
          path: ['properties', chave],
          message: `O campo "${chave}" tem definicao mas nao esta na ordem`,
        });
      }
    }

    for (const chave of form.required) {
      if (form.properties[chave] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['required'],
          message: `O campo obrigatorio "${chave}" nao existe no formulario`,
        });
      }
    }
  });

export type AnamnesisProperty = z.infer<typeof anamnesisPropertySchema>;

export type AnamnesisForm = z.infer<typeof anamnesisFormSchema>;

/**
 * Valor de resposta. Deliberadamente sem objeto: anamnese e formulario
 * plano (campo -> resposta). Aceitar JSON aninhado abriria a porta para
 * guardar estrutura arbitraria dentro da cifra sem schema que a valide.
 */
export const anamnesisAnswerValueSchema = z.union([
  z.string().max(4000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(50),
  z.null(),
]);

/** 32 KB de texto cifrado cobrem uma anamnese longa sem virar um pacote de dados. */
export const TAMANHO_MAXIMO_RESPOSTAS = 32_000;

export const anamnesisAnswersSchema = z
  .record(chaveSchema, anamnesisAnswerValueSchema)
  .refine((respostas) => JSON.stringify(respostas).length <= TAMANHO_MAXIMO_RESPOSTAS, {
    message: 'As respostas estao grandes demais. Resuma os campos de texto longo.',
  });

export type AnamnesisAnswers = z.infer<typeof anamnesisAnswersSchema>;

// --- Templates --------------------------------------------------------

export const anamnesisTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int(),
  schema: anamnesisFormSchema,
  isDefault: z.boolean(),
  isActive: z.boolean(),
  /** Terapias que usam este template. Vazio = template padrao da clinica. */
  therapyIds: z.array(z.string()),
  createdAt: z.string(),
});

export const anamnesisTemplateCreateSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120),
  description: z.string().trim().max(600).optional(),
  schema: anamnesisFormSchema,
  isDefault: z.boolean().default(false),
  therapyIds: z.array(idSchema).max(50).default([]),
});

/**
 * PATCH do template **nao** mexe no `schema`. Alterar o formulario e a
 * `POST /anamnesis/templates/:id/versao`: e a versao antiga que as anamneses
 * ja respondidas continuam apontando.
 */
export const anamnesisTemplateUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.union([z.literal(''), z.string().trim().max(600)]).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const anamnesisTemplateVersionSchema = z.object({
  schema: anamnesisFormSchema,
  description: z.string().trim().max(600).optional(),
  name: z.string().trim().min(2).max(120).optional(),
});

export const anamnesisTemplateListQuerySchema = z.object({
  includeInactive: booleanQuerySchema,
});

export const anamnesisTemplateListResponseSchema = z.object({
  items: z.array(anamnesisTemplateSchema),
});

// --- Anamnese do cliente ---------------------------------------------

/** Metadados: o que a listagem devolve. As respostas ficam cifradas. */
export const anamnesisSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  templateId: z.string().nullable(),
  templateName: z.string().nullable(),
  templateVersion: z.number().int().nullable(),
  version: z.number().int(),
  status: z.enum(ANAMNESIS_STATUSES),
  /** `false` quando o rascunho esta vazio: nao vale a pena cifrar "{}". */
  hasAnswers: z.boolean(),
  contentHash: z.string().nullable(),
  signedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewedByName: z.string().nullable(),
  reviewNotes: z.string().nullable(),
  createdAt: z.string(),
});

/** Detalhe: inclui as respostas decifradas e o formulario que as pediu. */
export const anamnesisDetailSchema = anamnesisSchema.extend({
  schema: anamnesisFormSchema.nullable(),
  answers: anamnesisAnswersSchema,
});

export const anamnesisListResponseSchema = z.object({
  items: z.array(anamnesisSchema),
});

export const anamnesisCreateSchema = z.object({
  /** Ausente: usa o template da terapia; sem terapia, o padrao da clinica. */
  therapyId: idSchema.optional(),
  templateId: idSchema.optional(),
  answers: anamnesisAnswersSchema.default({}),
  /** `true` cria ja enviada, para o profissional que ja conversa com o cliente. */
  enviar: z.boolean().default(false),
});

/** Salvar rascunho: `answers` substitui o conteudo inteiro, nao faz merge. */
export const anamnesisDraftSchema = z.object({
  answers: anamnesisAnswersSchema,
});

export const anamnesisSubmitSchema = z.object({
  answers: anamnesisAnswersSchema.optional(),
  signed: z.boolean().default(false),
});

export const anamnesisReviewSchema = z.object({
  decision: z.enum(['APROVADA', 'REJEITADA']),
  reviewNotes: z.string().trim().max(1000).optional(),
});

export const anamnesisParamsSchema = z.object({ id: idSchema });
export const anamnesisClientParamsSchema = z.object({ clientId: idSchema });
export const anamnesisTemplateParamsSchema = z.object({ id: idSchema });
export const anamnesisPendingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

// --- Contraindicacoes -------------------------------------------------

export const contraindicationSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  severity: z.enum(ALERT_SEVERITIES),
  requiresMedicalClearance: z.boolean(),
  active: z.boolean(),
  therapyIds: z.array(z.string()),
  createdAt: z.string(),
});

export const contraindicationCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,40}$/, 'Codigo deve ter de 2 a 40 caracteres em maiusculas'),
  title: z.string().trim().min(2, 'Titulo muito curto').max(120),
  description: z.string().trim().max(600).optional(),
  severity: z.enum(ALERT_SEVERITIES).default('MEDIA'),
  requiresMedicalClearance: z.boolean().default(false),
  therapyIds: z.array(idSchema).max(50).default([]),
});

export const contraindicationUpdateSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.union([z.literal(''), z.string().trim().max(600)]).optional(),
  severity: z.enum(ALERT_SEVERITIES).optional(),
  requiresMedicalClearance: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const therapyContraindicationLinkSchema = z.object({
  contraindicationId: idSchema,
  /** Nulo = herda a severidade do catalogo. */
  severity: z.enum(ALERT_SEVERITIES).nullable().optional(),
  requiresMedicalClearance: z.boolean().nullable().optional(),
});

/** Vinculo ja gravado, com o que foi de fato armazenado (heranca ou override). */
export const vinculoContraindicationSchema = z.object({
  id: z.string(),
  therapyId: z.string(),
  contraindicationId: z.string(),
  severity: z.enum(ALERT_SEVERITIES).nullable(),
  requiresMedicalClearance: z.boolean().nullable(),
});

export const vinculoParamsSchema = z.object({
  therapyId: idSchema,
  contraindicationId: idSchema,
});

export const contraindicationListQuerySchema = z.object({
  includeInactive: booleanQuerySchema,
});

export const contraindicationListResponseSchema = z.object({
  items: z.array(contraindicationSchema),
});

export const clientContraindicationSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  contraindicationId: z.string().nullable(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  severity: z.enum(ALERT_SEVERITIES),
  requiresMedicalClearance: z.boolean(),
  source: z.string().nullable(),
  diagnosedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

/**
 * Registro de condicao de saude. O `contraindicationId` e opcional de
 * proposito: a condicao do cliente nem sempre vem do catalogo da clinica
 * ("gestacao de 32 semanas", relato que so o profissional ouviu).
 */
export const clientContraindicationCreateSchema = z
  .object({
    contraindicationId: idSchema.optional(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{2,40}$/, 'Codigo deve ter de 2 a 40 caracteres em maiusculas')
      .optional(),
    title: z.string().trim().min(2, 'Informe o titulo da condicao').max(120),
    description: z.string().trim().max(600).optional(),
    severity: z.enum(ALERT_SEVERITIES).optional(),
    requiresMedicalClearance: z.boolean().optional(),
    source: z.string().trim().max(200).optional(),
    diagnosedAt: z.iso.date().optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((valor) => valor.contraindicationId !== undefined || valor.code !== undefined, {
    path: ['contraindicationId'],
    message: 'Escolha uma contraindicacao do catalogo ou informe um codigo',
  });

export const clientContraindicationResolveSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});

export const clientContraindicationListResponseSchema = z.object({
  items: z.array(clientContraindicationSchema),
});

export const clientContraindicationParamsSchema = z.object({ clientId: idSchema });
export const conditionParamsSchema = z.object({ conditionId: idSchema });

// --- Alertas ----------------------------------------------------------

export const contraindicationAlertSchema = z.object({
  id: z.string(),
  appointmentId: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  therapyName: z.string(),
  professionalName: z.string(),
  startAt: z.string(),
  clientContraindicationId: z.string().nullable(),
  conditionTitle: z.string().nullable(),
  contraindicationId: z.string().nullable(),
  severity: z.enum(ALERT_SEVERITIES),
  message: z.string(),
  decision: z.enum(ALERT_DECISIONS),
  decisionNotes: z.string().nullable(),
  acknowledgedAt: z.string().nullable(),
  acknowledgedByName: z.string().nullable(),
  createdAt: z.string(),
});

/**
 * Decisao do alerta. `PENDENTE` nao entra: registrar "ainda nao decidido"
 * como decisao so criaria ruido na trilha.
 */
export const alertDecisionSchema = z.object({
  decision: z.enum(ALERT_DECISOES_REGISTRADAS),
  decisionNotes: z.string().trim().max(1000).optional(),
});

export const alertListQuerySchema = z.object({
  decision: z.enum(ALERT_DECISIONS).default('PENDENTE'),
  appointmentId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const alertListResponseSchema = z.object({
  items: z.array(contraindicationAlertSchema),
  total: z.number().int(),
});

export const alertDecisionResponseSchema = z.object({
  alert: contraindicationAlertSchema,
});

export const alertParamsSchema = z.object({ id: idSchema });

// --- Prontuario -------------------------------------------------------

export const prontuarioSchema = z.object({
  client: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    birthDate: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  /** Sinalizadores de bloqueio que o painel mostra antes de qualquer sessao. */
  situacao: z.object({
    /** Versao aprovada mais recente, para a proxima sessao. */
    anamneseVigente: z.object({ id: z.string(), version: z.number().int() }).nullable(),
    anamnesePendente: z.number().int(),
    condicoesAtivas: z.number().int(),
    alertasPendentes: z.number().int(),
    sessoesRealizadas: z.number().int(),
  }),
  anamneses: z.array(anamnesisSchema),
  sessoes: z.array(
    z.object({
      id: z.string(),
      startAt: z.string(),
      endAt: z.string(),
      status: z.string(),
      therapyName: z.string(),
      professionalName: z.string(),
      sessionNotes: z.string().nullable(),
      /** Versao da anamnese usada nesta sessao. Null = ainda nao vinculada. */
      anamnesisVersion: z.number().int().nullable(),
    }),
  ),
  condicoes: z.array(clientContraindicationSchema),
  alertas: z.array(contraindicationAlertSchema),
});

export type VinculoContraindication = z.infer<typeof vinculoContraindicationSchema>;

export type Anamnesis = z.infer<typeof anamnesisSchema>;
export type AnamnesisDetail = z.infer<typeof anamnesisDetailSchema>;
export type AnamnesisTemplate = z.infer<typeof anamnesisTemplateSchema>;
export type AnamnesisTemplateCreate = z.infer<typeof anamnesisTemplateCreateSchema>;
export type AnamnesisTemplateUpdate = z.infer<typeof anamnesisTemplateUpdateSchema>;
export type AnamnesisTemplateVersion = z.infer<typeof anamnesisTemplateVersionSchema>;
export type AnamnesisCreate = z.infer<typeof anamnesisCreateSchema>;
export type AnamnesisDraft = z.infer<typeof anamnesisDraftSchema>;
export type AnamnesisSubmit = z.infer<typeof anamnesisSubmitSchema>;
export type AnamnesisReview = z.infer<typeof anamnesisReviewSchema>;
export type Contraindication = z.infer<typeof contraindicationSchema>;
export type ContraindicationCreate = z.infer<typeof contraindicationCreateSchema>;
export type ContraindicationUpdate = z.infer<typeof contraindicationUpdateSchema>;
export type TherapyContraindicationLink = z.infer<typeof therapyContraindicationLinkSchema>;
export type ClientContraindication = z.infer<typeof clientContraindicationSchema>;
export type ClientContraindicationCreate = z.infer<typeof clientContraindicationCreateSchema>;
export type ClientContraindicationResolve = z.infer<typeof clientContraindicationResolveSchema>;
export type ContraindicationAlert = z.infer<typeof contraindicationAlertSchema>;
export type AlertDecisionInput = z.infer<typeof alertDecisionSchema>;
export type Prontuario = z.infer<typeof prontuarioSchema>;

/**
 * Resposta vazia: campo opcional nao preenchido nao e a mesma coisa que
 * "nao". `minLength: 1` impede que o.required passe com string vazia.
 */
function ausente(resposta: unknown): boolean {
  return resposta === undefined || resposta === null || resposta === '';
}

/**
 * Valida as respostas contra o formulario e devolve os problemas em
 * linguagem de tela.
 *
 * Existe porque o formulario e dado -- a clinica escreve o JSON Schema -- e o
 * Zod sozinho so validaria o *formulario*, nao o que o cliente respondeu
 * nele. Sem esta funcao, um campo obrigatorio poderia ser salvo vazio e a
 * revisao nao teria como dizer o que faltou.
 */
export function validarRespostasAnamnesis(
  form: AnamnesisForm,
  respostas: AnamnesisAnswers,
): string[] {
  const problemas: string[] = [];

  for (const chave of Object.keys(respostas)) {
    if (form.properties[chave] === undefined) {
      problemas.push(`Campo "${chave}" nao existe neste formulario.`);
    }
  }

  for (const chave of form.order) {
    const definicao = form.properties[chave];
    if (definicao === undefined) continue;

    const resposta = respostas[chave];

    if (ausente(resposta)) {
      if (form.required.includes(chave)) {
        problemas.push(`"${definicao.title}" e obrigatorio.`);
      }
      continue;
    }

    switch (definicao.type) {
      case 'string': {
        if (typeof resposta !== 'string') {
          problemas.push(`"${definicao.title}" deve ser texto.`);
          break;
        }
        if (definicao.minLength !== undefined && resposta.length < definicao.minLength) {
          problemas.push(
            `"${definicao.title}" precisa de ao menos ${definicao.minLength} caracteres.`,
          );
        }
        if (definicao.maxLength !== undefined && resposta.length > definicao.maxLength) {
          problemas.push(`"${definicao.title}" passa de ${definicao.maxLength} caracteres.`);
        }
        if (definicao.enum !== undefined && !definicao.enum.includes(resposta)) {
          problemas.push(`"${definicao.title}" tem um valor fora das opcoes.`);
        }
        break;
      }
      case 'number':
      case 'integer': {
        if (typeof resposta !== 'number' || !Number.isFinite(resposta)) {
          problemas.push(`"${definicao.title}" deve ser numero.`);
          break;
        }
        if (definicao.type === 'integer' && !Number.isInteger(resposta)) {
          problemas.push(`"${definicao.title}" deve ser numero inteiro.`);
        }
        if (definicao.min !== undefined && resposta < definicao.min) {
          problemas.push(`"${definicao.title}" deve ser no minimo ${definicao.min}.`);
        }
        if (definicao.max !== undefined && resposta > definicao.max) {
          problemas.push(`"${definicao.title}" deve ser no maximo ${definicao.max}.`);
        }
        break;
      }
      case 'boolean': {
        if (typeof resposta !== 'boolean') {
          problemas.push(`"${definicao.title}" deve ser sim ou nao.`);
        }
        break;
      }
      case 'array': {
        if (!Array.isArray(resposta)) {
          problemas.push(`"${definicao.title}" deve ser uma lista.`);
          break;
        }
        if (definicao.min !== undefined && resposta.length < definicao.min) {
          problemas.push(`"${definicao.title}" precisa de ao menos ${definicao.min} opcao(oes).`);
        }
        if (definicao.max !== undefined && resposta.length > definicao.max) {
          problemas.push(`"${definicao.title}" aceita no maximo ${definicao.max} opcao(oes).`);
        }
        if (
          definicao.enum !== undefined &&
          resposta.some((item) => !definicao.enum?.includes(item))
        ) {
          problemas.push(`"${definicao.title}" tem opcao fora da lista.`);
        }
        break;
      }
    }
  }

  return problemas;
}

// --- Convite: anamnese respondida pelo cliente, sem login --------------
//
// O link e a unica credencial. Estas rotas sao publicas de proposito -- nao ha
// sessao para conferir -- entao o contrato e minimo: o token abre o
// formulario, o rascunho guarda o que ja foi preenchido e o envio consome o
// convite.

/**
 * `base64url` de 32 bytes: 43 caracteres. O limite superior existe para o
 * roteamento -- um corpo de 1 MB de "token" nao e um link, e um ataque de
 * corpo grande nao custa caro de barrar na borda.
 */
const tokenConviteSchema = z
  .string()
  .min(40, 'Link de anamnese invalido.')
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Link de anamnese invalido.');

/** Gerado pela clinica para um template especifico deste cliente. */
export const anamnesisInviteCreateSchema = z.object({
  templateId: idSchema,
  /** Padrao: 7 dias. O link e copiado e mandado por WhatsApp, as vezes na vespera. */
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

/**
 * Resposta da criacao do convite. E a **unica** vez que o token em claro
 * aparece: o banco guarda so o SHA-256, entao nao ha como recuperar depois.
 */
export const anamnesisInviteSchema = z.object({
  id: z.string(),
  token: tokenConviteSchema,
  clientId: z.string(),
  templateId: z.string(),
  templateName: z.string(),
  clientName: z.string(),
  expiresAt: z.string(),
  usedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type AnamnesisInvite = z.infer<typeof anamnesisInviteSchema>;

/**
 * Convite na listagem: **sem** `token`.
 *
 * A listagem e para o painel reenviar um link. Como o banco so tem o hash, um
 * link perdido se resolve gerando outro -- e e isso que a tela faz, em vez de
 * fingir que sabe recuperar o antigo.
 */
export const anamnesisInviteListItemSchema = anamnesisInviteSchema.omit({ token: true });

export type AnamnesisInviteListItem = z.infer<typeof anamnesisInviteListItemSchema>;
export type AnamnesisInviteCreate = z.infer<typeof anamnesisInviteCreateSchema>;

export const anamnesisPublicOpenSchema = z.object({ token: tokenConviteSchema });

/**
 * O que o cliente ve ao abrir o link.
 *
 * So o primeiro nome: o formulario e de saude, e quem recebe o link no celular
 * alheio -- familiar, conjuge -- precisa saber para quem esta respondendo sem
 * ler o nome completo, o CPF e o telefone de outra pessoa.
 */
export const anamnesisPublicFormSchema = z.object({
  clinicName: z.string(),
  clientFirstName: z.string(),
  templateName: z.string(),
  templateDescription: z.string().nullable(),
  schema: anamnesisFormSchema,
  answers: anamnesisAnswersSchema,
  submitted: z.boolean().default(false),
  expiresAt: z.string(),
});

export type AnamnesisPublicForm = z.infer<typeof anamnesisPublicFormSchema>;

export const anamnesisPublicSaveSchema = z.object({
  token: tokenConviteSchema,
  answers: anamnesisAnswersSchema,
});

/**
 * Envio pelo link.
 *
 * `answers` ausente reenvia o rascunho salvo, como em `/:id/enviar`: permite
 * "so assinar" sem refazer o formulario inteiro.
 */
export const anamnesisPublicSubmitSchema = z.object({
  token: tokenConviteSchema,
  answers: anamnesisAnswersSchema.optional(),
  signed: z.boolean().optional(),
});

export const anamnesisPublicSubmitResponseSchema = z.object({
  submittedAt: z.string(),
});

export const anamnesisInviteListResponseSchema = z.object({
  items: z.array(anamnesisInviteListItemSchema),
});

export type AnamnesisPublicSubmitResponse = z.infer<typeof anamnesisPublicSubmitResponseSchema>;
