import { afterAll, describe, expect, it } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import { disconnectPrisma } from '../src/lib/prisma.js';

/**
 * Segredo do driver, usado para provar que a mensagem de erro nao vaza
 * detalhe de conexao para quem chamou o probe.
 */
const DETALHE_DO_DRIVER = 'postgresql://massoterapia:senha@localhost:5432/massoterapia_test';

interface CorpoPronto {
  status: string;
  database: string;
  databaseVersion: string;
  uptimeSeconds: number;
  timestamp: string;
  message: string;
}

/** Probe que sempre falha, sem `async`: um `throw` sincrono nao e promessa. */
const probeQuebrado = () => Promise.reject(new Error(DETALHE_DO_DRIVER));

const apps: App[] = [];

async function novaApp(readyProbe?: Parameters<typeof buildApp>[0]): Promise<App> {
  const app = await buildApp(readyProbe);
  await app.ready();
  apps.push(app);
  return app;
}

afterAll(async () => {
  for (const app of apps) {
    await app.close();
  }
  // `ready.ts` importa o singleton do Prisma, que abre pool no import.
  await disconnectPrisma();
});

describe('GET /health/ready', () => {
  it('responde 200 com a versao do banco quando o probe passa', async () => {
    const app = await novaApp({
      readyProbe: () => Promise.resolve({ databaseVersion: '16.15 (probe de teste)' }),
    });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    const corpo = response.json<CorpoPronto>();

    expect(response.statusCode).toBe(200);
    expect(corpo).toMatchObject({
      status: 'ready',
      database: 'up',
      databaseVersion: '16.15 (probe de teste)',
      uptimeSeconds: expect.any(Number) as number,
      timestamp: expect.any(String) as string,
    });
  });

  it('responde 503 quando o probe falha', async () => {
    const app = await novaApp({ readyProbe: probeQuebrado });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json<CorpoPronto>()).toMatchObject({
      status: 'unavailable',
      database: 'down',
      message: 'Banco de dados indisponivel',
    });
  });

  it('nao vaza detalhe de conexao na resposta de falha', async () => {
    const app = await novaApp({ readyProbe: probeQuebrado });

    const corpo = (await app.inject({ method: 'GET', url: '/health/ready' })).body;

    // A string do driver carrega host, porta, usuario e senha. Ela fica
    // no log do servidor, nunca na resposta.
    expect(corpo).not.toContain('senha');
    expect(corpo).not.toContain('localhost:5432');
  });

  it('responde 503 quando o banco demora demais', async () => {
    const app = await novaApp({
      // O pool pode esperar 10s por conexao. Um probe que espera 10s
      // nao serve: o load balancer ja desistiu. A rota corta em 3s.
      readyProbe: () => new Promise<{ databaseVersion: string }>(() => undefined),
    });

    const started = Date.now();
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json<CorpoPronto>()).toMatchObject({
      status: 'unavailable',
      database: 'down',
    });
    // Cortou no timeout, nao esperou o pool desistir.
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 10_000);

  it('mantem o liveness de pe quando o readiness cai', async () => {
    // A separacao que evita o loop de restart: se /health dependesse do
    // banco, reiniciar o Postgres mataria um container inocente.
    const app = await novaApp({ readyProbe: probeQuebrado });

    const liveness = await app.inject({ method: 'GET', url: '/health' });
    const readiness = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(liveness.statusCode).toBe(200);
    expect(liveness.json<{ status: string }>()).toMatchObject({ status: 'ok' });
    expect(readiness.statusCode).toBe(503);
  });

  it('consulta o banco de verdade no probe padrao', async () => {
    // Sem probe injetado, a rota usa `defaultProbe` e o Prisma real. E o
    // unico teste que pega migration faltando ou pool quebrado.
    const app = await novaApp();

    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    const corpo = response.json<CorpoPronto>();

    expect(response.statusCode).toBe(200);
    expect(corpo).toMatchObject({ status: 'ready', database: 'up' });
    expect(corpo.databaseVersion).toMatch(/^\d+\.\d+/);
  });
});
