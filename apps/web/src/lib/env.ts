/**
 * Variaveis de ambiente do frontend. Tipadas via `src/vite-env.d.ts`.
 * So o prefixo VITE_ e exposto ao bundle -- nunca colocar segredo aqui.
 */
export const env = {
  VITE_API_URL: import.meta.env.VITE_API_URL ?? '/api',
  VITE_APP_NAME: import.meta.env.VITE_APP_NAME ?? 'Massoterapia',
  VITE_WEB_URL: import.meta.env.VITE_WEB_URL ?? 'http://localhost:5173',
} as const;
