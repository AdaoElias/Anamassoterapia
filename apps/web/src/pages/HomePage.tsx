import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { PageHeader, Panel } from '@/components/ui/panel';
import { apiFetch } from '@/lib/api';

interface HealthPayload {
  status: string;
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

const ATALHOS = [
  { to: '/agenda', titulo: 'Agenda', descricao: 'Sessoes do dia por profissional.' },
  { to: '/disponibilidade', titulo: 'Disponibilidade', descricao: 'Horarios, folgas e feriados.' },
  { to: '/terapias', titulo: 'Terapias', descricao: 'Cardapio, duracao e precos.' },
  { to: '/profissionais', titulo: 'Profissionais', descricao: 'Equipe e terapias habilitadas.' },
  { to: '/clientes', titulo: 'Clientes', descricao: 'Cadastro e contato.' },
  { to: '/clinica', titulo: 'Clinica', descricao: 'Perfil da unidade e salas.' },
];

export function HomePage() {
  const { estado } = useAuth();
  const perfil = estado.status === 'autenticado' ? estado.perfil : null;

  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthPayload>('/health'),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={perfil ? `Ola, ${perfil.name}` : 'Painel'}
        descricao="Gestao da clinica: cadastros, agenda e prontuario."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ATALHOS.map((atalho) => (
          <Link
            key={atalho.to}
            to={atalho.to}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/40"
          >
            <p className="text-sm font-semibold text-slate-900">{atalho.titulo}</p>
            <p className="mt-1 text-xs text-slate-500">{atalho.descricao}</p>
          </Link>
        ))}
      </div>

      <Panel>
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Estado da API
        </h2>
        {isPending ? (
          <p className="mt-3 text-sm text-slate-500">Consultando...</p>
        ) : isError ? (
          <div className="mt-3">
            <Badge tone="danger">Indisponivel</Badge>
            <p className="mt-2 text-sm text-slate-600">A API nao respondeu.</p>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="success">Online</Badge>
            <span className="font-mono text-xs text-slate-500">v{data.version}</span>
            <span className="text-xs text-slate-500">
              uptime {Math.round(data.uptimeSeconds / 60)} min
            </span>
          </div>
        )}
      </Panel>
    </div>
  );
}
