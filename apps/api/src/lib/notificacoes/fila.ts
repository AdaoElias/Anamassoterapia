import { PgBoss } from 'pg-boss';

import { env } from '../../config/env.js';
import { MAX_TENTATIVAS, processarNotificacao } from './processar.js';
import type { Registrador } from './transportes.js';

/**
 * Fila de execucao (pg-boss), no mesmo Postgres da aplicacao e dentro do
 * mesmo processo da API.
 *
 * Por que o pg-boss e nao um job "solta" com `setTimeout`: lembrete e um
 * aviso com prazo de horas, e um processo Node que reinicia perde o relogio.
 * O job fica na tabela, sobrevive ao restart, e o `Notification` continua
 * sendo a fonte de verdade.
 *
 * Por que nao um worker separado: para uma clinica, dois processos para
 * enviar e-mail e WhatsApp e uma peca a mais para operar. O preco e que
 * `iniciarFila` roda no `index.ts`, nunca dentro de `buildApp()` -- senao a
 * suite de teste levantaria um worker por arquivo.
 */

export const FILA_NOTIFICACOES = 'notificacoes';

const LOTE = 10;

/** Uma entrega que falhou 3 vezes e esgotada. */
const TENTATIVAS_FILA = MAX_TENTATIVAS - 1;

const ATRASO_RETRY_SEGUNDOS = 30;

let boss: PgBoss | null = null;
let registrador: Registrador | null = null;

/** `false` quando a fila nao subiu: a outbox continua valendo e vira fila manual. */
export function filaAtiva(): boolean {
  return boss !== null;
}

export async function iniciarFila(log: Registrador): Promise<void> {
  if (boss !== null) return;

  const instancia = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.QUEUE_SCHEMA,
    max: env.QUEUE_POOL_MAX,
    application_name: 'massoterapia_fila',
  });

  await instancia.start();

  // A fila precisa existir antes do worker: no pg-boss 12 o `work` falha se a
  // fila nao esta criada -- e falha com um `error` assincrono, depois do
  // `start` ja ter devolvido.
  //
  // `createQueue` so cria; numa fila que ja existe ele nao aplica nada, e a
  // fila continuaria com os padroes do primeiro deploy. Por isso o par
  // create + update: o codigo e a configuracao da fila, e mudar um no
  // `.env` precisa valer no proximo restart.
  const opcoes = {
    // O padrao do pg-boss e 14 dias para jobs em estado `created`/`retry`.
    // A janela de agendamento e de 60 dias, entao o lembrete de uma sessao
    // marcada para daqui a um mes seria apagado da fila bem antes da hora --
    // e a linha ficaria PENDENTE sem ninguem para tentar de novo. A margem de
    // uma semana cobre a virada do horizonte de agendamento.
    retentionSeconds: (env.BOOKING_HORIZON_DAYS + 7) * 86_400,
    retryLimit: TENTATIVAS_FILA,
    retryBackoff: true,
    retryDelay: ATRASO_RETRY_SEGUNDOS,
    retryDelayMax: ATRASO_RETRY_SEGUNDOS * 10,
  } satisfies Parameters<PgBoss['updateQueue']>[1];

  await instancia.createQueue(FILA_NOTIFICACOES);
  await instancia.updateQueue(FILA_NOTIFICACOES, opcoes);

  // Sem este listener, um 'error' do EventEmitter derruba o processo (regra do
  // Node para 'error' sem handler) -- e o oposto do desenho: fila quebrada nao
  // pode derrubar uma API que continua aceitando reserva.
  instancia.on('error', (erro: unknown) => {
    log.error({ err: erro }, 'erro na fila de notificacoes');
  });

  await instancia.work<{ notificationId: string }>(
    FILA_NOTIFICACOES,
    {
      batchSize: LOTE,
      pollingIntervalSeconds: env.QUEUE_POLL_SECONDS,
    },
    async (jobs) => {
      for (const job of jobs) {
        const resultado = await processarNotificacao(job.data.notificationId, log);

        // A linha vence depois da entrega do job (reagendamento racedado com o
        // worker, ou ajuste de relogio). Rearmar e obrigatorio: o job
        // consumido nao volta, e sem isso a linha ficaria PENDENTE sem
        // ninguem para tentar de novo.
        if (resultado.situacao === 'ADIADO' && resultado.reagendarPara !== null) {
          enfileirar(job.data.notificationId, resultado.reagendarPara);
          continue;
        }

        // Relancar e o que faz o pg-boss repetir com backoff. Na ultima
        // tentativa a linha ja ficou em ERRO com o motivo, entao engolir
        // aqui evita erro vermelho no log por algo que ja foi registrado.
        if (resultado.situacao === 'ERRO' && resultado.tentativas < MAX_TENTATIVAS) {
          throw new Error(
            `falha ao enviar notificacao ${job.data.notificationId}: ${resultado.erro}`,
          );
        }

        if (resultado.situacao === 'ERRO') {
          log.error(
            { notificationId: job.data.notificationId, erro: resultado.erro },
            'notificacao esgotou as tentativas',
          );
        }
      }
    },
  );

  boss = instancia;
  registrador = log;

  log.info(
    { fila: FILA_NOTIFICACOES, schema: env.QUEUE_SCHEMA, lote: LOTE },
    'fila de notificacoes no ar',
  );
}

export async function pararFila(): Promise<void> {
  const instancia = boss;
  boss = null;
  registrador = null;

  if (instancia === null) return;

  await instancia.stop({ close: true, graceful: true, timeout: 10_000 });
}

/**
 * Acorda o worker para uma linha da outbox.
 *
 * Sem excecao quando a fila nao subiu: a linha gravada e o que garante o
 * envio (ou o reenvio manual). Um `send` rejeitado nao pode derrubar a
 * reserva que acabou de ser criada -- e o registro do erro vai para o log.
 */
export function enfileirar(notificationId: string, quando: Date = new Date()): void {
  const instancia = boss;

  if (instancia === null) return;

  void instancia
    .send(
      FILA_NOTIFICACOES,
      { notificationId },
      {
        startAfter: quando,
        retryLimit: TENTATIVAS_FILA,
        retryBackoff: true,
        retryDelay: ATRASO_RETRY_SEGUNDOS,
        retryDelayMax: 10 * ATRASO_RETRY_SEGUNDOS,
      },
    )
    .catch((erro: unknown) => {
      registrador?.warn(
        { notificationId, erro: erro instanceof Error ? erro.message : String(erro) },
        'nao foi possivel enfileirar notificacao',
      );
    });
}
