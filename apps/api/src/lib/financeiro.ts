/**
 * Apoio as rotas de financeiro.
 *
 * Duas preocupacoes, ambas repetidas em quase todas as rotas:
 *
 * 1. **Fuso civil.** `dueDate`/`validFrom`/`validUntil` sao `@db.Date`:
 *    YYYY-MM-DD guardado a meia-noite UTC, e as comparacoes usam
 *    `[de, fim)` com `fim` no dia seguinte. `paidAt` e timestamptz e o
 *    mesmo intervalo se aplica; a conversao do fuso da clinica na borda e
 *    melhoria futura (hoje o servidor roda no fuso da clinica).
 *
 * 2. **Resposta serializada.** O schema compartilhado espera datas em
 *    string, nunca `Date`. Os mapeadores aqui unificam esse formato para
 *    que a rota nao repita o mesmo `.toISOString()` em sete lugares.
 */

import type {
  Commission as CommissionRow,
  FinancialEntry as FinancialEntryRow,
  Package as PackageRow,
} from '../generated/prisma/client.js';
import { paraDataISO } from './cadastros.js';

/** Data civil `YYYY-MM-DD` para meia-noite UTC (coluna `@db.Date`). */
export function dataColuna(diaISO: string): Date {
  return new Date(`${diaISO}T00:00:00.000Z`);
}

/** Dia seguinte a `diaISO`, para fechar intervalo `[de, fim)` nas queries. */
export function diaSeguinte(diaISO: string): Date {
  const [ano = 0, mes = 1, dia = 1] = diaISO.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + 1));
}

/** Hoje no fuso do servidor, como dia civil (`@db.Date`). */
export function hojeCivil(): Date {
  const agora = new Date();
  return new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()));
}

/** Lancamento com o nome do cliente resolvido, conforme o `findMany`. */
export type LinhaLancamento = FinancialEntryRow & {
  client?: { name: string | null } | null;
};

export function respostaLancamento(linha: LinhaLancamento) {
  return {
    id: linha.id,
    kind: linha.kind,
    status: linha.status,
    method: linha.method,
    clientId: linha.clientId,
    clientName: linha.client?.name ?? null,
    appointmentId: linha.appointmentId,
    packageId: linha.packageId,
    amountCents: linha.amountCents,
    dueDate: paraDataISO(linha.dueDate),
    paidAt: linha.paidAt === null ? null : linha.paidAt.toISOString(),
    description: linha.description,
    notes: linha.notes,
    createdAt: linha.createdAt.toISOString(),
  };
}

/** Pacote com o nome do cliente e o saldo ja montado pela rota. */
export function respostaPacote(
  pacote: PackageRow & { client?: { name: string | null } | null },
  saldo: { usadas: number; restantes: number },
) {
  return {
    id: pacote.id,
    clientId: pacote.clientId,
    clientName: pacote.client?.name ?? 'Cliente removido',
    name: pacote.name,
    totalSessions: pacote.totalSessions,
    priceCents: pacote.priceCents,
    validFrom: paraDataISO(pacote.validFrom) ?? '',
    validUntil: paraDataISO(pacote.validUntil) ?? '',
    status: pacote.status,
    notes: pacote.notes,
    sessoesUsadas: saldo.usadas,
    sessoesRestantes: saldo.restantes,
    createdAt: pacote.createdAt.toISOString(),
  };
}

export function respostaComissao(
  linha: CommissionRow & { professional?: { name: string } | null },
) {
  return {
    id: linha.id,
    professionalId: linha.professionalId,
    professionalName: linha.professional?.name ?? 'Profissional removido',
    appointmentId: linha.appointmentId,
    baseAmountCents: linha.baseAmountCents,
    percentBasisPoints: linha.percentBasisPoints,
    amountCents: linha.amountCents,
    status: linha.status,
    periodStart: paraDataISO(linha.periodStart) ?? '',
    periodEnd: paraDataISO(linha.periodEnd) ?? '',
    paidAt: linha.paidAt === null ? null : linha.paidAt.toISOString(),
    notes: linha.notes,
    createdAt: linha.createdAt.toISOString(),
  };
}
