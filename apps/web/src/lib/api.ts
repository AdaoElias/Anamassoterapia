import { QueryClient } from '@tanstack/react-query';

import { env } from './env';
import { getAccessToken, setAccessToken } from './token';

/**
 * Cliente HTTP unico. Centraliza baseURL, o `Authorization` do access token,
 * `credentials` (obrigatorio para o cookie httpOnly de refresh) e o
 * tratamento de erro padronizado da API.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, requestId: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }

  /** 401 significa token expirado: `apiFetch` tenta o refresh uma vez. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  raw?: boolean;
  /** Desliga o retry pos-refresh. O proprio `/auth/refresh` usa. */
  skipAuthRetry?: boolean;
};

let refreshInFlight: Promise<boolean> | null = null;

function montarInit(options: RequestOptions, token: string | null): RequestInit {
  const { body, raw, headers, skipAuthRetry: _skip, ...rest } = options;

  return {
    ...rest,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: raw ? (body as BodyInit) : JSON.stringify(body) }),
  };
}

async function interpretar<T>(response: Response, path: string): Promise<T> {
  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const fallback = {
      code: 'HTTP_ERROR',
      message: `Erro ${response.status} ao chamar ${path}`,
      requestId: response.headers.get('x-request-id'),
    };
    const data = (payload ?? fallback) as {
      code?: string;
      error?: string;
      message?: string;
      requestId?: string;
    };
    throw new ApiError(
      response.status,
      data.error ?? data.code ?? fallback.code,
      data.message ?? fallback.message,
      data.requestId ?? fallback.requestId,
    );
  }

  return payload as T;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await fetch(`${env.VITE_API_URL}${path}`, montarInit(options, getAccessToken()));

  // 401 com token em maos e token expirado: renova uma vez e repete a
  // requisicao. As duas guardas importam -- sem `getAccessToken()`, um 401
  // de credencial errada no login dispararia refresh a toa; sem
  // `skipAuthRetry`, o `/auth/refresh` que ja retornou 401 tentaria se
  // renovar, em recursao.
  if (response.status === 401 && options.skipAuthRetry !== true && getAccessToken() !== null) {
    if (await refreshSession()) {
      response = await fetch(`${env.VITE_API_URL}${path}`, montarInit(options, getAccessToken()));
    }
  }

  return interpretar<T>(response, path);
}

/**
 * Tenta um unico refresh em paralelo. Varias chamadas que falham com 401
 * ao mesmo tempo compartilham a mesma promessa: senao cada uma dispara
 * um refresh e a ultima revoga os tokens das anteriores.
 */
export async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const resposta = await apiFetch<{ accessToken: string }>('/auth/refresh', {
        method: 'POST',
        skipAuthRetry: true,
      });
      setAccessToken(resposta.accessToken);
      return true;
    } catch {
      // Refresh invalido/expirado/reutilizado: a sessao acabou. Zerar o
      // token evita requisicoes seguintes com credencial morta.
      setAccessToken(null);
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export function buildQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
