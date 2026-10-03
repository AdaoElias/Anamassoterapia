import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../src/config/env.js';

/**
 * Garantias que so o banco pode prometer.
 *
 * Aqui nao testa a API: testa o Postgres. O que interessa e o SQLSTATE
 * devolvido, porque e dele que a API deriva o 409 e o 422. Um
 * `expect(...).rejects.toThrow()` sem codigo passa mesmo quando o erro e
 * outro qualquer -- e ai o teste verde nao protege nada.
 *
 * A suite completa (15 verificacoes, incluindo as tabelas de cliente,
 * agenda e financeiro) vive em `prisma/verify/constraints.sql`, roda por
 * `pnpm db:verify` e tambem no CI. Aqui ficam as que securem as tres
 * migrations da Etapa 1, mais o par classico de agenda/anamnese.
 */

/** SQLSTATE do PostgreSQL. Ver `errcode` / Appendix A. */
const EXCLUSION_VIOLATION = '23P01';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const BASE = '2026-10-05 13:00:00+00';

let pool: Pool;

beforeAll(() => {
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    application_name: 'massoterapia_test_constraints',
  });
});

afterAll(async () => {
  await pool.end();
});

/**
 * O erro do Postgres traz o SQLSTATE em `code`. O teste nao instancia a
 * classe `DatabaseError`: acoplar em `instanceof` quebra se o driver
 * resolver outra copia do pg-protocol. Duck typing nao tem esse risco.
 */
function temSqlState(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
  );
}

/** Extrai o SQLSTATE do erro do driver, ou `undefined` se nao houve erro. */
function sqlState(error: unknown): string | undefined {
  return temSqlState(error) ? error.code : undefined;
}

async function sqlStateOf(acao: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await acao();
    return undefined;
  } catch (error) {
    return sqlState(error);
  }
}

/**
 * Cada teste roda em uma transacao propria e desfaz tudo. Sem isso, um
 * agendamento de teste sobrevive a suite e aparece no relatorio da agenda
 * do seed -- ou pior, trava um horario real.
 *
 * O valor devolvido pelo callback e propagado. A versao anterior chamava
 * `fn` e devolvia `undefined` sempre, e com isso os doze testes de recusa
 * comparavam `undefined` com um SQLSTATE e "passavam" sem nada ter sido
 * verificado. Num helper de teste, valor descartado e assercao vazia.
 */
async function emTransacao<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('ROLLBACK');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface Cenario {
  clinica: string;
  cliente: string;
  cliente2: string;
  profissional: string;
  profissional2: string;
  terapia: string;
  sala: string;
}

function novoCenario(): Cenario {
  return {
    clinica: randomUUID(),
    cliente: randomUUID(),
    cliente2: randomUUID(),
    profissional: randomUUID(),
    profissional2: randomUUID(),
    terapia: randomUUID(),
    sala: randomUUID(),
  };
}

async function montarBase(client: PoolClient, c: Cenario): Promise<void> {
  await client.query('INSERT INTO clinics (id, slug, name) VALUES ($1, $2, $3)', [
    c.clinica,
    `verificacao-${c.clinica.slice(0, 8)}`,
    'Verificacao',
  ]);
  await client.query(
    'INSERT INTO clients (id, clinic_id, name) VALUES ($1, $2, $3), ($4, $2, $5)',
    [c.cliente, c.clinica, 'Cliente A', c.cliente2, 'Cliente B'],
  );
  await client.query(
    'INSERT INTO professionals (id, clinic_id, name) VALUES ($1, $2, $3), ($4, $2, $5)',
    [c.profissional, c.clinica, 'Prof', c.profissional2, 'Prof 2'],
  );
  await client.query(
    'INSERT INTO therapies (id, clinic_id, name, slug, price_cents) VALUES ($1, $2, $3, $4, $5)',
    [c.terapia, c.clinica, 'Relaxante', `relaxante-${c.terapia.slice(0, 8)}`, 12_000],
  );
  await client.query('INSERT INTO rooms (id, clinic_id, name) VALUES ($1, $2, $3)', [
    c.sala,
    c.clinica,
    'Sala 1',
  ]);
}

interface Agendamento {
  cliente: string;
  profissional: string;
  inicio: string;
  fim: string;
  status?: string;
  motivo?: string | null;
  id?: string;
}

async function agendar(client: PoolClient, c: Cenario, a: Agendamento): Promise<void> {
  await client.query(
    `INSERT INTO appointments (
       id, clinic_id, client_id, professional_id, therapy_id, room_id,
       start_at, end_at, status, price_cents, cancellation_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 12000, $10)`,
    [
      a.id ?? randomUUID(),
      c.clinica,
      a.cliente,
      a.profissional,
      c.terapia,
      c.sala,
      a.inicio,
      a.fim,
      a.status ?? 'CONFIRMADO',
      a.motivo ?? null,
    ],
  );
}

describe('agenda: exclusao de conflito', () => {
  it('recusa dois agendamentos sobrepostos no mesmo profissional', async () => {
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      await agendar(client, c, {
        cliente: c.cliente,
        profissional: c.profissional,
        inicio: BASE,
        fim: '2026-10-05 14:00:00+00',
      });
      return await sqlStateOf(() =>
        agendar(client, c, {
          cliente: c.cliente2,
          profissional: c.profissional,
          inicio: '2026-10-05 13:30:00+00',
          fim: '2026-10-05 14:30:00+00',
        }),
      );
    });

    expect(estado).toBe(EXCLUSION_VIOLATION);
  });

  it('aceita sessao encostada na anterior', async () => {
    // `tstzrange` e '[)': 13:00-14:00 e 14:00-15:00 sao adjacentes, e
    // uma agenda com sessoes em sequencia seria rejeitada inteira.
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      await agendar(client, c, {
        cliente: c.cliente,
        profissional: c.profissional,
        inicio: BASE,
        fim: '2026-10-05 14:00:00+00',
      });
      return await sqlStateOf(() =>
        agendar(client, c, {
          cliente: c.cliente2,
          profissional: c.profissional,
          inicio: '2026-10-05 14:00:00+00',
          fim: '2026-10-05 15:00:00+00',
        }),
      );
    });

    expect(estado).toBeUndefined();
  });

  it('libera o horario quando o agendamento e cancelado', async () => {
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      await agendar(client, c, {
        cliente: c.cliente,
        profissional: c.profissional,
        inicio: BASE,
        fim: '2026-10-05 14:00:00+00',
        status: 'CANCELADO',
        motivo: 'CLIENTE_DESISTIU',
      });
      return await sqlStateOf(() =>
        agendar(client, c, {
          cliente: c.cliente2,
          profissional: c.profissional,
          inicio: BASE,
          fim: '2026-10-05 14:00:00+00',
        }),
      );
    });

    expect(estado).toBeUndefined();
  });

  it('recusa sala ocupada por outro profissional', async () => {
    // Recurso compartilhado: dois profissionais, uma sala, um horario.
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      await agendar(client, c, {
        cliente: c.cliente,
        profissional: c.profissional,
        inicio: BASE,
        fim: '2026-10-05 14:00:00+00',
      });
      return await sqlStateOf(() =>
        agendar(client, c, {
          cliente: c.cliente2,
          profissional: c.profissional2,
          inicio: '2026-10-05 13:15:00+00',
          fim: '2026-10-05 14:15:00+00',
        }),
      );
    });

    expect(estado).toBe(EXCLUSION_VIOLATION);
  });

  it('recusa o mesmo cliente em dois lugares', async () => {
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      await agendar(client, c, {
        cliente: c.cliente,
        profissional: c.profissional,
        inicio: BASE,
        fim: '2026-10-05 14:00:00+00',
      });
      return await sqlStateOf(() =>
        agendar(client, c, {
          cliente: c.cliente,
          profissional: c.profissional2,
          inicio: '2026-10-05 13:30:00+00',
          fim: '2026-10-05 14:30:00+00',
        }),
      );
    });

    expect(estado).toBe(EXCLUSION_VIOLATION);
  });

  it('recusa sessao de duracao zero', async () => {
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      return await sqlStateOf(() =>
        agendar(client, c, {
          cliente: c.cliente,
          profissional: c.profissional,
          inicio: BASE,
          fim: BASE,
        }),
      );
    });

    expect(estado).toBe(CHECK_VIOLATION);
  });

  it('recusa cancelamento sem motivo registrado', async () => {
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      return await sqlStateOf(() =>
        agendar(client, c, {
          cliente: c.cliente,
          profissional: c.profissional,
          inicio: BASE,
          fim: '2026-10-05 14:00:00+00',
          status: 'CANCELADO',
          motivo: null,
        }),
      );
    });

    expect(estado).toBe(CHECK_VIOLATION);
  });
});

describe('anamnese: resposta imutavel apos o envio', () => {
  it('recusa alterar as respostas de uma anamnese enviada', async () => {
    // Dado de saude: depois de assinada, a resposta e registro do que o
    // cliente afirmou, nao campo editavel. Auditoria depende disso.
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      const id = randomUUID();
      await client.query(
        `INSERT INTO anamneses (id, clinic_id, client_id, version, status, submitted_at, answers_encrypted)
         VALUES ($1, $2, $3, 1, 'ENVIADA', now(), 'v1:iv:tag:dados')`,
        [id, c.clinica, c.cliente],
      );
      return await sqlStateOf(() =>
        client.query('UPDATE anamneses SET answers_encrypted = $1 WHERE id = $2', [
          'v1:iv:tag:adulterado',
          id,
        ]),
      );
    });

    expect(estado).toBe(CHECK_VIOLATION);
  });

  it('deixa a revisao avancar o status sem tocar nas respostas', async () => {
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      const id = randomUUID();
      await client.query(
        `INSERT INTO anamneses (id, clinic_id, client_id, version, status, submitted_at, answers_encrypted)
         VALUES ($1, $2, $3, 1, 'ENVIADA', now(), 'v1:iv:tag:dados')`,
        [id, c.clinica, c.cliente],
      );
      return await sqlStateOf(() =>
        client.query(
          "UPDATE anamneses SET status = 'APROVADA', reviewed_at = now() WHERE id = $1",
          [id],
        ),
      );
    });

    expect(estado).toBeUndefined();
  });

  it('mantem o rascunho editavel', async () => {
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      const id = randomUUID();
      await client.query(
        `INSERT INTO anamneses (id, clinic_id, client_id, version, status, answers_encrypted)
         VALUES ($1, $2, $3, 1, 'RASCUNHO', 'v1:iv:tag:parcial')`,
        [id, c.clinica, c.cliente],
      );
      return await sqlStateOf(() =>
        client.query('UPDATE anamneses SET answers_encrypted = $1 WHERE id = $2', [
          'v1:iv:tag:completo',
          id,
        ]),
      );
    });

    expect(estado).toBeUndefined();
  });
});

describe('financeiro: unicidades que impedem duplicata', () => {
  it('recusa duas entradas com a mesma chave de idempotencia', async () => {
    // O gateway reenvia webhook e o cliente clica duas vezes. Sem esta
    // chave, o mesmo atendimento vira dois lancamentos e o caixa nao fecha.
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      const inserir = (id: string) =>
        client.query(
          `INSERT INTO financial_entries (id, clinic_id, kind, status, amount_cents, idempotency_key)
           VALUES ($1, $2, 'RECEITA', 'PENDENTE', 12000, 'agendamento-abc')`,
          [id, c.clinica],
        );
      await inserir(randomUUID());
      return await sqlStateOf(() => inserir(randomUUID()));
    });

    expect(estado).toBe(UNIQUE_VIOLATION);
  });

  it('aceita entradas sem chave de idempotencia', async () => {
    // Lancamento digitado no balcao nao tem chave. NULL nao conflita em
    // indice unico, e e exatamente esse o efeito desejado.
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      const inserir = (id: string) =>
        client.query(
          `INSERT INTO financial_entries (id, clinic_id, kind, status, amount_cents)
           VALUES ($1, $2, 'RECEITA', 'PENDENTE', 12000)`,
          [id, c.clinica],
        );
      await inserir(randomUUID());
      return await sqlStateOf(() => inserir(randomUUID()));
    });

    expect(estado).toBeUndefined();
  });

  it('recusa dois pacotes com o mesmo nome para o mesmo cliente', async () => {
    // Sem esta chave, "Pacote 5 Sessoes" nasce quantas vezes o balcao
    // digitar o nome.
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      const inserir = (id: string) =>
        client.query(
          `INSERT INTO packages (id, clinic_id, client_id, name, total_sessions, price_cents, valid_from, valid_until)
           VALUES ($1, $2, $3, 'Pacote 5 Sessoes', 5, 50000, '2026-10-01', '2026-12-01')`,
          [id, c.clinica, c.cliente],
        );
      await inserir(randomUUID());
      return await sqlStateOf(() => inserir(randomUUID()));
    });

    expect(estado).toBe(UNIQUE_VIOLATION);
  });

  it('recusa duas comissoes para a mesma sessao e o mesmo profissional', async () => {
    const c = novoCenario();
    const agendamento = randomUUID();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      await agendar(client, c, {
        id: agendamento,
        cliente: c.cliente,
        profissional: c.profissional,
        inicio: BASE,
        fim: '2026-10-05 14:00:00+00',
      });
      const inserir = (id: string) =>
        client.query(
          `INSERT INTO commissions (
             id, clinic_id, professional_id, appointment_id,
             base_amount_cents, percent_basis_points, amount_cents, period_start, period_end
           ) VALUES ($1, $2, $3, $4, 12000, 400, 480, '2026-10-01', '2026-10-31')`,
          [id, c.clinica, c.profissional, agendamento],
        );
      await inserir(randomUUID());
      return await sqlStateOf(() => inserir(randomUUID()));
    });

    expect(estado).toBe(UNIQUE_VIOLATION);
  });
});

describe('disponibilidade: unicidade do bloqueio de dia inteiro', () => {
  it('recusa dois bloqueios de dia inteiro no mesmo dia', async () => {
    // O indice unico de 4 colunas nao protege este caso: o dia inteiro e
    // gravado com `start_minute IS NULL` e no PostgreSQL NULL nunca
    // conflita. O indice parcial e o que fecha a brecha.
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      const inserir = (id: string) =>
        client.query(
          `INSERT INTO availability_exceptions (id, clinic_id, professional_id, date, type, reason)
           VALUES ($1, $2, $3, '2026-10-07', 'BLOQUEIO', 'Folga')`,
          [id, c.clinica, c.profissional],
        );
      await inserir(randomUUID());
      return await sqlStateOf(() => inserir(randomUUID()));
    });

    expect(estado).toBe(UNIQUE_VIOLATION);
  });

  it('aceita janela extra e bloqueio de dia inteiro no mesmo dia', async () => {
    // Sao estados diferentes: o profissional trabalha na manha e folga a
    // tarde. O bloqueio de dia inteiro e a unico que conflita consigo.
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      await client.query(
        `INSERT INTO availability_exceptions (id, clinic_id, professional_id, date, type, start_minute, end_minute)
         VALUES ($1, $2, $3, '2026-10-07', 'EXTRA', 1320, 1380)`,
        [randomUUID(), c.clinica, c.profissional],
      );
      return await sqlStateOf(() =>
        client.query(
          `INSERT INTO availability_exceptions (id, clinic_id, professional_id, date, type, reason)
           VALUES ($1, $2, $3, '2026-10-07', 'BLOQUEIO', 'Folga a tarde')`,
          [randomUUID(), c.clinica, c.profissional],
        ),
      );
    });

    expect(estado).toBeUndefined();
  });

  it('recusa excecao EXTRA sem janela de horario', async () => {
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      return await sqlStateOf(() =>
        client.query(
          `INSERT INTO availability_exceptions (id, clinic_id, professional_id, date, type)
           VALUES ($1, $2, $3, '2026-10-07', 'EXTRA')`,
          [randomUUID(), c.clinica, c.profissional],
        ),
      );
    });

    expect(estado).toBe(CHECK_VIOLATION);
  });

  it('recusa regra de disponibilidade invertida', async () => {
    const c = novoCenario();

    const estado = await emTransacao(async (client) => {
      await montarBase(client, c);
      return await sqlStateOf(() =>
        client.query(
          `INSERT INTO availability_rules (id, clinic_id, professional_id, weekday, start_minute, end_minute, effective_from)
           VALUES ($1, $2, $3, 1, 600, 540, '2026-10-01')`,
          [randomUUID(), c.clinica, c.profissional],
        ),
      );
    });

    expect(estado).toBe(CHECK_VIOLATION);
  });
});
