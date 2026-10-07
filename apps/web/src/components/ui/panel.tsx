import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function PageHeader({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-medium tracking-tight text-slate-900">
          {titulo}
        </h1>
        {descricao !== undefined ? <p className="text-sm text-slate-500">{descricao}</p> : null}
      </div>
      {acoes !== undefined ? <div className="flex items-center gap-2">{acoes}</div> : null}
    </header>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn('rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel', className)}
    >
      {children}
    </section>
  );
}

/** Cartao de metrica do dashboard: chip com icone, numero em serifa e rotulo. */
export function CardMetrica({
  icone,
  valor,
  rotulo,
  detalhe,
  tom,
}: {
  icone: ReactNode;
  valor: string | number;
  rotulo: string;
  detalhe?: string | undefined;
  tom?: 'brand' | 'clay' | 'neutral';
}) {
  const chip =
    tom === 'clay'
      ? 'bg-clay-100 text-clay-700'
      : tom === 'brand'
        ? 'bg-brand-100 text-brand-700'
        : 'bg-slate-100 text-slate-600';
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-panel">
      <div className={`grid size-11 shrink-0 place-items-center rounded-full ${chip}`}>{icone}</div>
      <div className="min-w-0">
        <p className="font-display text-2xl font-medium tracking-tight text-slate-900">{valor}</p>
        <p className="truncate text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {rotulo}
        </p>
        {detalhe !== undefined ? <p className="mt-1 text-xs text-slate-400">{detalhe}</p> : null}
      </div>
    </div>
  );
}

export function EstadoVazio({ mensagem }: { mensagem: string }) {
  return <p className="py-12 text-center text-sm text-slate-400">{mensagem}</p>;
}

export function Carregando() {
  return <p className="py-12 text-center text-sm text-slate-400">Carregando...</p>;
}

export function CaixaErro({ mensagem }: { mensagem: string }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
    >
      {mensagem}
    </p>
  );
}
