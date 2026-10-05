import { buildApp } from './app.js';
import { env } from './config/env.js';
import { iniciarFila } from './lib/notificacoes/fila.js';

async function main(): Promise<void> {
  const app = await buildApp();

  // A fila sobe aqui, e nao em `buildApp()`: um worker por processo de teste
  // seria uma conexao a mais no banco e um consumidor disputando as mesmas
  // linhas. Se a fila nao subir, a API continua no ar -- a outbox guarda o
  // que ficou para tras e o aviso aparece no painel.
  try {
    await iniciarFila(app.log);
  } catch (error) {
    app.log.error({ err: error }, 'fila de notificacoes nao subiu; avisos ficarao pendentes');
  }

  try {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
    app.log.info(`API no ar em ${env.API_PUBLIC_URL}`);
    if (!env.isProduction) {
      app.log.info(`Documentacao OpenAPI em ${env.API_PUBLIC_URL}/docs`);
    }
  } catch (error) {
    app.log.error({ err: error }, 'falha ao subir o servidor');
    process.exit(1);
  }

  // Encerramento gracioso: para de aceitar conexoes novas, drena as que
  // estao em andamento e so entao mata o processo. Sem isso, deploy derruba
  // sessao do cliente no meio de um agendamento.
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} recebido, encerrando...`);

    const forceExit = setTimeout(() => {
      app.log.error('Timeout no encerramento gracioso, forcando saida');
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    try {
      await app.close();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'erro no encerramento');
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }

  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'promise rejeitada sem tratamento');
  });
  process.on('uncaughtException', (error) => {
    app.log.fatal({ err: error }, 'excecao nao capturada');
    void shutdown('uncaughtException');
  });
}

void main();
