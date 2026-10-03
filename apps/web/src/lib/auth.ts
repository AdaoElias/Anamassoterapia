import { apiFetch } from './api';
import { setAccessToken } from './token';

/**
 * Operacoes de autenticacao sobre o cliente HTTP.
 *
 * O access token nunca sai daqui para o estado do React: fica em
 * `lib/token.ts` e e lido pelo `apiFetch`. O componente so guarda o perfil.
 */
export type Role = 'ADMIN' | 'PROFISSIONAL' | 'CLIENTE';

export interface Perfil {
  userId: string;
  name: string;
  email: string;
  role: Role;
  clinicId: string;
  clinicName: string;
  professionalId: string | null;
}

export interface ClinicaResumo {
  id: string;
  nome: string;
  role: Role;
}

/**
 * Uniao discriminada por `status`. `escolha_de_clinica` nao e erro: e um
 * login valido que precisa da clinica antes de emitir sessao, porque o
 * backend se recusa a escolher por conta propria quando ha mais de uma.
 */
export type LoginResultado =
  | { status: 'autenticado'; accessToken: string; expiresInSeconds: number; perfil: Perfil }
  | { status: 'escolha_de_clinica'; clinicas: ClinicaResumo[] };

export async function login(
  email: string,
  senha: string,
  clinicId?: string,
): Promise<LoginResultado> {
  const resultado = await apiFetch<LoginResultado>('/auth/login', {
    method: 'POST',
    // Credencial errada e 401 legitimo, nao expiracao de token: nao deve
    // disparar refresh.
    skipAuthRetry: true,
    body: { email, senha, ...(clinicId === undefined ? {} : { clinicId }) },
  });

  if (resultado.status === 'autenticado') {
    setAccessToken(resultado.accessToken);
  }

  return resultado;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST' });
  } finally {
    // Mesmo se o logout falhar na rede, a sessao local acaba aqui. Deixar o
    // token na memoria faria a UI parecer logada depois do "sair".
    setAccessToken(null);
  }
}

export async function buscarPerfil(): Promise<Perfil> {
  return apiFetch<Perfil>('/auth/me');
}
