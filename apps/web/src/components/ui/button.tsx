import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type Variante = 'primaria' | 'secundaria' | 'perigo' | 'fantasma';
type Tamanho = 'md' | 'sm';

const BASE =
  'inline-flex items-center justify-center gap-1 rounded-md font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';

const VARIANTES: Record<Variante, string> = {
  primaria: 'bg-brand-600 text-white hover:bg-brand-700',
  secundaria: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  perigo: 'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50',
  fantasma: 'text-slate-600 hover:bg-slate-100',
};

const TAMANHOS: Record<Tamanho, string> = {
  md: 'px-4 py-2 text-sm',
  sm: 'px-2.5 py-1.5 text-xs',
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
