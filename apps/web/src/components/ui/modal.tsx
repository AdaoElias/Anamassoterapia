import { type ReactNode, useEffect } from 'react';

/**
 * Modal simples. Fecha no Escape e no clique do fundo. O foco nao e
 * aprisionado: e uma tela de cadastro, nao um dialogo destrutivo, e o
 * esforco de focus trap nao se paga nesta etapa.
 */
export function Modal({
  aberto,
  titulo,
  onFechar,
  children,
}: {
  aberto: boolean;
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!aberto) return;

    function aoTeclar(evento: KeyboardEvent): void {
      if (evento.key === 'Escape') onFechar();
    }

    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onFechar}
        className="absolute inset-0 cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="relative mt-10 w-full max-w-2xl animate-panel-up rounded-3xl bg-white shadow-lift"
      >
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <h2 className="font-display text-lg font-semibold tracking-tight text-slate-900">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="grid size-8 shrink-0 place-items-center rounded-full text-xl leading-none text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            &times;
          </button>
        </div>
        <div className="border-t border-slate-100 px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
