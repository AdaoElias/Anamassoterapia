/**
 * Gera um slug seguro para URL a partir de texto livre.
 *
 * "Drenagem Linfoatica Pos-operatoria" -> "drenagem-linfoatica-pos-operatoria".
 * Remove acentos via NFD, descarta tudo que nao for letra/numero e colapsa
 * hifens. O resultado casa com `slugSchema` de `schemas/common`.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}
