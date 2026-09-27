import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Le .env uma unica vez, no bootstrap do processo.
 * Em producao as variaveis vem do ambiente (VPS, container, servico) e
 * nao ha arquivo .env -- por isso o caminho e relativo e opcional.
 */
loadDotenv({ path: ['.env', '../../.env'], quiet: true });

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria'),
    TEST_DATABASE_URL: z.string().optional(),

    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
    API_PUBLIC_URL: z.url().default('http://localhost:3333'),
    WEB_PUBLIC_URL: z.url().default('http://localhost:5173'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET deve ter ao menos 32 caracteres'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET deve ter ao menos 32 caracteres'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    ARGON2_MEMORY_COST: z.coerce.number().int().min(19_456).max(65_536).default(19_456),
    ARGON2_TIME_COST: z.coerce.number().int().min(2).max(10).default(2),

    ANAMNESIS_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'ANAMNESIS_ENCRYPTION_KEY deve ser 64 caracteres hexadecimais'),

    NOTIFIER_DRIVER: z.enum(['log', 'evolution', 'email']).default('log'),
    EMAIL_PROVIDER: z.enum(['log', 'smtp']).default('log'),
    EMAIL_FROM: z.string().default('Massoterapia <nao-responda@localhost>'),

    EVOLUTION_API_URL: z.url().optional(),
    EVOLUTION_API_KEY: z.string().optional(),
    EVOLUTION_INSTANCE_NAME: z.string().default('massoterapia'),

    DEFAULT_APPOINTMENT_MINUTES: z.coerce.number().int().min(5).max(480).default(60),
    BOOKING_LEAD_TIME_MINUTES: z.coerce.number().int().min(0).default(120),
    BOOKING_HORIZON_DAYS: z.coerce.number().int().min(1).max(365).default(60),
    REMINDER_LEAD_MINUTES: z.coerce.number().int().min(0).default(1440),
    CANCELLATION_MIN_NOTICE_MINUTES: z.coerce.number().int().min(0).default(120),
    CANCELLATION_FEE_PERCENT: z.coerce.number().min(0).max(100).default(0),
    SLOT_GRANULARITY_MINUTES: z.coerce.number().int().min(5).max(60).default(15),

    LOG_PRETTY: booleanish,
  })
  .superRefine((value, ctx) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET precisa ser diferente de JWT_ACCESS_SECRET',
      });
    }

    if (value.NOTIFIER_DRIVER === 'evolution') {
      if (!value.EVOLUTION_API_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['EVOLUTION_API_URL'],
          message: 'EVOLUTION_API_URL e obrigatoria quando NOTIFIER_DRIVER=evolution',
        });
      }
      if (!value.EVOLUTION_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['EVOLUTION_API_KEY'],
          message: 'EVOLUTION_API_KEY e obrigatoria quando NOTIFIER_DRIVER=evolution',
        });
      }
    }

    if (value.SLOT_GRANULARITY_MINUTES > value.DEFAULT_APPOINTMENT_MINUTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['SLOT_GRANULARITY_MINUTES'],
        message: 'A granularidade de slot nao pode ser maior que a duracao padrao da sessao',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `Configuracao de ambiente invalida:\n${details}\n\nCopie .env.example para .env.`,
  );
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
} as const;

export type Env = typeof env;
