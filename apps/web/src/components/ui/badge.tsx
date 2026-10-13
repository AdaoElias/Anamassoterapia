import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const TONE_STYLES = {
  neutral: 'bg-white/5 text-slate-600 ring-white/10',
  success: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  danger: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  brand: 'bg-brand-500/15 text-brand-800 ring-brand-500/30',
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
