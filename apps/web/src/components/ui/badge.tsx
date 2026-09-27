import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const TONE_STYLES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
} as const;

type Tone = keyof typeof TONE_STYLES;

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = 'neutral', className, ...props }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONE_STYLES[tone],
        className,
      )}
      {...props}
    />
  );
}
