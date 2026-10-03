import { type FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useAuth } from '@/components/auth/AuthProvider';
import { ApiError } from '@/lib/api';
import type { ClinicaResumo } from '@/lib/auth';

interface EstadoNavegacao {
  de?: string;
}

/**
 * Login em dois passos.
 *
 * Quando o usuario tem mais de uma clinica, a API responde
 * `escolha_de_clinica` em vez de emitir sessao. A escolha e obrigatoria
 * porque o access token carrega `clinicId` e `membershipId`: chutar a
 * clinica errada faria o usuario autenticado enxergar dados de outra.
 */
export function LoginPage() {
  const { estado, entrar } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [clinicas, setClinicas] = useState<ClinicaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (estado.status === 'autenticado') {
    const destino = (location.state as EstadoNavegacao | null)?.de ?? '/';
    return <Navigate to={destino} replace />;
  }

  async function enviar(clinicId?: string): Promise<void> {
    setEnviando(true);
    setErro(null);

    try {
      const resultado = await entrar(email, senha, clinicId);

      if (resultado.status === 'escolha_de_clinica') {
        setClinicas(resultado.clinicas);
      }
    } catch (error) {
      setErro(
        error instanceof ApiError ? error.message : 'Nao foi possivel entrar. Tente novamente.',
      );
    } finally {
      setEnviando(false);
    }
  }

  function aoSubmeter(evento: FormEvent): void {
    evento.preventDefault();
    void enviar();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Entrar</h1>
        <p className="text-sm text-slate-600">
          Acesso restrito a profissionais e administracao das clinicas.
        </p>
      </header>

      {clinicas === null ? (
        <form
          onSubmit={aoSubmeter}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        >
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">E-mail</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Senha</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={senha}
              onChange={(evento) => setSenha(evento.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none"
            />
          </label>

          {erro ? (
            <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {erro}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
          >
            {enviando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      ) : (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">Escolha a clinica</h2>
          <p className="text-sm text-slate-600">
            Seu usuario tem acesso a mais de uma clinica. A sessao fica restrita a escolhida.
          </p>

          <ul className="space-y-2">
            {clinicas.map((clinica) => (
              <li key={clinica.id}>
                <button
                  type="button"
                  disabled={enviando}
                  onClick={() => void enviar(clinica.id)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-left text-sm text-slate-800 hover:border-brand-400 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-60"
                >
                  <span className="font-medium">{clinica.nome}</span>
                  <span className="ml-2 text-xs text-slate-500">{clinica.role}</span>
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setClinicas(null)}
            className="text-xs text-slate-500 underline hover:text-slate-700"
          >
            Voltar
          </button>
        </section>
      )}
    </main>
  );
}
