/**
 * Apoio comum as rotas de cadastro (clinica, salas, terapias,
 * profissionais e clientes).
 *
 * Duas regras que valem para todas elas:
 *
 * 1. **Toda query filtra por `clinicId` da sessao.** Um `update` por `id`
 *    so, mesmo vindo de um id valido, escreveria no tenant alheio. As
 *    escritas usam `updateMany({ where: { id, clinicId } })` e tratam
 *    `count === 0` como 404, e nao como sucesso silencioso.
 *
 * 2. **Ausente nao e nulo.** Num PATCH, campo ausente significa "nao mexe";
 *    string vazia significa "limpa". `limpar` preserva os dois sentidos --
 *    `undefined` continua `undefined` e o Prisma ignora o campo.
 */

/** Converte string vazia em `null`; mantem `undefined` como ausente. */
export function limpar(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === '' ? null : value;
}

/** Data `YYYY-MM-DD` para o meio-dia UTC, como o Prisma espera em `@db.Date`. */
export function dataDeNascimento(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** `Date` -> `YYYY-MM-DD`; nulo continua nulo. */
export function paraDataISO(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/**
 * Erro de unicidade do Prisma (P2002). Detectado pelo `code`, sem importar
 * a classe do client gerado: um `instanceof` acoplaria a rota a versao do
 * Prisma, e o codigo e o contrato estavel.
 */
export function ehConflitoUnico(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === 'P2002';
}

/**
 * Sessao autenticada. `requireAuth` ja rodou como `preHandler`; o guard
 * existe para o tipo nao ser `undefined` e para uma rota mal declarada
 * responder 401 em vez de estourar 500.
 */
export function mensagemConflito(campo: string): { error: string; message: string } {
  return {
    error: 'CONFLICT',
    message: `${campo} ja cadastrado nesta clinica.`,
  };
}
