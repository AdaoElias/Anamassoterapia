import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 nao le mais a connection string do bloco `datasource` do
 * schema.prisma: a URL vem daqui e o schema fica so com o modelo de dados.
 * O mesmo arquivo de ambiente do runtime e lido, com os mesmos caminhos
 * relativos, para que `prisma migrate dev` e a API apontem sempre para o
 * mesmo banco sem duplicar configuracao.
 */
loadDotenv({ path: ['.env', '../../.env'], quiet: true });

const databaseUrl = process.env['DATABASE_URL'];

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL nao definida. Copie .env.example para .env antes de rodar comandos do Prisma.',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // tsx executa o seed direto do TypeScript: um unico runner, sem build previo.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
