import type {
  AnamnesisAnswers,
  AnamnesisPublicForm,
  AnamnesisPublicSubmitResponse,
} from '@massoterapia/shared';

import { apiFetch } from './api';

/**
 * Anamnese respondida pelo cliente, sem login.
 *
 * Vai para `/public/anamneses` e nao para `/anamnesis` porque aqui a unica
 * credencial e o token do link. Consequencia pratica: nenhuma funcao deste
 * modulo recebe `clientId`, `clinicId` ou id de anamnese -- se recebesse,
 * bastaria adivinhar um UUID para ler a anamnese de outra pessoa.
 *
 * Erro de token (inexistente, expirado, consumido) chega como `ApiError` e a
 * tela trata todos com a mesma mensagem, sem distinguir os casos.
 */

export const chavesAnamnesePublica = {
  formulario: (token: string) => ['public', 'anamnese', token] as const,
};

/** Cria o rascunho na primeira chamada e devolve o que ja foi respondido. */
export function abrirAnamnesePublica(token: string): Promise<AnamnesisPublicForm> {
  return apiFetch<AnamnesisPublicForm>('/public/anamneses/abrir', {
    method: 'POST',
    body: { token },
  });
}

/** Aceita resposta parcial de proposito: e o "salvar e sair". Devolve 204. */
export function salvarRascunhoPublico(token: string, answers: AnamnesisAnswers): Promise<void> {
  return apiFetch<void>('/public/anamneses/rascunho', {
    method: 'POST',
    body: { token, answers },
  });
}

/**
 * Envia para revisao e consome o convite. `answers` ausente reenvia o rascunho
 * salvo; a tela sempre manda o estado atual para nao perder o que foi digitado
 * depois do ultimo "salvar".
 */
export function enviarAnamnesePublica(
  token: string,
  answers: AnamnesisAnswers,
  signed: boolean,
): Promise<AnamnesisPublicSubmitResponse> {
  return apiFetch<AnamnesisPublicSubmitResponse>('/public/anamneses/enviar', {
    method: 'POST',
    body: { token, answers, signed },
  });
}
