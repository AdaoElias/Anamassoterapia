import { prisma } from '../prisma.js';
import { type Canais, criarCanais, type Registrador } from './transportes.js';

/**
 * Envio de uma notificacao da outbox.
 *
 * A `Notification` e quem manda: o pg-boss so entrega "tente a linha X". Se
 * o processo cair entre gravar a linha e a fila assumir, a proxima varredura
 * do painel ou a 5B (reenvio manual) pegam o que sobrou -- e o inverso
 * tambem vale, uma linha ja enviada nunca e reenviada so porque o job rodou
 * de novo.
 */

/** Uma entrega que falhou 3 vezes e esgotada: a linha fica em ERRO para o humano decidir. */
export const MAX_TENTATIVAS = 3;

const LIMITE_ERRO = 600;

export interface ResultadoProcessamento {
  situacao: 'ENVIADO' | 'ERRO' | 'IGNORADO' | 'ADIADO';
  tentativas: number;
  externalId: string | null;
  erro: string | null;
  /**
   * Preenchido so em `ADIADO`: a linha ainda nao venceu. Quem chamou precisa
   * rearmar o job para esse instante -- sem isso o job seria consumido e a
   * linha ficaria `PENDENTE` para sempre, sem ninguem para tentar de novo.
   */
  reagendarPara: Date | null;
}

function ignorar(tentativas: number): ResultadoProcessamento {
  return { situacao: 'IGNORADO', tentativas, externalId: null, erro: null, reagendarPara: null };
}

function adiar(tentativas: number, reagendarPara: Date): ResultadoProcessamento {
  return { situacao: 'ADIADO', tentativas, externalId: null, erro: null, reagendarPara };
}

interface LinhaDaOutbox {
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS';
  recipient: string;
  subject: string | null;
  body: string;
  attempts: number;
}

async function despachar(linha: LinhaDaOutbox, canais: Canais): Promise<string | null> {
  switch (linha.channel) {
    case 'WHATSAPP':
      return canais.whatsapp.enviar({ para: linha.recipient, texto: linha.body });
    case 'EMAIL':
      return canais.email.enviar({
        para: linha.recipient,
        assunto: linha.subject ?? '',
        corpo: linha.body,
      });
    case 'SMS':
      // O enum tem SMS para o futuro, mas nenhum driver o produz hoje: se
      // chegar aqui e um bug de gatilho, e melhor falhar visivel do que
      // marcar como enviado.
      throw new Error(`canal ${linha.channel} sem transporte configurado`);
  }
}

/**
 * Processa uma linha da outbox.
 *
 * Idempotente por status: `ENVIADO` e `CANCELADO` sao resposta definitiva, e
 * `ENVIANDO` entra na disputa justamente porque um processo morto no meio do
 * envio deixaria a linha presa para sempre.
 */
export async function processarNotificacao(
  notificationId: string,
  log: Registrador,
  canais: Canais = criarCanais(log),
): Promise<ResultadoProcessamento> {
  const notificacao = await prisma.notification.findUnique({ where: { id: notificationId } });

  if (notificacao === null) return ignorar(0);

  const tentativas = notificacao.attempts + 1;

  if (notificacao.status === 'ENVIADO' || notificacao.status === 'CANCELADO') {
    log.info({ notificationId, status: notificacao.status }, 'notificacao ja concluida, ignorada');
    return ignorar(notificacao.attempts);
  }

  if (notificacao.scheduledFor.getTime() > Date.now()) {
    log.info({ notificationId }, 'notificacao ainda nao vencida, adiada');
    return adiar(notificacao.attempts, notificacao.scheduledFor);
  }

  // `updateMany` com filtro de status e a trava: se dois workers pegarem o
  // mesmo job (ou o mesmo job for reentregue), so um consegue mover a linha.
  const tomada = await prisma.notification.updateMany({
    where: { id: notificationId, status: { in: ['PENDENTE', 'ERRO', 'ENVIANDO'] } },
    data: { status: 'ENVIANDO', attempts: tentativas },
  });

  if (tomada.count === 0) {
    log.info({ notificationId }, 'notificacao ja priseada por outro worker, ignorada');
    return ignorar(notificacao.attempts);
  }

  try {
    const externalId = await despachar(notificacao, canais);

    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'ENVIADO', sentAt: new Date(), externalId, lastError: null },
    });

    return { situacao: 'ENVIADO', tentativas, externalId, erro: null, reagendarPara: null };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'ERRO', lastError: mensagem.slice(0, LIMITE_ERRO) },
    });

    log.error(
      { notificationId, tentativas, canal: notificacao.channel, erro: mensagem },
      'falha ao enviar notificacao',
    );

    return { situacao: 'ERRO', tentativas, externalId: null, erro: mensagem, reagendarPara: null };
  }
}
