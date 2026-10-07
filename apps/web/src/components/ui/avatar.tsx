import { cn } from '@/lib/cn';

/** Avatar com iniciais: circulo com gradiente salvia->argila, sem imagem. */
export function Avatar({ nome, className }: { nome: string; className?: string }) {
  const iniciais = nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-10 shrink-0 select-none place-items-center rounded-full bg-gradient-to-br from-brand-500 to-clay-500 text-sm font-bold text-white shadow-panel',
        className,
      )}
    >
      {iniciais}
    </span>
  );
}
