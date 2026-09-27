import { createBrowserRouter, Navigate } from 'react-router';

import { HomePage } from '@/pages/HomePage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <HomePage />,
  },
  // O portal publico de agendamento entra na Etapa 4.
  { path: '/agendar', element: <Navigate to="/" replace /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);
