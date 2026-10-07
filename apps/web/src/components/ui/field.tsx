import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';

import { cn } from '@/lib/cn';

const CONTROLE =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-panel transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500';

interface CampoProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (id: string) => ReactNode;
}

function Campo({ label, hint, error, children }: CampoProps) {
  const id = useId();
  return (
    <label className="block space-y-1.5" htmlFor={id}>
      <span className="block text-sm font-semibold text-slate-700">{label}</span>
      {children(id)}
      {hint !== undefined && error === undefined ? (
        <span className="block text-xs text-slate-400">{hint}</span>
      ) : null}
      {error !== undefined ? <span className="block text-xs text-rose-600">{error}</span> : null}
    </label>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, className, ...props }: TextFieldProps) {
  return (
    <Campo label={label} hint={hint} error={error}>
      {(id) => <input id={id} className={cn(CONTROLE, className)} {...props} />}
    </Campo>
  );
}

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextareaField({ label, hint, error, className, ...props }: TextareaFieldProps) {
  return (
    <Campo label={label} hint={hint} error={error}>
      {(id) => <textarea id={id} className={cn(CONTROLE, 'min-h-20', className)} {...props} />}
    </Campo>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...props
}: SelectFieldProps) {
  return (
    <Campo label={label} hint={hint} error={error}>
      {(id) => (
        <select id={id} className={cn(CONTROLE, className)} {...props}>
          {children}
        </select>
      )}
    </Campo>
  );
}

interface CheckboxFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function CheckboxField({ label, className, ...props }: CheckboxFieldProps) {
  return (
    <label className="flex items-center gap-2.5 text-sm text-slate-700">
      <input
        type="checkbox"
        className={cn(
          'h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500',
          className,
        )}
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}
