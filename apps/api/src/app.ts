import { existsSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
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
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { env } from './config/env.js';
import { ehErroDominio } from './lib/dominio-erros.js';
import { pararFila } from './lib/notificacoes/fila.js';
import { registrarAutenticacao } from './plugins/auth.js';
import { anamnesisRoutes } from './routes/anamneses.js';
import { anamnesisPublicRoutes } from './routes/anamneses-publicas.js';
import { appointmentRoutes } from './routes/appointments.js';
import { authRoutes } from './routes/auth.js';
import { availabilityRoutes } from './routes/availability.js';
import { clientRoutes } from './routes/clients.js';
import { clinicRoutes } from './routes/clinics.js';
import { contraindicationRoutes } from './routes/contraindications.js';
import { financeiroRoutes } from './routes/financeiro.js';
import { healthRoutes } from './routes/health.js';
import { notificationRoutes } from './routes/notifications.js';
import { portalRoutes } from './routes/portal.js';
import { professionalRoutes } from './routes/professionals.js';
import { prontuarioRoutes } from './routes/prontuario.js';
import { type ReadyProbe, readyRoutes } from './routes/ready.js';
import { therapyRoutes } from './routes/therapies.js';
import { userRoutes } from './routes/users.js';

/** Tipo da app: a partir do schema Zod, request/reply/body sao tipados. */
export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export interface BuildAppOptions {
  /**
   * Substitui o probe de prontidao. Existe para exercitar o caminho de
   * falha: derrubar o Postgres de verdade em teste seria lento e nao
   * deterministico, e o que se quer verificar aqui e a resposta HTTP, nao
   * a queda do servidor.
   */
  readyProbe?: ReadyProbe;

  /**
   * Substitui a verificacao de senha argon2. Sem isso cada caso de teste de
   * login paga 19MiB de memoria e ~80ms de CPU; com isso, o teste mede a
   * rota e nao o KDF.
   */
  verificarSenha?: (hashGuardado: string, senha: string) => Promise<boolean>;
}

/**
 * Monta a aplicacao sem abrir a porta. `index.ts` chama listen,
 * os testes usam `app.inject()`. Essa separacao e o que torna a
 * suite rapida e sem dependencia de rede.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<App> {
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

  // Em producao a API tambem serve o SPA: web e API na mesma origem (sem
  // CORS e com cookie same-site, no mesmo dominio). O build do Vite fica em
  // apps/web/dist; `WEB_DIST_DIR` permite fixar outro caminho (no container o
  // dist e copiado para um diretorio conhecido). Em dev/test o Vite serve o
  // SPA e isto fica desligado.
  const webDistDir = env.WEB_DIST_DIR
    ? resolve(env.WEB_DIST_DIR)
    : fileURLToPath(new URL('../../web/dist', import.meta.url));
  const servirSpa = env.isProduction && existsSync(resolve(webDistDir, 'index.html'));

  // `setErrorHandler` e `setNotFoundHandler` precisam vir **antes** do
  // registro das rotas. Em `route.js`, o RouteContext copia
  // `server[kErrorHandler]` no instante em que a rota e definida
  // (`context.errorHandler = ... this[kErrorHandler]`); definido depois, o
  // handler existe mas nenhuma rota enxerga. O efeito era silencioso e
  // enganoso: o handler parecia configurado, e so aparecia em stack trace.
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // **Nao** se usa `hasZodFastifySchemaValidationErrors` da
    // fastify-type-provider-zod aqui. Aquele guard procura um simbolo que a
    // lib coloca em cada issue do Zod, mas o `defaultSchemaErrorFormatter` do
    // Fastify reconstroi o array `validation` e perde o simbolo. Resultado: o
    // guard responde `false` para todo erro de validacao, e o 422 nunca sai --
    // qualquer payload invalido voltava 400 com o texto cru do Zod. A
    // verificacao e no `validation` preenchido, que e o contrato do Fastify e
    // nao depende de detalhe de implementacao de third party.
    const validation = (error as { validation?: unknown }).validation;

    if (Array.isArray(validation) && validation.length > 0) {
      request.log.warn({ err: error }, 'payload invalido');
      return reply.code(422).send({
        error: 'VALIDATION_ERROR',
        message: 'Dados invalidos. Revise os campos destacados.',
        fields: (validation as Array<{ instancePath?: string; message?: string }>).map((issue) => ({
          field: (issue.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.'),
          message: issue.message ?? 'Valor invalido',
        })),
        requestId: request.id,
      });
    }

    // Erro de dominio tem status e codigo ja decididos pelo servico (por
    // exemplo "a clinica nao cadastrou formulario de anamnese"). Traduzido
    // aqui para que nenhuma rota precise de try/catch so para devolver 422.
    if (ehErroDominio(error)) {
      request.log.warn({ codigo: error.codigo, status: error.status }, 'regra de dominio');
      return reply.code(error.status).send({
        error: error.codigo,
        message: error.message,
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

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const caminho = (request.raw.url ?? '').split('?')[0] ?? '';
    const rotaDeInfra =
      caminho === '/health' ||
      caminho.startsWith('/health/') ||
      caminho.startsWith('/docs') ||
      (env.apiPrefix !== '' &&
        (caminho === env.apiPrefix || caminho.startsWith(`${env.apiPrefix}/`)));

    // SPA: navegacao do cliente (rota do react-router) que nao casou com
    // arquivo estatico nem com a API devolve o index.html, e o react-router
    // resolve a tela. Sem isso, um F5 em /clientes daria 404.
    if (servirSpa && request.method === 'GET' && !rotaDeInfra) {
      return reply.type('text/html').sendFile('index.html');
    }

    reply.code(404).send({
      error: 'NOT_FOUND',
      message: `Rota ${request.method} ${request.url} nao encontrada`,
    });
  });

  // Antes das rotas: `authRoutes` usa `definirCookieRefresh` e
  // `requireAuth` como `preHandler` no momento do registro, e as rotas
  // protegidas das proximas etapas vao precisar dos dois.
  registrarAutenticacao(app);

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
        { name: 'clinic', description: 'Perfil da clinica e salas' },
        { name: 'users', description: 'Usuarios e papeis da clinica' },
        { name: 'professionals', description: 'Cadastro de profissionais e terapias' },
        { name: 'clients', description: 'Cadastro de clientes' },
        { name: 'therapies', description: 'Cardapio de terapias' },
        { name: 'booking', description: 'Disponibilidade e agendamento' },
        { name: 'notifications', description: 'Painel de avisos enviados ao cliente' },
        { name: 'public', description: 'Portal publico de agendamento do cliente' },
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
  // Filho de /health, registrado separado porque leva dependencia externa
  // (o banco) enquanto o liveness acima e livre de dependencia.
  await app.register(readyRoutes, {
    prefix: '/health/ready',
    ...(options.readyProbe === undefined ? {} : { probe: options.readyProbe }),
  });

  // Toda a API de negocio vive sob `env.apiPrefix`: /api em producao (mesma
  // origem do SPA) e vazio em dev/test (o proxy do Vite ja remove o /api). O
  // contexto filho prefixa tudo de uma vez sem tocar em cada arquivo de rota
  // nem no caminho que os testes injetam.
  await app.register(
    async (api) => {
      await api.register(authRoutes, {
        prefix: '/auth',
        ...(options.verificarSenha === undefined ? {} : { verificarSenha: options.verificarSenha }),
      });
      await api.register(clinicRoutes, { prefix: '/clinics' });
      await api.register(userRoutes, { prefix: '/users' });
      await api.register(therapyRoutes, { prefix: '/therapies' });
      await api.register(professionalRoutes, { prefix: '/professionals' });
      await api.register(clientRoutes, { prefix: '/clients' });
      await api.register(availabilityRoutes, { prefix: '/availability' });
      await api.register(appointmentRoutes, { prefix: '/appointments' });
      await api.register(notificationRoutes, { prefix: '/notifications' });
      await api.register(anamnesisRoutes, { prefix: '/anamnesis' });
      await api.register(anamnesisPublicRoutes, { prefix: '/public/anamneses' });
      await api.register(contraindicationRoutes, { prefix: '/contraindications' });
      await api.register(prontuarioRoutes, { prefix: '/prontuarios' });
      await api.register(financeiroRoutes, { prefix: '/finance' });
      // Publico, sem `requireAuth`. O slug do link e o unico seletor de tenant.
      await api.register(portalRoutes, { prefix: '/public' });
    },
    env.apiPrefix === '' ? {} : { prefix: env.apiPrefix },
  );

  if (servirSpa) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      index: ['index.html'],
      // O index.html nunca pode ser cacheado (o browser ficaria preso numa
      // versao antiga do app); os assets sob /assets tem hash no nome, entao
      // sao imutaveis e podem ser cacheados por um ano.
      setHeaders: (reply, filePath) => {
        if (basename(filePath) === 'index.html') {
          reply.header('Cache-Control', 'no-cache');
          return;
        }
        if (filePath.includes(`${sep}assets${sep}`)) {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable');
          return;
        }
        reply.header('Cache-Control', 'public, max-age=3600');
      },
    });
  }

  // Contrapartida do `iniciarFila` de `index.ts`: o worker fecha junto com o
  // servidor, antes do processo morrer. Nos testes isso e no-op, porque a
  // fila nunca sobe dentro de `buildApp()`.
  app.addHook('onClose', async () => {
    await pararFila();
  });

  return app;
}
