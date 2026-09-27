import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';

describe('GET /health', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 com o payload de saude', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'massoterapia-api',
      version: expect.any(String) as string,
    });
  });

  it('valida a variavel de ambiente no bootstrap', () => {
    expect(env.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.JWT_ACCESS_SECRET).not.toBe(env.JWT_REFRESH_SECRET);
  });

  it('devolve 404 estruturado em rota inexistente', async () => {
    const response = await app.inject({ method: 'GET', url: '/nao-existe' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});
