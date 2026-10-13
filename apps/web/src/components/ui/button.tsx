import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type Variante = 'primaria' | 'secundaria' | 'perigo' | 'fantasma';
type Tamanho = 'md' | 'sm';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]';

const VARIANTES: Record<Variante, string> = {
  primaria:
    'bg-gradient-to-br from-brand-600 to-clay-400 text-white shadow-glow hover:brightness-110 hover:shadow-lift',
  secundaria:
    'border border-slate-300/90 bg-surface text-slate-700 shadow-panel hover:border-brand-400 hover:bg-brand-50/70 hover:text-brand-900',
  perigo:
    'border border-rose-500/40 bg-surface text-rose-300 hover:border-rose-400 hover:bg-rose-500/10 hover:text-rose-200',
  fantasma: 'text-slate-600 hover:bg-brand-100/60 hover:text-brand-900',
};

const TAMANHOS: Record<Tamanho, string> = {
  md: 'px-5 py-2.5 text-sm',
  sm: 'px-3.5 py-1.5 text-xs',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
}

export function Button({ variante = 'primaria', tamanho = 'md', className, ...props }: Props) {
  return (
    <button className={cn(BASE, VARIANTES[variante], TAMANHOS[tamanho], className)} {...props} />
  );
}
