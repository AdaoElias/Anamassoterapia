import { type Appointment, APPOINTMENT_STATUS_LABELS } from '@massoterapia/shared';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Bell,
  CalendarCheck2,
  CalendarDays,
  Clock,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router';

import { useAuth } from '@/components/auth/AuthProvider';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { CardMetrica, Panel } from '@/components/ui/panel';
import { listarAgendamentos } from '@/lib/agenda';
import { apiFetch } from '@/lib/api';
import { listarClientes, listarTerapias } from '@/lib/cadastros';
import { dataDeHojeISO, formatarHoraISO, formatBRL } from '@/lib/format';

interface HealthPayload {
  status: string;
  version: string;
}

const TOM_POR_STATUS: Record<
  Appointment['status'],
  'success' | 'warning' | 'danger' | 'brand' | 'neutral'
> = {
  AGENDADO_PENDENTE: 'warning',
  CONFIRMADO: 'success',
  EM_ATENDIMENTO: 'brand',
  CONCLUIDO: 'success',
  CANCELADO: 'neutral',
  NO_SHOW: 'danger',
};

const ATALHOS = [
  { to: '/agenda', rotulo: 'Agenda', icone: CalendarDays, descricao: 'Sessoes do dia' },
  { to: '/clientes', rotulo: 'Clientes', icone: Users, descricao: 'Cadastro e prontuario' },
  { to: '/financeiro', rotulo: 'Financeiro', icone: Wallet, descricao: 'Caixa e pacotes' },
  { to: '/terapias', rotulo: 'Terapias', icone: Sparkles, descricao: 'Cardapio e precos' },
  {
    to: '/disponibilidade',
    rotulo: 'Disponibilidade',
    icone: Clock,
    descricao: 'Horarios e folgas',
  },
  { to: '/notificacoes', rotulo: 'Notificacoes', icone: Bell, descricao: 'Avisos enviados' },
];

function saudacaoPorHorario(): string {
  const hora = new Date().getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

function hojePorExtenso(): string {
  const texto = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function HomePage() {
  const { estado } = useAuth();
  const perfil = estado.status === 'autenticado' ? estado.perfil : null;

  const hoje = dataDeHojeISO();

  const agenda = useQuery({
    queryKey: ['agenda', 'hoje', hoje],
    queryFn: () => listarAgendamentos({ from: hoje, to: hoje }),
  });

  const clientes = useQuery({
    queryKey: ['clientes'],
    queryFn: () => listarClientes({}),
  });

  const terapias = useQuery({
    queryKey: ['terapias'],
    queryFn: () => listarTerapias({}),
  });

  const api = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthPayload>('/health'),
    refetchInterval: 30_000,
  });

  const itensHoje = agenda.data?.items ?? [];
  const concluidasHoje = itensHoje.filter((item) => item.status === 'CONCLUIDO').length;

  const proximas = itensHoje
    .filter((item) => item.status !== 'CANCELADO' && new Date(item.startAt) >= new Date())
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, 4);

  return (
    <div className="animate-fade-in space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-clay-600">{hojePorExtenso()}</p>
          <h1 className="font-display mt-1 text-4xl font-medium tracking-tight text-slate-900">
            {saudacaoPorHorario()}
            {perfil ? `, ${perfil.name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {perfil ? `${perfil.clinicName}` : 'Painel da clinica'}
          </p>
        </div>
        <div className="flex items-center gap-2 self-center">
          {api.isError ? (
            <Badge tone="danger">API indisponivel</Badge>
          ) : (
            <>
              <Badge tone="success">API online</Badge>
              {api.data ? (
                <span className="font-mono text-xs text-slate-400">v{api.data.version}</span>
              ) : null}
            </>
          )}
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CardMetrica
          icone={<CalendarDays size={20} />}
          valor={agenda.isPending ? '…' : itensHoje.length}
          rotulo="Sessoes hoje"
          detalhe={proximas[0] ? `Proxima as ${formatarHoraISO(proximas[0].startAt)}` : 'Dia livre'}
          tom="brand"
        />
        <CardMetrica
          icone={<CalendarCheck2 size={20} />}
          valor={agenda.isPending ? '…' : concluidasHoje}
          rotulo="Concluidas hoje"
          detalhe="Sessoes finalizadas"
          tom="clay"
        />
        <CardMetrica
          icone={<Users size={20} />}
          valor={clientes.isPending ? '…' : (clientes.data?.meta.total ?? 0)}
          rotulo="Clientes ativos"
          detalhe="No cadastro da clinica"
        />
        <CardMetrica
          icone={<Sparkles size={20} />}
          valor={terapias.isPending ? '…' : (terapias.data?.meta.total ?? 0)}
          rotulo="Terapias"
          detalhe="No cardapio"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-medium tracking-tight text-slate-900">
                Hoje na clinica
              </h2>
              <p className="text-xs text-slate-500">Proximas sessoes agendadas</p>
            </div>
            <Link
              to="/agenda"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800"
            >
              Ver agenda <ArrowRight size={15} />
            </Link>
          </div>

          {agenda.isPending ? (
            <p className="py-10 text-center text-sm text-slate-400">Carregando...</p>
          ) : proximas.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              Nenhuma sessao para as proximas horas. Aproveite o respiro.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {proximas.map((item) => (
                <li key={item.id} className="flex items-center gap-4 py-3">
                  <span className="w-16 shrink-0 rounded-lg bg-brand-50 px-2 py-1.5 text-center font-mono text-sm font-semibold text-brand-800">
                    {formatarHoraISO(item.startAt)}
                  </span>
                  <Avatar nome={item.clientName} className="size-9 text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {item.clientName}
                    </p>
                    <p className="truncate text-xs text-slate-500">{item.therapyName}</p>
                  </div>
                  <span className="hidden text-sm text-slate-500 sm:block">
                    {formatBRL(item.priceCents)}
                  </span>
                  <Badge tone={TOM_POR_STATUS[item.status]}>
                    {APPOINTMENT_STATUS_LABELS[item.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h2 className="font-display mb-1 text-xl font-medium tracking-tight text-slate-900">
            Acesso rapido
          </h2>
          <p className="mb-4 text-xs text-slate-500">Para o que voce mais usa</p>
          <div className="space-y-2">
            {ATALHOS.map((atalho) => {
              const Icone = atalho.icone;
              return (
                <Link
                  key={atalho.to}
                  to={atalho.to}
                  className="group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 transition-all hover:border-brand-300 hover:shadow-panel"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-100">
                    <Icone size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">
                      {atalho.rotulo}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {atalho.descricao}
                    </span>
                  </span>
                  <ArrowRight
                    size={16}
                    className="shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-brand-600"
                  />
                </Link>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}
