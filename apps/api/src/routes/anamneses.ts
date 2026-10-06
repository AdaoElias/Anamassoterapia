import {
  anamnesisClientParamsSchema,
  anamnesisCreateSchema,
  anamnesisDetailSchema,
  anamnesisDraftSchema,
  anamnesisFormSchema,
  anamnesisInviteCreateSchema,
  anamnesisInviteListResponseSchema,
  anamnesisInviteSchema,
  anamnesisListResponseSchema,
  anamnesisParamsSchema,
  anamnesisPendingQuerySchema,
  anamnesisReviewSchema,
  anamnesisSubmitSchema,
  anamnesisTemplateCreateSchema,
  anamnesisTemplateListQuerySchema,
  anamnesisTemplateListResponseSchema,
  anamnesisTemplateParamsSchema,
  anamnesisTemplateSchema,
  anamnesisTemplateUpdateSchema,
  anamnesisTemplateVersionSchema,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { criarConvite, listarConvites } from '../lib/anamneses/convite.js';
import {
  prepararConteudo,
  proximaVersao,
  resolverTemplate,
  revelar,
} from '../lib/anamneses/servico.js';
import {
  anamnesisListaSelect,
  anamnesisSelect,
  detalheAnamnesis,
  formularioDe,
  type LinhaAnamnesis,
  naoEncontradoAnamnese,
  naoEncontradoCliente,
  respostaAnamnesis,
  respostaTemplate,
  TEMPLATE_SELECT,
} from '../lib/anamneses/visao.js';
import { ErroDominio } from '../lib/dominio-erros.js';
import { prisma } from '../lib/prisma.js';

/**
 * Formularios de anamnese e respostas do cliente.
 *
 * Duas hierarquias nesta rota, e elas nao se misturam:
 *
 * - **Template** (`/templates`) e documento da clinica. Quem responde a
 *   anamnese nao o edita: mudar o formulario cria versao nova, para que as
 *   respostas ja dadas continuem apontando para o formulario que as pediu.
 * - **Anamnese** (o resto) e resposta do cliente, versionada por cliente.
 *   Rascunho pode ser reescrito; enviada, nao. Corrigir e responder de novo.
 *
 * Erros de regra sao `ErroDominio` e o `setErrorHandler` de `app.ts` os
 * traduz. Nenhuma rota aqui faz try/catch so para devolver 422.
 */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

/**
 * Envelope de 422 com a lista de problemas do formulario. So a validacao do
 * Zod (payload cru) tem `fields`; regra de negocio devolve so a mensagem,
 * que ja esta escrita para o cliente final.
 */
const erroValidacaoSchema = erroSchema.extend({
  fields: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .optional()
    .describe('Problemas campo a campo, quando o erro vem da validacao do payload'),
});

async function carregarAnamnese(clinicId: string, id: string): Promise<LinhaAnamnesis | null> {
  return prisma.anamnesis.findFirst({ where: { id, clinicId }, select: anamnesisSelect });
}

export const anamnesisRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  // ------------------------------------------------------------------
  // Formularios (ADMIN gerencia, todos leem)
  // ------------------------------------------------------------------

  app.get(
    '/templates',
    {
      schema: {
        tags: ['records'],
        summary: 'Lista os formularios de anamnese da clinica',
        querystring: anamnesisTemplateListQuerySchema,
        response: { 200: anamnesisTemplateListResponseSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const linhas = await prisma.anamnesisTemplate.findMany({
        where: {
          clinicId: sessao.clinicId,
          ...(request.query.includeInactive ? {} : { isActive: true }),
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { version: 'desc' }],
        select: TEMPLATE_SELECT,
      });

      return reply.code(200).send({ items: linhas.map(respostaTemplate) });
    },
  );

  app.post(
    '/templates',
    {
      schema: {
        tags: ['records'],
        summary: 'Cadastra um formulario de anamnese',
        body: anamnesisTemplateCreateSchema,
        response: {
          201: anamnesisTemplateSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroValidacaoSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const corpo = request.body;
      const form = anamnesisFormSchema.parse(corpo.schema);

      const therapies = await prisma.therapy.findMany({
        where: { id: { in: corpo.therapyIds }, clinicId: sessao.clinicId },
        select: { id: true },
      });
      if (therapies.length !== corpo.therapyIds.length) {
        return reply.code(404).send({
          error: 'THERAPY_NOT_FOUND',
          message: 'Uma das terapias nao existe nesta clinica.',
        });
      }

      const template = await prisma.$transaction(async (tx) => {
        // Um template padrao por clinica: dois padroes fariam a escolha do
        // formulario depender da ordem em que o banco devolveu as linhas.
        if (corpo.isDefault) {
          await tx.anamnesisTemplate.updateMany({
            where: { clinicId: sessao.clinicId, isDefault: true },
            data: { isDefault: false },
          });
        }

        return tx.anamnesisTemplate.create({
          data: {
            clinicId: sessao.clinicId,
            name: corpo.name,
            description: corpo.description ?? null,
            schema: form,
            isDefault: corpo.isDefault,
            therapies: {
              create: therapies.map((terapia) => ({
                clinicId: sessao.clinicId,
                therapyId: terapia.id,
              })),
            },
          },
          select: TEMPLATE_SELECT,
        });
      });

      return reply.code(201).send(respostaTemplate(template));
    },
  );

  app.get(
    '/templates/:id',
    {
      schema: {
        tags: ['records'],
        summary: 'Detalhe de um formulario de anamnese',
        params: anamnesisTemplateParamsSchema,
        response: { 200: anamnesisTemplateSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const template = await prisma.anamnesisTemplate.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        select: TEMPLATE_SELECT,
      });

      if (template === null) {
        return reply
          .code(404)
          .send({ error: 'TEMPLATE_NOT_FOUND', message: 'Formulario nao encontrado.' });
      }

      return reply.code(200).send(respostaTemplate(template));
    },
  );

  app.patch(
    '/templates/:id',
    {
      schema: {
        tags: ['records'],
        summary: 'Atualiza os metadados de um formulario',
        description:
          'So mexe em nome, descricao, padrao e atividade. Alterar o formulario e a versao nova.',
        params: anamnesisTemplateParamsSchema,
        body: anamnesisTemplateUpdateSchema,
        response: {
          200: anamnesisTemplateSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const corpo = request.body;
      const { id } = request.params;

      const template = await prisma.$transaction(async (tx) => {
        const existente = await tx.anamnesisTemplate.findFirst({
          where: { id, clinicId: sessao.clinicId },
          select: { id: true },
        });
        if (existente === null) {
          throw new ErroDominio('TEMPLATE_NOT_FOUND', 404, 'Formulario nao encontrado.');
        }

        if (corpo.isDefault === true) {
          await tx.anamnesisTemplate.updateMany({
            where: { clinicId: sessao.clinicId, isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }

        const { count } = await tx.anamnesisTemplate.updateMany({
          where: { id, clinicId: sessao.clinicId },
          data: {
            name: corpo.name,
            description: corpo.description,
            isDefault: corpo.isDefault,
            isActive: corpo.isActive,
          },
        });

        if (count === 0) {
          throw new ErroDominio('TEMPLATE_NOT_FOUND', 404, 'Formulario nao encontrado.');
        }

        return tx.anamnesisTemplate.findUniqueOrThrow({ where: { id }, select: TEMPLATE_SELECT });
      });

      return reply.code(200).send(respostaTemplate(template));
    },
  );

  app.post(
    '/templates/:id/versao',
    {
      schema: {
        tags: ['records'],
        summary: 'Cria uma versao nova do formulario',
        description:
          'A versao antiga sai de atividade e continua no banco: e ela que as respostas ja dadas apontam. ' +
          'As vinculos com terapias sao copiados. Renomear cria a nova versao com outro nome, e as antigas ' +
          'ficam com o nome anterior.',
        params: anamnesisTemplateParamsSchema,
        body: anamnesisTemplateVersionSchema,
        response: {
          201: anamnesisTemplateSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroValidacaoSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const corpo = request.body;
      const form = anamnesisFormSchema.parse(corpo.schema);

      const nova = await prisma.$transaction(async (tx) => {
        const atual = await tx.anamnesisTemplate.findFirst({
          where: { id: request.params.id, clinicId: sessao.clinicId },
          select: TEMPLATE_SELECT,
        });
        if (atual === null) {
          throw new ErroDominio('TEMPLATE_NOT_FOUND', 404, 'Formulario nao encontrado.');
        }

        const ultima = await tx.anamnesisTemplate.findFirst({
          where: { clinicId: sessao.clinicId, name: atual.name },
          orderBy: { version: 'desc' },
          select: { version: true },
        });

        const criada = await tx.anamnesisTemplate.create({
          data: {
            clinicId: sessao.clinicId,
            name: corpo.name ?? atual.name,
            description: corpo.description ?? atual.description,
            version: (ultima?.version ?? atual.version) + 1,
            schema: form,
            isDefault: atual.isDefault,
            therapies: {
              create: atual.therapies.map((vinculo) => ({
                clinicId: sessao.clinicId,
                therapyId: vinculo.therapyId,
              })),
            },
          },
          select: TEMPLATE_SELECT,
        });

        // So desativa as versoes do **mesmo nome**: renomear e criar versao
        // nao pode apagar de atividade o formulario antigo, que ainda e o
        // nome que a clinica reconhece.
        await tx.anamnesisTemplate.updateMany({
          where: {
            clinicId: sessao.clinicId,
            name: atual.name,
            id: { not: criada.id },
          },
          data: { isActive: false, isDefault: false },
        });

        return criada;
      });

      return reply.code(201).send(respostaTemplate(nova));
    },
  );

  // ------------------------------------------------------------------
  // Anamneses do cliente (todos autenticados: sao dado de saude do cliente)
  // ------------------------------------------------------------------

  app.get(
    '/pendentes',
    {
      schema: {
        tags: ['records'],
        summary: 'Anamneses aguardando revisao',
        description: 'Mais antiga primeiro: a que espera ha semanas e a primeira a ser respondida.',
        querystring: anamnesisPendingQuerySchema,
        response: { 200: anamnesisListResponseSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const { limit, offset } = request.query;

      const linhas = await prisma.anamnesis.findMany({
        where: { clinicId: sessao.clinicId, status: 'ENVIADA' },
        orderBy: { submittedAt: 'asc' },
        take: limit,
        skip: offset,
        select: anamnesisListaSelect,
      });

      return reply.code(200).send({ items: linhas.map(respostaAnamnesis) });
    },
  );

  app.get(
    '/clientes/:clientId',
    {
      schema: {
        tags: ['records'],
        summary: 'Historico de anamneses de um cliente',
        params: anamnesisClientParamsSchema,
        response: { 200: anamnesisListResponseSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const cliente = await prisma.client.findFirst({
        where: { id: request.params.clientId, clinicId: sessao.clinicId },
        select: { id: true },
      });
      if (cliente === null) {
        return reply.code(404).send(naoEncontradoCliente());
      }

      const linhas = await prisma.anamnesis.findMany({
        where: { clinicId: sessao.clinicId, clientId: cliente.id },
        orderBy: { version: 'desc' },
        select: anamnesisListaSelect,
      });

      return reply.code(200).send({ items: linhas.map(respostaAnamnesis) });
    },
  );

  // ------------------------------------------------------------------
  // Link para o cliente responder sem login
  // ------------------------------------------------------------------

  app.get(
    '/clientes/:clientId/convites',
    {
      schema: {
        tags: ['records'],
        summary: 'Lista os links de anamnese gerados para o cliente',
        description:
          'Sem o token: o banco guarda apenas o SHA-256 dele. Link perdido se resolve gerando outro.',
        params: anamnesisClientParamsSchema,
        response: { 200: anamnesisInviteListResponseSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const cliente = await prisma.client.findFirst({
        where: { id: request.params.clientId, clinicId: sessao.clinicId },
        select: { id: true },
      });
      if (cliente === null) {
        return reply.code(404).send(naoEncontradoCliente());
      }

      return reply.code(200).send({ items: await listarConvites(cliente.id, sessao.clinicId) });
    },
  );

  app.post(
    '/clientes/:clientId/convites',
    {
      schema: {
        tags: ['records'],
        summary: 'Gera um link para o cliente responder a anamnese',
        description:
          'O token volta em claro so nesta resposta. Copie e envie pelo canal que a clinica usa com o cliente.',
        params: anamnesisClientParamsSchema,
        body: anamnesisInviteCreateSchema,
        response: {
          201: anamnesisInviteSchema,
          401: erroSchema,
          404: erroSchema,
          422: erroValidacaoSchema,
        },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const convite = await criarConvite(
        sessao.clinicId,
        request.params.clientId,
        request.body.templateId,
        sessao.userId,
        request.body.expiresInDays,
      );

      return reply.code(201).send(convite);
    },
  );

  app.post(
    '/clientes/:clientId',
    {
      schema: {
        tags: ['records'],
        summary: 'Registra uma nova versao de anamnese do cliente',
        description:
          'Cada chamada cria uma versao. Nao ha edicao de resposta: para corrigir, responde de novo.',
        params: anamnesisClientParamsSchema,
        body: anamnesisCreateSchema,
        response: {
          201: anamnesisDetailSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroValidacaoSchema,
        },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const corpo = request.body;

      const cliente = await prisma.client.findFirst({
        where: { id: request.params.clientId, clinicId: sessao.clinicId },
        select: { id: true },
      });
      if (cliente === null) {
        return reply.code(404).send(naoEncontradoCliente());
      }

      if (corpo.therapyId !== undefined) {
        const terapia = await prisma.therapy.findFirst({
          where: { id: corpo.therapyId, clinicId: sessao.clinicId },
          select: { id: true },
        });
        if (terapia === null) {
          return reply
            .code(404)
            .send({ error: 'THERAPY_NOT_FOUND', message: 'Terapia nao encontrada nesta clinica.' });
        }
      }

      const template = await resolverTemplate(sessao.clinicId, {
        ...(corpo.therapyId === undefined ? {} : { therapyId: corpo.therapyId }),
        ...(corpo.templateId === undefined ? {} : { templateId: corpo.templateId }),
      });

      const conteudo = prepararConteudo(
        anamnesisFormSchema.parse(template.schema),
        template.id,
        corpo.answers,
      );

      if (corpo.enviar && conteudo === null) {
        throw new ErroDominio(
          'ANAMNESIS_EMPTY',
          422,
          'Preencha a anamnese antes de enviar para revisao.',
        );
      }

      const linha = await prisma.$transaction(async (tx) => {
        // A versao e calculada na mesma transacao da escrita: ler fora correria
        // o risco de duas respostas simultaneas nascerem com o mesmo numero.
        // O banco barra o empate, mas o cliente veria 409 sem motivo.
        const version = await proximaVersao(tx, sessao.clinicId, cliente.id);

        return tx.anamnesis.create({
          data: {
            clinicId: sessao.clinicId,
            clientId: cliente.id,
            templateId: template.id,
            version,
            status: corpo.enviar ? 'ENVIADA' : 'RASCUNHO',
            answersEncrypted: conteudo?.answersEncrypted ?? null,
            contentHash: conteudo?.contentHash ?? null,
            submittedAt: corpo.enviar ? new Date() : null,
          },
          select: anamnesisSelect,
        });
      });

      return reply.code(201).send(detalheAnamnesis(linha));
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['records'],
        summary: 'Detalhe de uma anamnese, com as respostas decifradas',
        params: anamnesisParamsSchema,
        response: { 200: anamnesisDetailSchema, 401: erroSchema, 404: erroSchema, 500: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const linha = await carregarAnamnese(sessao.clinicId, request.params.id);
      if (linha === null) {
        return reply.code(404).send(naoEncontradoAnamnese());
      }

      return reply.code(200).send(detalheAnamnesis(linha));
    },
  );

  app.put(
    '/:id/rascunho',
    {
      schema: {
        tags: ['records'],
        summary: 'Salva o rascunho da anamnese',
        description:
          'Substitui o conteudo inteiro do rascunho. So enquanto o status for RASCUNHO; ' +
          'depois de enviada, a resposta e imutavel.',
        params: anamnesisParamsSchema,
        body: anamnesisDraftSchema,
        response: {
          200: anamnesisDetailSchema,
          401: erroSchema,
          404: erroSchema,
          409: erroSchema,
          422: erroValidacaoSchema,
        },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const linha = await carregarAnamnese(sessao.clinicId, request.params.id);
      if (linha === null) {
        return reply.code(404).send(naoEncontradoAnamnese());
      }

      if (linha.status !== 'RASCUNHO') {
        return reply.code(409).send({
          error: 'ANAMNESIS_IMMUTABLE',
          message: 'Esta anamnese ja foi enviada. Registre uma nova versao para corrigir.',
        });
      }

      const conteudo = prepararConteudo(
        formularioDe(linha),
        linha.template?.id ?? '',
        request.body.answers,
      );

      const { count } = await prisma.anamnesis.updateMany({
        where: { id: linha.id, clinicId: sessao.clinicId, status: 'RASCUNHO' },
        data: {
          answersEncrypted: conteudo?.answersEncrypted ?? null,
          contentHash: conteudo?.contentHash ?? null,
        },
      });

      // O status no `where` e o que fecha a corrida com `POST /:id/enviar`:
      // quem perder o filtro nao sobrescreve conteudo ja enviado.
      if (count === 0) {
        throw new ErroDominio(
          'ANAMNESIS_IMMUTABLE',
          409,
          'Esta anamnese ja foi enviada. Registre uma nova versao para corrigir.',
        );
      }

      const atualizada = await prisma.anamnesis.findUniqueOrThrow({
        where: { id: linha.id },
        select: anamnesisSelect,
      });

      return reply.code(200).send(detalheAnamnesis(atualizada));
    },
  );

  app.post(
    '/:id/enviar',
    {
      schema: {
        tags: ['records'],
        summary: 'Envia a anamnese para revisao',
        description:
          'Valida as respostas contra o formulario. A partir daqui o conteudo nao volta atras.',
        params: anamnesisParamsSchema,
        body: anamnesisSubmitSchema,
        response: {
          200: anamnesisDetailSchema,
          401: erroSchema,
          404: erroSchema,
          409: erroSchema,
          422: erroValidacaoSchema,
        },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const linha = await carregarAnamnese(sessao.clinicId, request.params.id);
      if (linha === null) {
        return reply.code(404).send(naoEncontradoAnamnese());
      }

      if (linha.status !== 'RASCUNHO') {
        return reply
          .code(409)
          .send({ error: 'ANAMNESIS_ALREADY_SENT', message: 'Esta anamnese ja foi enviada.' });
      }

      // `answers` ausente reenvia o que ja estava no rascunho; e o que
      // permite "so assinar" sem reenviar o formulario inteiro.
      const respostas = request.body.answers ?? revelar(linha).answers;
      const conteudo = prepararConteudo(formularioDe(linha), linha.template?.id ?? '', respostas);

      if (conteudo === null) {
        throw new ErroDominio(
          'ANAMNESIS_EMPTY',
          422,
          'Preencha a anamnese antes de enviar para revisao.',
        );
      }

      const agora = new Date();
      const { count } = await prisma.anamnesis.updateMany({
        where: { id: linha.id, clinicId: sessao.clinicId, status: 'RASCUNHO' },
        data: {
          status: 'ENVIADA',
          answersEncrypted: conteudo.answersEncrypted,
          contentHash: conteudo.contentHash,
          submittedAt: agora,
          signedAt: request.body.signed ? agora : linha.signedAt,
        },
      });

      if (count === 0) {
        throw new ErroDominio('ANAMNESIS_ALREADY_SENT', 409, 'Esta anamnese ja foi enviada.');
      }

      const enviada = await prisma.anamnesis.findUniqueOrThrow({
        where: { id: linha.id },
        select: anamnesisSelect,
      });

      return reply.code(200).send(detalheAnamnesis(enviada));
    },
  );

  app.post(
    '/:id/revisar',
    {
      schema: {
        tags: ['records'],
        summary: 'Aprova ou rejeita a anamnese enviada',
        description: 'Aprovada vira a versao vigente do cliente: e a que a proxima sessao usa.',
        params: anamnesisParamsSchema,
        body: anamnesisReviewSchema,
        response: { 200: anamnesisDetailSchema, 401: erroSchema, 404: erroSchema, 409: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });
      }

      const linha = await carregarAnamnese(sessao.clinicId, request.params.id);
      if (linha === null) {
        return reply.code(404).send(naoEncontradoAnamnese());
      }

      if (linha.status !== 'ENVIADA') {
        return reply.code(409).send({
          error: 'ANAMNESIS_NOT_PENDING_REVIEW',
          message: 'Somente anamnese enviada aguarda revisao.',
        });
      }

      const { count } = await prisma.anamnesis.updateMany({
        where: { id: linha.id, clinicId: sessao.clinicId, status: 'ENVIADA' },
        data: {
          status: request.body.decision,
          reviewedAt: new Date(),
          reviewedByUserId: sessao.userId,
          reviewNotes: request.body.reviewNotes ?? null,
        },
      });

      if (count === 0) {
        throw new ErroDominio(
          'ANAMNESIS_NOT_PENDING_REVIEW',
          409,
          'Somente anamnese enviada aguarda revisao.',
        );
      }

      const revisada = await prisma.anamnesis.findUniqueOrThrow({
        where: { id: linha.id },
        select: anamnesisSelect,
      });

      return reply.code(200).send(detalheAnamnesis(revisada));
    },
  );

  done();
};
