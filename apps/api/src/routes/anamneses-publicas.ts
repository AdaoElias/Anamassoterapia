import {
  anamnesisPublicFormSchema,
  anamnesisPublicOpenSchema,
  anamnesisPublicSaveSchema,
  anamnesisPublicSubmitResponseSchema,
  anamnesisPublicSubmitSchema,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { abrirConvite, enviarConvite, salvarRascunho } from '../lib/anamneses/convite.js';

/**
 * Anamnese respondida pelo cliente, sem login.
 *
 * Registrada em `/public/anamneses`, ao lado do portal de agendamento, e nao
 * em `/anamnesis` porque aqui nao existe sessao para conferir: a unica
 * credencial e o token do link. Isso muda o que cada rota pode fazer e o que
 * ela pode dizer:
 *
 * - Nenhuma rota recebe `clientId`, `clinicId` ou id de anamnese. Se aceitassem,
 *   quem adivinhasse um UUID leria a anamnese de outra pessoa.
 * - Token inexistente, expirado e consumido devolvem a mesma mensagem.
 * - Resposta de erro nao carrega dado de saude: o cliente recebe o que falta
 *   ("Este campo e obrigatorio"), e o profissional ve o conteudo no painel.
 * - Rate limit por IP bem abaixo do global: sao tres chamadas por sessao de
 *   preenchimento, entao o teto global de 300/min nao protege nada aqui.
 *
 * Sem `requireAuth` de proposito: um token valido e a sessao.
 */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

/** Mesmo envelope das demais rotas, para o painel tratar o erro igual. */
const erroValidacaoSchema = erroSchema.extend({
  fields: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
});

export const anamnesisPublicRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.post(
    '/abrir',
    {
      schema: {
        tags: ['public'],
        summary: 'Abre o formulario de anamnese do link',
        description:
          'Cria o rascunho na primeira chamada e devolve as respostas ja salvas, para o cliente retomar de onde parou.',
        body: anamnesisPublicOpenSchema,
        response: {
          200: anamnesisPublicFormSchema,
          404: erroSchema,
          409: erroSchema,
          422: erroValidacaoSchema,
          500: erroSchema,
        },
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      },
    },
    async (request, reply) => {
      const formulario = await abrirConvite(request.body.token);
      return reply.code(200).send({ ...formulario, submitted: false });
    },
  );

  app.post(
    '/rascunho',
    {
      schema: {
        tags: ['public'],
        summary: 'Salva o rascunho do formulario',
        description:
          'Aceita resposta parcial de proposito: e o "salvar e sair". Depois do envio o rascunho volta a ser imutavel.',
        body: anamnesisPublicSaveSchema,
        response: {
          204: z.null(),
          404: erroSchema,
          409: erroSchema,
          422: erroValidacaoSchema,
          500: erroSchema,
        },
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      },
    },
    async (request, reply) => {
      await salvarRascunho(request.body.token, request.body.answers);
      return reply.code(204).send(undefined as unknown as null);
    },
  );

  app.post(
    '/enviar',
    {
      schema: {
        tags: ['public'],
        summary: 'Envia a anamnese do link para revisao da clinica',
        description:
          'Valida as respostas contra o formulario e consome o convite. Sem `answers`, reenvia o rascunho salvo.',
        body: anamnesisPublicSubmitSchema,
        response: {
          200: anamnesisPublicSubmitResponseSchema,
          404: erroSchema,
          409: erroSchema,
          422: erroValidacaoSchema,
        },
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      },
    },
    async (request, reply) => {
      const resultado = await enviarConvite(
        request.body.token,
        request.body.answers,
        request.body.signed ?? false,
      );
      return reply.code(200).send(resultado);
    },
  );

  done();
};
