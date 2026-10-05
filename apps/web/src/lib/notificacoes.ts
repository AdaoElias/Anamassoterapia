// `Notification` tambem e o nome do global do DOM: o alias evita que o
// contrato do painel vire um `Notification` silenciosamente errado.
import type {
  Notification as Notificacao,
  NotificationChannel,
  NotificationStatus,
} from '@massoterapia/shared';

import { apiFetch } from './api';

/**
 * Cliente do painel de notificacoes.
 *
 * O contrato vem de `@massoterapia/shared`, o mesmo schema que a API valida, e
 * a leitura e sempre da clinica do usuario logado: nao ha `clinicId` na URL
 * para o navegador escolher.
 */

export interface ListaNotificacoes {
  items: Notificacao[];
  total: number;
  resumo: {
    total: number;
    pendente: number;
    enviando: number;
    enviado: number;
    erro: number;
    cancelado: number;
  };
}

export interface FiltroNotificacoes {
  status?: NotificationStatus | undefined;
  channel?: NotificationChannel | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

function querystring(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === undefined || valor === '') continue;
    search.set(chave, String(valor));
  }
  const texto = search.toString();
  return texto === '' ? '' : `?${texto}`;
}

export const chavesNotificacoes = {
  todas: ['notificacoes'] as const,
};

export function listarNotificacoes(params: FiltroNotificacoes): Promise<ListaNotificacoes> {
  return apiFetch<ListaNotificacoes>(
    `/notifications${querystring({
      status: params.status,
      channel: params.channel,
      search: params.search,
      limit: params.limit,
      offset: params.offset,
    })}`,
  );
}

export function reenviarNotificacao(id: string): Promise<Notificacao> {
  return apiFetch<{ notification: Notificacao }>(`/notifications/${id}/reenviar`, {
    method: 'POST',
  }).then((resposta) => resposta.notification);
}
