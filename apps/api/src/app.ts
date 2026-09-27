import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import fastifySwagger from '@fastify/swagger';
import type {
  FastifyBaseLogger,
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { env } from './config/env.js';
import { healthRoutes } from './routes/health.js';

/** Tipo da app: a partir do schema Zod, request/reply/body sao tipados. */
export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;

/**
 * Monta a aplicacao sem abrir a porta. `index.ts` chama listen,
 * os testes usam `app.inject()`. Essa separacao e o que torna a
 * suite rapida e sem dependencia de rede.
 */
export async function buildApp(): Promise<App> {
  const app = fastify({
    logger: {
      level: env.isProduction ? 'info' : 'debug',
      // Reduz ruido: nunca logar corpo de requisicao (contem dado de saude).
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'password',
          '*.password',
          '*.passwordHash',
          '*.cpf',
          '*.healthEncrypted',
        ],
        censor: '[REDACTED]',
      },
      transport: env.isProduction
        ? undefined
        : {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,reqId' },
          },
    },
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MiB
    requestIdHeader: 'x-request-id',
  }).withTypeProvider<ZodTypeProvider>();

  // Validacao e serializacao derivadas dos mesmos schemas Zod: o contrato
  // documentado e o comportamento real nao tem como divergir.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(fastifyCors, {
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(fastifyCookie);

  await app.register(fastifySensible);

  await app.register(fastifyRateLimit, {
    max: env.isTest ? 10_000 : 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  await app.register(fastifySwagger, {
    // Deriva o OpenAPI dos schemas Zod das rotas.
    transform: jsonSchemaTransform,
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Massoterapia API',
        version: '0.1.0',
        description:
          'API de gestao e agendamento para clinicas de massoterapia. ' +
          'A documentacao e gerada a partir dos mesmos schemas Zod usados na validacao.',
      },
      servers: [{ url: env.API_PUBLIC_URL, description: 'Servidor local' }],
      tags: [
        { name: 'health', description: 'Verificacao de saude e disponibilidade' },
        { name: 'auth', description: 'Autenticacao e refresh de token' },
        { name: 'professionals', description: 'Cadastro de profissionais e terapias' },
        { name: 'clients', description: 'Cadastro de clientes' },
        { name: 'therapies', description: 'Cardapio de terapias' },
        { name: 'booking', description: 'Disponibilidade e agendamento' },
        { name: 'records', description: 'Anamnese e prontuario' },
        { name: 'finance', description: 'Recebimentos, pacotes e relatorios' },
      ],
    },
  });

  if (!env.isProduction) {
    const fastifySwaggerUi = await import('@fastify/swagger-ui');
    await app.register(fastifySwaggerUi.default, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
    });
  }

  await app.register(healthRoutes, { prefix: '/health' });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply.code(404).send({
      error: 'NOT_FOUND',
      message: `Rota ${request.method} ${request.url} nao encontrada`,
    });
  });

  // Rotas com limite mais apertado (login, recuperacao de senha, refresh)
  // sobrescrevem via `config: { rateLimit: { max, timeWindow } }` na rota.
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      request.log.warn({ err: error }, 'payload invalido');
      return reply.code(422).send({
        error: 'VALIDATION_ERROR',
        message: 'Dados invalidos. Revise os campos destacados.',
        fields: error.validation.map((issue) => ({
          field: issue.instancePath.replace(/^\//, '').replace(/\//g, '.'),
          message: issue.message ?? 'Valor invalido',
        })),
        requestId: request.id,
      });
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'erro nao tratado');
    } else {
      request.log.warn({ err: error, statusCode }, 'erro tratado');
    }

    return reply.code(statusCode).send({
      error: error.name || 'INTERNAL_ERROR',
      // Mensagem de 500 nunca vaza detalhe interno para o cliente.
      message: statusCode >= 500 ? 'Erro interno. Tente novamente.' : error.message,
      requestId: request.id,
    });
  });

  return app;
}
