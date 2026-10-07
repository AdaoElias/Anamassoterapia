import { CalendarCheck2, HeartPulse, Leaf, Sparkles } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import type { ClinicaResumo } from '@/lib/auth';

interface EstadoNavegacao {
  de?: string;
}

const BENEFICIOS = [
  { icone: CalendarCheck2, texto: 'Agenda que se organiza sozinha' },
  { icone: HeartPulse, texto: 'Prontuario completo com anamnese' },
  { icone: Leaf, texto: 'Bem-estar em cada detalhe da rotina' },
  { icone: Sparkles, texto: 'Financeiro e pacotes sem planilha' },
];

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
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Painel da marca. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-950 p-12 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_at_-10%_-10%,oklch(0.45_0.1_150/0.5),transparent_60%),radial-gradient(26rem_at_110%_110%,oklch(0.45_0.11_35/0.4),transparent_60%)]"
        />
        <div className="relative flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-clay-500 text-white shadow-lift">
            <Leaf size={24} strokeWidth={2.2} />
          </span>
          <div>
            <p className="font-display text-xl font-semibold tracking-tight text-white">
              Clínica Wave
            </p>
            <p className="text-xs text-brand-200/70">massoterapia & bem-estar</p>
          </div>
        </div>

        <div className="relative max-w-md space-y-8">
          <h1 className="font-display text-4xl leading-tight font-medium tracking-tight text-white">
            O cuidado que sua clinica merece.
          </h1>
          <ul className="space-y-4">
            {BENEFICIOS.map((beneficio) => {
              const Icone = beneficio.icone;
              return (
                <li key={beneficio.texto} className="flex items-center gap-3 text-brand-100">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 text-brand-200">
                    <Icone size={17} />
                  </span>
                  <span className="text-sm font-medium">{beneficio.texto}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="relative text-xs text-brand-200/50">
          Acesso restrito a profissionais e administracao das clinicas.
        </p>
      </aside>

      {/* Formulario. */}
      <main className="flex flex-col items-center justify-center gap-8 p-6 sm:p-10">
        <div className="flex w-full max-w-sm flex-col items-center gap-2 lg:hidden">
          <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-clay-500 text-white shadow-lift">
            <Leaf size={24} strokeWidth={2.2} />
          </span>
          <p className="font-display text-xl font-semibold tracking-tight text-slate-900">
            Clínica Wave
          </p>
        </div>

        <div className="w-full max-w-sm">
          {clinicas === null ? (
            <form onSubmit={aoSubmeter} className="space-y-5">
              <header className="space-y-1">
                <h1 className="font-display text-3xl font-medium tracking-tight text-slate-900">
                  Entrar
                </h1>
                <p className="text-sm text-slate-500">
                  Acesso restrito a profissionais e administracao das clinicas.
                </p>
              </header>

              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">E-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(evento) => setEmail(evento.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 transition-shadow focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700">Senha</span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={senha}
                  onChange={(evento) => setSenha(evento.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 transition-shadow focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none"
                />
              </label>

              {erro ? (
                <p
                  role="alert"
                  className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
                >
                  {erro}
                </p>
              ) : null}

              <Button type="submit" disabled={enviando} className="w-full" tamanho="md">
                {enviando ? 'Entrando...' : 'Entrar'}
              </Button>
            </form>
          ) : (
            <section className="space-y-3">
              <header className="space-y-1">
                <h1 className="font-display text-3xl font-medium tracking-tight text-slate-900">
                  Escolha a clinica
                </h1>
                <p className="text-sm text-slate-500">
                  Seu usuario tem acesso a mais de uma clinica. A sessao fica restrita a escolhida.
                </p>
              </header>

              <ul className="space-y-2">
                {clinicas.map((clinica) => (
                  <li key={clinica.id}>
                    <button
                      type="button"
                      disabled={enviando}
                      onClick={() => void enviar(clinica.id)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-left text-sm text-slate-800 transition-colors hover:border-brand-400 hover:bg-brand-50 focus-visible:ring-4 focus-visible:ring-brand-100 focus-visible:outline-none disabled:opacity-60"
                    >
                      <span className="font-semibold">{clinica.nome}</span>
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
        </div>
      </main>
    </div>
  );
}
