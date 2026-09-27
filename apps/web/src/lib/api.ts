import { QueryClient } from '@tanstack/react-query';

import { env } from './env';

/**
 * Cliente HTTP unico. Centraliza baseURL, `credentials` (obrigatorio para o
 * cookie httpOnly de refresh) e o tratamento de erro padronizado da API.
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

  /** 401 significa token expirado: o AuthProvider tenta o refresh uma vez. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; raw?: boolean };

let refreshInFlight: Promise<boolean> | null = null;

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, raw, headers, ...rest } = options;

  const response = await fetch(`${env.VITE_API_URL}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: raw ? (body as BodyInit) : JSON.stringify(body) }),
  });

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

/**
 * Tenta um unico refresh em paralelo. Varias chamadas que falham com 401
 * ao mesmo tempo compartilham a mesma promessa: senao cada uma dispara
 * um refresh e a ultima revoga os tokens das anteriores.
 */
export async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      await apiFetch<{ accessToken: string }>('/api/auth/refresh', { method: 'POST' });
      return true;
    } catch {
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
