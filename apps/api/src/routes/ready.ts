import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';

/**
 * `/health` responde "o processo esta vivo".
 * `/health/ready` responde "o processo consegue atender".
 *
 * A distincao importa no deploy: um liveness que depende do banco mata o
 * container quando o Postgres reinicia, e o orquestrador passa a reiniciar
 * a aplicacao -- que nao tem culpa nenhuma -- num loop. O liveness fica
 * livre de dependencia; so o readiness consulta o banco.
 */

export type ReadyProbe = () => Promise<{ databaseVersion: string }>;

/** Tempo maximo de espera. Acima disso a resposta e "nao pronto". */
const PROBE_TIMEOUT_MS = 3_000;

async function defaultProbe(): Promise<{ databaseVersion: string }> {
  // String literal, sem interpolacao: `$queryRawUnsafe` e seguro aqui.
  // Nao ha valor vindo de request para concatenar.
  const rows = await prisma.$queryRawUnsafe<{ version: string }[]>(
    "SELECT current_setting('server_version') AS version",
  );
  const version = rows[0]?.version;
  if (!version) {
    throw new Error('Resposta do banco sem versao do servidor');
  }
  return { databaseVersion: version };
}

/**
 * O pool do Postgres pode esperar 10s por conexao (config em
 * `src/lib/prisma.ts`). Um probe de prontidao que espera 10s nao serve
 * para nada: o load balancer ja desistiu. Corta em 3s.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout de ${ms}ms ao consultar o banco`));
    }, ms);
    // `unref` impede que o timer alone segure o processo aberto.
    timer.unref();

    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
    });
  });
}

const readyResponseSchema = z.object({
  status: z.literal('ready'),
  database: z.literal('up'),
  databaseVersion: z.string(),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
});

const notReadyResponseSchema = z.object({
  status: z.literal('unavailable'),
  database: z.literal('down'),
  // Mensagem generica de proposito: a string do erro do driver carrega
  // host, porta e usuario do banco. Isso vaza para quem chamou o probe.
  message: z.string(),
  timestamp: z.string(),
});

export interface ReadyOptions {
  /** Injetavel para testar o caminho de falha sem derrubar o banco. */
  probe?: ReadyProbe;
}

const readyRoutes: FastifyPluginCallbackZod<ReadyOptions> = (app, options, done) => {
  const probe = options.probe ?? defaultProbe;

  app.get(
    '/',
    {
      schema: {
        tags: ['health'],
        summary: 'Verificacao de prontidao, incluindo o banco de dados',
        description:
          'Retorna 503 quando o banco nao responde. Use para readiness probe; ' +
          'use /health para liveness.',
        response: { 200: readyResponseSchema, 503: notReadyResponseSchema },
      },
    },
    async (_request, reply) => {
      const timestamp = new Date().toISOString();

      try {
        const { databaseVersion } = await withTimeout(probe(), PROBE_TIMEOUT_MS);
        return reply.code(200).send({
          status: 'ready',
          database: 'up',
          databaseVersion,
          uptimeSeconds: Math.round(process.uptime()),
          timestamp,
        });
      } catch (error) {
        app.log.error({ err: error }, 'readiness: banco indisponivel');
        return reply.code(503).send({
          status: 'unavailable',
          database: 'down',
          message: 'Banco de dados indisponivel',
          timestamp,
        });
      }
    },
  );

  done();
};

export { readyRoutes };
