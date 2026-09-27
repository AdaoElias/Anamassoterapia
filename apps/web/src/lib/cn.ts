import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combina classes condicionais resolvendo conflito do Tailwind (ultimo vence). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
