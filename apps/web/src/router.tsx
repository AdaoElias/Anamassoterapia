import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router';

import { useAuth } from '@/components/auth/AuthProvider';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';

function Splash() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <p className="text-sm text-slate-500">Carregando...</p>
    </main>
  );
}

/**
 * Enquanto o bootstrap da sessao nao termina, a rota nao decide entre
 * redirecionar e renderizar. Tratar `carregando` como `anonimo` jogaria o
 * usuario para o login em todo F5, mesmo com sessao valida no cookie.
 */
function RotaProtegida({ children }: { children: ReactNode }) {
  const { estado } = useAuth();
  const location = useLocation();

  if (estado.status === 'carregando') return <Splash />;

  if (estado.status === 'anonimo') {
    return <Navigate to="/login" replace state={{ de: location.pathname }} />;
  }

  return children;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <RotaProtegida>
        <HomePage />
      </RotaProtegida>
    ),
  },
  { path: '/login', element: <LoginPage /> },
  // O portal publico de agendamento entra na Etapa 4.
  { path: '/agendar', element: <Navigate to="/" replace /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);
