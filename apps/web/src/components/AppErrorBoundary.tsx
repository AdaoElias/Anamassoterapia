import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
}

/**
 * Rede de seguranca da UI. Sem isso, um erro de render derruba a arvore
 * inteira e o cliente ve tela branca no meio do agendamento.
 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Erro inesperado',
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Em producao isso deve ir para um tracker de erro (Sentry, etc.).
    console.error('Falha ao renderizar a aplicacao', error, info.componentStack);
  }

  override render(): ReactNode {
    const { hasError, message } = this.state;

    if (!hasError) return this.props.children;

    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Algo deu errado</h1>
        <p className="text-sm text-slate-600">
          Nenhum dado foi perdido. Recarregue a pagina para tentar novamente.
        </p>
        {message ? (
          <p className="rounded-md bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">
            {message}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Recarregar
        </button>
      </main>
    );
  }
}
