import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const API_VERSION = '0.1.0';

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('massoterapia-api'),
  version: z.string(),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
});

type HealthResponse = z.infer<typeof healthResponseSchema>;

const healthRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['health'],
        summary: 'Verificacao de vida do processo',
        response: { 200: healthResponseSchema },
      },
    },
    (): HealthResponse => ({
      status: 'ok',
      service: 'massoterapia-api',
      version: API_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    }),
  );

  done();
};

export { healthRoutes };
