import { config as loadDotenv } from 'dotenv';

/**
 * Bootstrap da suite.
 *
 * O ponto que nao pode ser negociavel: a suite roda contra
 * `TEST_DATABASE_URL`, nunca contra `DATABASE_URL`. Sem essa troca, um
 * teste que grava no banco escreve no banco de trabalho -- e o registro
 * fantasma aparece semanas depois, quando ninguem lembra de onde veio.
 * Pior: o seed compartilha o mesmo banco de dev, entao o estrago sobrevive
 * a um `migrate reset` e sobrevive a um backup ruim.
 *
 * As duas verificacoes abaixo sao deliberadamente fatais. Falhar na
 * inicializacao e o unico momento em que o engano ainda e barato.
 */
loadDotenv({ path: ['../../.env', '.env'], override: true, quiet: true });
process.env['NODE_ENV'] = 'test';
process.env['TZ'] = 'America/Sao_Paulo';

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL nao definida. Sem um banco de teste proprio a suite ' +
      'pode escrever em massoterapia_dev. Copie .env.example para .env.',
  );
}

const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');

if (!/(^|_)test$/.test(databaseName)) {
  throw new Error(
    `TEST_DATABASE_URL precisa apontar para um banco de teste (sufixo "_test"). ` +
      `Recebido: "${databaseName}".`,
  );
}

// Depois de trocar, `env.ts` (que carrega o .env sem override) nao sobrescreve.
process.env['DATABASE_URL'] = testDatabaseUrl;
