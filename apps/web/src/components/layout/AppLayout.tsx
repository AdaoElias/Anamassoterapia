import {
  Bell,
  Building2,
  CalendarDays,
  ClipboardList,
  Clock,
  HeartHandshake,
  LayoutGrid,
  LogOut,
  type LucideProps,
  Menu,
  ShieldAlert,
  Sparkles,
  Users,
  Wallet,
  Waves,
  X,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';

import { useAuth } from '@/components/auth/AuthProvider';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';

interface ItemMenu {
  to: string;
  rotulo: string;
  icone: ComponentType<LucideProps>;
  fim?: boolean;
}

interface GrupoMenu {
  rotulo: string;
  itens: ItemMenu[];
}

const GRUPOS: GrupoMenu[] = [
  {
    rotulo: 'Inicio',
    itens: [{ to: '/', rotulo: 'Painel', icone: LayoutGrid, fim: true }],
  },
  {
    rotulo: 'Atendimento',
    itens: [
      { to: '/agenda', rotulo: 'Agenda', icone: CalendarDays },
      { to: '/disponibilidade', rotulo: 'Disponibilidade', icone: Clock },
      { to: '/clientes', rotulo: 'Clientes', icone: Users },
    ],
  },
  {
    rotulo: 'Gestao',
    itens: [
      { to: '/terapias', rotulo: 'Terapias', icone: Sparkles },
      { to: '/profissionais', rotulo: 'Profissionais', icone: HeartHandshake },
      { to: '/financeiro', rotulo: 'Financeiro', icone: Wallet },
      { to: '/formularios', rotulo: 'Formularios', icone: ClipboardList },
      { to: '/contraindicacoes', rotulo: 'Contraindicacoes', icone: ShieldAlert },
      { to: '/notificacoes', rotulo: 'Notificacoes', icone: Bell },
      { to: '/clinica', rotulo: 'Clinica', icone: Building2 },
    ],
  },
];

const ROTULOS_DE_PAPEL: Record<string, string> = {
  ADMIN: 'Administracao',
  PROFISSIONAL: 'Profissional',
  CLIENTE: 'Cliente',
};

function Marca() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-clay-500 text-white shadow-lift">
        <Waves size={22} strokeWidth={2.2} />
      </span>
      <div className="min-w-0">
        <p className="font-display text-lg leading-tight font-semibold tracking-tight text-white">
          Clínica Wave
        </p>
        <p className="truncate text-xs text-brand-200/70">massoterapia & bem-estar</p>
      </div>
    </div>
  );
}

function Navegacao({ onNavegar }: { onNavegar?: () => void }) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-6">
      {GRUPOS.map((grupo) => (
        <div key={grupo.rotulo} className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-bold tracking-widest text-brand-200/50 uppercase">
            {grupo.rotulo}
          </p>
          {grupo.itens.map((item) => {
            const Icone = item.icone;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.fim ?? false}
                onClick={onNavegar}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                    isActive
                      ? 'bg-white/10 text-white ring-1 ring-white/10'
                      : 'text-brand-200/80 hover:bg-white/5 hover:text-white',
                  )
                }
              >
                <Icone size={18} strokeWidth={2} className="shrink-0" />
                <span className="truncate">{item.rotulo}</span>
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function RodapeSessao({ onNavegar }: { onNavegar?: () => void }) {
  const { estado, sair } = useAuth();
  const perfil = estado.status === 'autenticado' ? estado.perfil : null;

  return (
    <div className="space-y-3 border-t border-white/10 p-4">
      {perfil ? (
        <div className="flex items-center gap-3">
          <Avatar nome={perfil.name} className="size-9 text-xs" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{perfil.name}</p>
            <p className="truncate text-xs text-brand-200/60">
              {perfil.clinicName} · {ROTULOS_DE_PAPEL[perfil.role] ?? perfil.role}
            </p>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => void sair().then(onNavegar)}
        className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-brand-200/80 transition-colors hover:bg-white/5 hover:text-white"
      >
        <LogOut size={16} />
        Sair
      </button>
    </div>
  );
}

export function AppLayout() {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Sidebar fixa (desktop). */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col bg-brand-950 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(22rem_at_-20%_-10%,oklch(0.45_0.1_150/0.5),transparent_60%),radial-gradient(20rem_at_120%_110%,oklch(0.45_0.11_35/0.35),transparent_60%)]"
        />
        <div className="relative px-5 pt-7 pb-4">
          <Marca />
        </div>
        <Navegacao />
        <RodapeSessao />
      </aside>

      {/* Barra superior do mobile. */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/80 bg-slate-50/90 px-4 py-3 backdrop-blur lg:hidden">
        <Marca />
        <button
          type="button"
          aria-label="Abrir menu"
          onClick={() => setMenuAberto(true)}
          className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-panel"
        >
          <Menu size={20} />
        </button>
      </header>

      {/* Gaveta do mobile. */}
      {menuAberto ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMenuAberto(false)}
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-brand-950 shadow-lift">
            <div className="flex items-start justify-between px-5 pt-7 pb-4">
              <Marca />
              <button
                type="button"
                aria-label="Fechar menu"
                onClick={() => setMenuAberto(false)}
                className="grid size-9 place-items-center rounded-full bg-white/10 text-white"
              >
                <X size={18} />
              </button>
            </div>
            <Navegacao onNavegar={() => setMenuAberto(false)} />
            <RodapeSessao onNavegar={() => setMenuAberto(false)} />
          </aside>
        </div>
      ) : null}

      {/* Conteudo. */}
      <div className="lg:pl-[264px]">
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-64 bg-[radial-gradient(900px_260px_at_50%_-40px,oklch(0.93_0.045_150/0.7),transparent_70%)]"
          />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
