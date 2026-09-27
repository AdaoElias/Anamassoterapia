import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';

interface HealthPayload {
  status: string;
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

export function HomePage() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthPayload>('/health'),
    refetchInterval: 30_000,
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Massoterapia</h1>
        <p className="text-slate-600">
          Plataforma de agendamento e gestao para clinicas de massoterapia.
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Estado da API
        </h2>

        {isPending ? (
          <p className="mt-3 text-sm text-slate-500">Consultando...</p>
        ) : isError ? (
          <div className="mt-3">
            <Badge tone="danger">Indisponivel</Badge>
            <p className="mt-2 text-sm text-slate-600">
              A API nao respondeu. Verifique se o servidor esta rodando em{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                pnpm dev:api
              </code>
              .
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">Online</Badge>
              <span className="font-mono text-xs text-slate-500">v{data.version}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
              <dt>Servico</dt>
              <dd className="font-mono text-xs">{data.service}</dd>
              <dt>Uptime</dt>
              <dd>{Math.round(data.uptimeSeconds / 60)} min</dd>
            </dl>
          </div>
        )}
      </section>

      <p className="text-xs text-slate-400">
        Etapa 0 concluida. As telas de cadastro, agenda e prontuario entram a partir da Etapa 3.
      </p>
    </main>
  );
}
