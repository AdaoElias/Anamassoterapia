import { formatBRL } from '@massoterapia/shared';

export { formatBRL };

/** E.164 sem '+' (5511988887777) -> "(11) 98888-7777". */
export function formatarTelefone(valor: string | null): string {
  if (!valor) return '';

  const semPais = valor.startsWith('55') && valor.length > 11 ? valor.slice(2) : valor;

  if (semPais.length === 11) {
    return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 7)}-${semPais.slice(7)}`;
  }
  if (semPais.length === 10) {
    return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 6)}-${semPais.slice(6)}`;
  }
  return valor;
}

/** "52998224725" -> "529.982.247-25". */
export function formatarCpf(valor: string | null): string {
  if (!valor || valor.length !== 11) return valor ?? '';
  return `${valor.slice(0, 3)}.${valor.slice(3, 6)}.${valor.slice(6, 9)}-${valor.slice(9)}`;
}

/** "YYYY-MM-DD" -> "DD/MM/YYYY". */
export function formatarData(valor: string | null): string {
  if (!valor) return '';
  const partes = valor.split('-');
  if (partes.length !== 3) return valor;
  const [ano, mes, dia] = partes;
  return `${dia}/${mes}/${ano}`;
}

/** 1000 basis points -> "10%". */
export function formatarPercentual(basisPoints: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(basisPoints / 10_000);
}

/** Campo numerico opcional do formulario: vazio vira ausente, texto vira numero. */
export function paraNumero(valor: string): number | undefined {
  if (valor.trim() === '') return undefined;
  const numero = Number(valor.replace(',', '.'));
  return Number.isFinite(numero) ? numero : undefined;
}

/** "150,00" -> 15000 centavos. Texto invalido vira 0 (a API rejeita com 422). */
export function paraCentavos(valor: string): number {
  const numero = Number(valor.replace(',', '.'));
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0;
}

/** 15000 centavos -> "150.00", formato aceito por `<input type="number">`. */
export function deCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}
