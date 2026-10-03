/**
 * Access token em memoria, e **nao** em `localStorage`/`sessionStorage`.
 *
 * Qualquer XSS que rode no mesmo documento le `localStorage` e
 * `sessionStorage` -- guardar um JWT la e entrega-lo ao atacante. Uma
 * variavel de modulo nao esta em lugar nenhum persistido e morre com a aba.
 *
 * O custo e o F5: sem token na memoria, a sessao e reconstruida pelo cookie
 * httpOnly via `/auth/refresh`. Esse e exatamente o fluxo desejado, e por
 * isso o bootstrap da aplicacao sempre passa pelo refresh antes de decidir
 * se ha sessao.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
