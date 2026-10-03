import { NavLink, Outlet } from 'react-router';

import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { env } from '@/lib/env';

const LINKS: Array<{ to: string; rotulo: string; fim: boolean }> = [
  { to: '/', rotulo: 'Painel', fim: true },
  { to: '/terapias', rotulo: 'Terapias', fim: false },
  { to: '/profissionais', rotulo: 'Profissionais', fim: false },
  { to: '/clientes', rotulo: 'Clientes', fim: false },
  { to: '/clinica', rotulo: 'Clinica', fim: false },
];

export function AppLayout() {
  const { estado, sair } = useAuth();
  const perfil = estado.status === 'autenticado' ? estado.perfil : null;

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{env.VITE_APP_NAME}</p>
            <p className="truncate text-xs text-slate-500">
              {perfil ? `${perfil.clinicName} · ${perfil.name}` : ''}
            </p>
          </div>
          <Button variante="secundaria" tamanho="sm" onClick={() => void sair()}>
            Sair
          </Button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.fim}
              className={({ isActive }) =>
                cn(
                  'border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
                  isActive
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900',
                )
              }
            >
              {link.rotulo}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
