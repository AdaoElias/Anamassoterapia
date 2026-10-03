import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Prisma 7 nao abre conexao sozinho: a `datasource.url` do schema sumiu e
 * a responsabilidade de conectar passou para um driver adapter. Isso e
 * bom -- a aplicacao controla o pool, e nao o contrario.
 *
 * O `pg.Pool` e criado aqui explicitamente em vez de deixar o adaptador
 * criar um interno, porque o shutdown precisa fechar o pool. Sem isso o
 * processo segura conexao aberta e o `migrate reset` trava esperando.
 *
 * Os parametros sao de clinica pequena, nao de microservico: 10 conexoes
 * cobrem a agenda de uma unidade com folga, e uma pool maior so troca
 * limite de conexao do Postgres por latencia em horacao de pico.
 */
function createPool(connectionString: string): Pool {
  const url = new URL(connectionString);

  return new Pool({
    connectionString,
    max: env.isTest ? 2 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Identifica a conexao no pg_stat_activity. Sem isso, "idle" na tela
    // do Postgres nao diz de onde veio.
    application_name: env.isTest ? 'massoterapia_test' : 'massoterapia_api',
    ssl: url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? false : undefined,
  });
}

export function createPrismaClient(connectionString: string = env.DATABASE_URL): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(createPool(connectionString)),
    log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });
}

/**
 * Singleton.
 *
 * O `globalThis` existe para o `tsx watch` nao abrir um pool novo a cada
 * recompilacao: o processo recarrega o modulo, mas o Postgres continua
 * com as conexoes antigas ate esgotar o max.
 */
const globalForPrisma = globalThis as unknown as { massoterapiaPrisma?: PrismaClient };

export const prisma = globalForPrisma.massoterapiaPrisma ?? createPrismaClient();

if (env.isDevelopment || env.isTest) {
  globalForPrisma.massoterapiaPrisma = prisma;
}

/**
 * Prisma 7 tambem exige `$disconnect` explicito: o adapter nao da
 * `close()` no exit. Sem este helper o `onClose` do Fastify fica
 * diferente em dev e em producao, e o teste trava.
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export type { PrismaClient };
