import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router';

import { useAuth } from '@/components/auth/AuthProvider';
import { AppLayout } from '@/components/layout/AppLayout';
import { AgendaPage } from '@/pages/AgendaPage';
import { AnamnesePublicaPage } from '@/pages/AnamnesePublicaPage';
import { ClientesPage } from '@/pages/ClientesPage';
import { ClinicaPage } from '@/pages/ClinicaPage';
import { ContraindicacoesPage } from '@/pages/ContraindicacoesPage';
import { DisponibilidadePage } from '@/pages/DisponibilidadePage';
import { FinanceiroPage } from '@/pages/FinanceiroPage';
import { FormulariosPage } from '@/pages/FormulariosPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { NotificacoesPage } from '@/pages/NotificacoesPage';
import { PortalPage } from '@/pages/PortalPage';
import { ProfissionaisPage } from '@/pages/ProfissionaisPage';
import { ProntuarioPage } from '@/pages/ProntuarioPage';
import { TerapiasPage } from '@/pages/TerapiasPage';

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
        <AppLayout />
      </RotaProtegida>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'agenda', element: <AgendaPage /> },
      { path: 'disponibilidade', element: <DisponibilidadePage /> },
      { path: 'terapias', element: <TerapiasPage /> },
      { path: 'profissionais', element: <ProfissionaisPage /> },
      { path: 'clientes', element: <ClientesPage /> },
      // O prontuario e por cliente: nao ha link no menu porque nao existe um
      // "prontuario" sem saber de quem.
      { path: 'clientes/:clientId/prontuario', element: <ProntuarioPage /> },
      { path: 'formularios', element: <FormulariosPage /> },
      { path: 'contraindicacoes', element: <ContraindicacoesPage /> },
      { path: 'financeiro', element: <FinanceiroPage /> },
      { path: 'notificacoes', element: <NotificacoesPage /> },
      { path: 'clinica', element: <ClinicaPage /> },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  // Portal publico de agendamento: acessivel sem login, identificado pelo slug.
  { path: '/agendar/:slug', element: <PortalPage /> },
  { path: '/agendar', element: <Navigate to="/" replace /> },
  // Anamnese respondida pelo cliente: acessivel sem login, identificada pelo
  // token do link. Fora de `RotaProtegida` porque o cliente nao tem sessao.
  { path: '/anamnese/:token', element: <AnamnesePublicaPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);
