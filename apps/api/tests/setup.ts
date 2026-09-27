import { config as loadDotenv } from 'dotenv';

// A suite roda contra massoterapia_test, nunca contra o banco de dev.
loadDotenv({ path: ['../../.env', '.env'], override: true, quiet: true });
process.env.NODE_ENV = 'test';
process.env.TZ = 'America/Sao_Paulo';
