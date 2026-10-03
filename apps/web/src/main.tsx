import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { buildQueryClient } from '@/lib/api';
import { router } from '@/router';

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root nao encontrado no index.html');

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={buildQueryClient()}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
