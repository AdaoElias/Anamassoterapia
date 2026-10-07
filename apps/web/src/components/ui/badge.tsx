import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const TONE_STYLES = {
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  success: 'bg-brand-100 text-brand-800 ring-brand-200',
  warning: 'bg-clay-100 text-clay-800 ring-clay-300',
  danger: 'bg-rose-100 text-rose-700 ring-rose-200',
  brand: 'bg-brand-100 text-brand-800 ring-brand-300',
} as const;

type Tone = keyof typeof TONE_STYLES;

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = 'neutral', className, ...props }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        TONE_STYLES[tone],
        className,
      )}
      {...props}
    />
  );
}
