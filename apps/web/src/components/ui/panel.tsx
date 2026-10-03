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
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{titulo}</h1>
        {descricao !== undefined ? <p className="text-sm text-slate-600">{descricao}</p> : null}
      </div>
      {acoes !== undefined ? <div className="flex gap-2">{acoes}</div> : null}
    </header>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white p-5 shadow-sm', className)}>
      {children}
    </section>
  );
}

export function EstadoVazio({ mensagem }: { mensagem: string }) {
  return <p className="py-8 text-center text-sm text-slate-500">{mensagem}</p>;
}

export function Carregando() {
  return <p className="py-8 text-center text-sm text-slate-500">Carregando...</p>;
}

export function CaixaErro({ mensagem }: { mensagem: string }) {
  return (
    <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {mensagem}
    </p>
  );
}
