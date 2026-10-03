import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { refreshSession } from '@/lib/api';
import { buscarPerfil, login, type LoginResultado, logout, type Perfil } from '@/lib/auth';

export type EstadoSessao =
  { status: 'carregando' } | { status: 'anonimo' } | { status: 'autenticado'; perfil: Perfil };

interface ContextoSessao {
  estado: EstadoSessao;
  entrar: (email: string, senha: string, clinicId?: string) => Promise<LoginResultado>;
  sair: () => Promise<void>;
}

const Contexto = createContext<ContextoSessao | null>(null);

/**
 * Fonte unica da sessao no frontend.
 *
 * O bootstrap sempre tenta `refreshSession` antes de decidir que nao ha
 * sessao: o access token vive so em memoria e se perde no F5, mas o cookie
 * httpOnly continua valido. Sem essa tentativa, todo recarregamento
 * derrubaria o usuario para a tela de login.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoSessao>({ status: 'carregando' });

  useEffect(() => {
    let ativo = true;

    void (async () => {
      const renovou = await refreshSession();

      if (!ativo) return;

      if (!renovou) {
        setEstado({ status: 'anonimo' });
        return;
      }

      try {
        // O refresh sozinho nao responde *quem* e o usuario nem confirma que
        // a membership segue valida; o `/me` faz as duas coisas.
        const perfil = await buscarPerfil();
        if (ativo) setEstado({ status: 'autenticado', perfil });
      } catch {
        if (ativo) setEstado({ status: 'anonimo' });
      }
    })();

    return () => {
      ativo = false;
    };
  }, []);

  const entrar = useCallback(async (email: string, senha: string, clinicId?: string) => {
    const resultado = await login(email, senha, clinicId);
    if (resultado.status === 'autenticado') {
      setEstado({ status: 'autenticado', perfil: resultado.perfil });
    }
    return resultado;
  }, []);

  const sair = useCallback(async () => {
    await logout();
    setEstado({ status: 'anonimo' });
  }, []);

  const valor = useMemo<ContextoSessao>(() => ({ estado, entrar, sair }), [estado, entrar, sair]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAuth(): ContextoSessao {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  }
  return contexto;
}
