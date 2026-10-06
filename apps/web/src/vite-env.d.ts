/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    /** Base da API. Padrao '/api' porque o dev usa o proxy do Vite. */
    readonly VITE_API_URL?: string;
    readonly VITE_APP_NAME?: string;
    readonly VITE_WEB_URL?: string;
  }
}

export {};
