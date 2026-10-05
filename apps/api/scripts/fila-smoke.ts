/**
 * Verificacao manual da fila contra o Postgres de verdade.
 *
 * A suite nao sobe a fila (worker por arquivo de teste seria uma conexao a
 * mais e um consumidor disputando as linhas antes do `expect`), entao este
 * script existe para confirmar que as opcoes do pg-boss que a aplicacao usa
 * -- `work` com lote, `send` com `startAfter`, retry -- sao aceitas e que o
 * aviso chega a ser processado.
 *
 *   pnpm --filter @massoterapia/api exec tsx scripts/fila-smoke.ts
 *
 * Roda contra `TEST_DATABASE_URL` e limpa tudo que criou.
 */
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: ['../../.env', '.env'], override: true, quiet: true });

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

if (testDatabaseUrl === undefined) throw new Error('TEST_DATABASE_URL nao definida');
if (!/(^|_)test$/.test(new URL(testDatabaseUrl).pathname.replace(/^\//, ''))) {
  throw new Error('o script so roda contra o banco de teste');
}

process.env['DATABASE_URL'] = testDatabaseUrl;

const { randomUUID } = await import('node:crypto');
const { PgBoss } = await import('pg-boss');
const { env } = await import('../src/config/env.js');
const { prisma, disconnectPrisma } = await import('../src/lib/prisma.js');
const { iniciarFila, pararFila, filaAtiva, enfileirar, FILA_NOTIFICACOES } =
  await import('../src/lib/notificacoes/fila.js');

const silencioso = {
  info: (dados: unknown, mensagem?: string) => console.log('[info]', mensagem ?? '', dados),
  warn: (dados: unknown, mensagem?: string) => console.log('[warn]', mensagem ?? '', dados),
  error: (dados: unknown, mensagem?: string) => console.error('[error]', mensagem ?? '', dados),
};

const clinicId = randomUUID();

try {
  await iniciarFila(silencioso);
  console.log('fila ativa:', filaAtiva());

  // A configuracao da fila vive em opcoes que o pg-boss aceita em silencio:
  // ignoradas, o efeito aparece semanas depois, no primeiro aviso que nao
  // chega. Ler de volta, em uma conexao separada, e o jeito barato de provar
  // que as opcoes foram aplicadas.
  const leitor = new PgBoss({ connectionString: testDatabaseUrl, schema: env.QUEUE_SCHEMA });
  await leitor.start();
  const fila = await leitor.getQueue(FILA_NOTIFICACOES);
  await leitor.stop({ close: true, graceful: true, timeout: 10_000 });

  if (fila === null) throw new Error('a fila nao foi criada');
  console.log(
    `fila criada: ${fila.name} | retryLimit: ${fila.retryLimit} | retencao: ${fila.retentionSeconds}s`,
  );
  if (fila.retryLimit !== 2) throw new Error(`retryLimit esperado 2, veio ${fila.retryLimit}`);
  // 14 dias (padrao do pg-boss) apagaria o lembrete de uma sessao marcada com
  // mais de duas semanas de antecedencia.
  if (fila.retentionSeconds !== undefined && fila.retentionSeconds < 30 * 86_400) {
    throw new Error(`retencao curta demais: ${fila.retentionSeconds}s`);
  }

  await prisma.clinic.create({
    data: { id: clinicId, name: 'Clinica do Smoke', slug: `smoke-${clinicId.slice(0, 8)}` },
  });

  const linha = await prisma.notification.create({
    data: {
      clinicId,
      channel: 'EMAIL',
      type: 'LEMBRETE',
      recipient: 'ana@teste.local',
      subject: 'Smoke',
      body: 'Oi, Ana! Passando para lembrar do seu horario.',
      scheduledFor: new Date(Date.now() - 60_000),
    },
  });

  // Uma segunda linha, agendada para 40 segundos no futuro: o worker tem de
  // largar as duas na ordem e nao disparar antes da hora.
  const futura = await prisma.notification.create({
    data: {
      clinicId,
      channel: 'WHATSAPP',
      type: 'LEMBRETE',
      recipient: '5551999998888',
      body: 'Oi, Ana! Ainda vai ser lembrado.',
      scheduledFor: new Date(Date.now() + 40_000),
    },
  });

  enfileirar(linha.id, linha.scheduledFor);
  enfileirar(futura.id, futura.scheduledFor);

  const inicio = Date.now();
  const enviaram: string[] = [];
  let pendente = true;

  while (Date.now() - inicio < 20_000) {
    await new Promise((resolver) => setTimeout(resolver, 500));
    const atual = await prisma.notification.findUniqueOrThrow({ where: { id: linha.id } });
    if (atual.status === 'ENVIADO') enviaram.push(atual.id);
    if (enviaram.length > 0 && atual.sentAt !== null) {
      const adiante = await prisma.notification.findUniqueOrThrow({ where: { id: futura.id } });
      console.log('imediata:', atual.status, '| futura:', adiante.status);
      pendente = false;
      break;
    }
  }

  if (pendente) throw new Error('a notificacao imediata nao foi processada em 20s');

  console.log('OK: fila, worker e envio funcionam');
} finally {
  await pararFila();
  await prisma.notification.deleteMany({ where: { clinicId } });
  await prisma.clinic.deleteMany({ where: { id: clinicId } });
  await disconnectPrisma();
}
