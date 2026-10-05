// A lib exporta o objeto pelo `default`, mas os tipos vem como export
// nomeado: o import de valor e o de tipo precisam vir separados.
import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';

import { env } from '../../config/env.js';

/**
 * Canais de saida.
 *
 * A escolha do transporte e por ambiente, nao por clinica: em dev nada sai do
 * processo (`log`), e em producao o WhatsApp vai pela Evolution API e o
 * e-mail por SMTP. O que muda em producao e *para quem* a mensagem e
 * escrita, nao como ela sai -- por isso a decisao de canal e do gatilho e o
 * envio e isolado aqui.
 */

export interface Registrador {
  info(dados: unknown, mensagem?: string): void;
  warn(dados: unknown, mensagem?: string): void;
  error(dados: unknown, mensagem?: string): void;
}

export interface EnvioWhatsApp {
  /** Telefone normalizado, so digitos, com DDI. */
  para: string;
  texto: string;
}

export interface EnvioEmail {
  para: string;
  assunto: string;
  corpo: string;
}

export interface CanalWhatsApp {
  enviar(envio: EnvioWhatsApp): Promise<string | null>;
}

export interface CanalEmail {
  enviar(envio: EnvioEmail): Promise<string | null>;
}

export interface Canais {
  whatsapp: CanalWhatsApp;
  email: CanalEmail;
}

/** Corta o texto do log: nome e horario bastam para depurar, o resto e dado do cliente. */
function previa(texto: string): string {
  return texto.length <= 160 ? texto : `${texto.slice(0, 157)}...`;
}

/**
 * Canal que so registra. E o default de dev e o fallback de producao: se a
 * configuracao do transporte real faltar, o aviso nao se perde -- fica
 * registrado e a linha da `Notification` conta como enviada.
 */
function canalWhatsAppLog(log: Registrador): CanalWhatsApp {
  return {
    enviar({ para, texto }) {
      log.info({ canal: 'WHATSAPP', para, texto: previa(texto) }, 'notificacao registrada (log)');
      return Promise.resolve(null);
    },
  };
}

function canalEmailLog(log: Registrador): CanalEmail {
  return {
    enviar({ para, assunto, corpo }) {
      log.info(
        { canal: 'EMAIL', para, assunto, corpo: previa(corpo) },
        'notificacao registrada (log)',
      );
      return Promise.resolve(null);
    },
  };
}

/** `id` da mensagem na Evolution API, quando ela devolve. */
function chaveDaResposta(corpo: unknown): string | null {
  if (typeof corpo !== 'object' || corpo === null) return null;
  const chave = (corpo as { key?: { id?: unknown } }).key;
  return typeof chave?.id === 'string' ? chave.id : null;
}

/**
 * Evolution API: WhatsApp auto-hospedado, a unica opcao que nao exige
 * credencial da Meta -- o que importa para uma clinica de porte pequeno.
 */
class CanalEvolution implements CanalWhatsApp {
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(url: string, instancia: string, apiKey: string) {
    this.endpoint = `${url.replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(instancia)}`;
    this.apiKey = apiKey;
  }

  async enviar({ para, texto }: EnvioWhatsApp): Promise<string | null> {
    const resposta = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify({ number: para, text: texto }),
    });

    if (!resposta.ok) {
      const detalhe = (await resposta.text()).slice(0, 200);
      throw new Error(`Evolution API respondeu ${resposta.status}: ${detalhe}`);
    }

    return chaveDaResposta(await resposta.json());
  }
}

class CanalSmtp implements CanalEmail {
  private readonly transporte: Transporter;

  constructor(log: Registrador) {
    const host = env.EMAIL_SMTP_HOST ?? '';
    const user = env.EMAIL_SMTP_USER;
    const password = env.EMAIL_SMTP_PASSWORD;

    this.transporte = nodemailer.createTransport({
      host,
      port: env.EMAIL_SMTP_PORT,
      secure: env.EMAIL_SMTP_SECURE,
      // Sem credencial o transporte assume IP permitido (servicos locais de
      // teste). Com credencial, AUTH e negociado.
      ...(user !== undefined && password !== undefined ? { auth: { user, pass: password } } : {}),
    });

    log.info(
      { host, port: env.EMAIL_SMTP_PORT, secure: env.EMAIL_SMTP_SECURE },
      'transporte SMTP pronto',
    );
  }

  async enviar({ para, assunto, corpo }: EnvioEmail): Promise<string | null> {
    const info = await this.transporte.sendMail({
      from: env.EMAIL_FROM,
      to: para,
      subject: assunto,
      text: corpo,
    });
    return info.messageId;
  }
}

/**
 * Monta os canais do processo a partir do ambiente.
 *
 * `NOTIFIER_DRIVER=email` desliga o WhatsApp de proposito: existe para a
 * clinica que so usa e-mail, e nao e erro de configuracao. Ja a combinacao
 * `smtp` sem host passa pelo schema de ambiente; se chegar aqui assim mesmo
 * (variavel faltando no processo), o aviso e registrado em vez de virar erro
 * 500 no meio de uma reserva.
 */
export function criarCanais(log: Registrador): Canais {
  const whatsapp =
    env.NOTIFIER_DRIVER === 'evolution' && env.EVOLUTION_API_URL && env.EVOLUTION_API_KEY
      ? new CanalEvolution(
          env.EVOLUTION_API_URL,
          env.EVOLUTION_INSTANCE_NAME,
          env.EVOLUTION_API_KEY,
        )
      : canalWhatsAppLog(log);

  const email =
    env.EMAIL_PROVIDER === 'smtp' && env.EMAIL_SMTP_HOST !== undefined
      ? new CanalSmtp(log)
      : canalEmailLog(log);

  return { whatsapp, email };
}
