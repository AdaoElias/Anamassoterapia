import {
  adicionarDias,
  diaDaSemanaDaData,
  intervaloDeDatas,
  parseDataLocal,
  utcDeLocal,
} from '@massoterapia/shared';

import { paraDataISO } from './cadastros.js';

/**
 * Motor de horarios livres.
 *
 * O calculo e puro e sem banco: recebe as regras, excecoes, feriados e os
 * agendamentos que ocupam a agenda, e devolve os inicios de sessao possiveis.
 * Isso o torna testavel sem fixture e reaproveitavel pelo portal publico.
 *
 * Regras de negocio:
 * - regra semanal + vigencia define as janelas base do dia;
 * - excecao BLOQUEIO remove janela (sem horarios) e all-day fecha o dia;
 * - excecao EXTRA adiciona janela;
 * - feriado da clinica fecha o dia inteiro;
 * - a sessao ocupa `duracao`; a folga (`buffer`) so entra para nao colar a
 *   proxima sessao nem sobrepor um horario ja ocupado;
 * - `avisoMinimo` descarta inicios antes de `agora + aviso`.
 */

export interface RegraDisponibilidade {
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotGranularityMinutes: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  active: boolean;
}

export interface ExcecaoDisponibilidade {
  date: Date;
  type: 'BLOQUEIO' | 'EXTRA';
  startMinute: number | null;
  endMinute: number | null;
  active: boolean;
}

export interface Ocupacao {
  startAt: Date;
  endAt: Date;
}

export interface EntradaSlots {
  timeZone: string;
  de: string;
  ate: string;
  agora: Date;
  professionalId: string;
  duracaoMinutos: number;
  bufferMinutos: number;
  avisoMinimoMinutos: number;
  regras: RegraDisponibilidade[];
  excecoes: ExcecaoDisponibilidade[];
  feriados: ReadonlySet<string>;
  ocupados: Ocupacao[];
}

export interface SlotCalculado {
  professionalId: string;
  date: string;
  startAt: Date;
  endAt: Date;
  startMinute: number;
  endMinute: number;
}

interface Janela {
  startMinute: number;
  endMinute: number;
  granularity: number;
}

function vigenteNaData(regra: RegraDisponibilidade, data: string): boolean {
  if (!regra.active) return false;
  if (regra.weekday !== diaDaSemanaDaData(data)) return false;
  const de = paraDataISO(regra.effectiveFrom);
  if (de === null || de > data) return false;
  const ate = paraDataISO(regra.effectiveTo);
  return ate === null || data <= ate;
}

/** Remove `[inicio, fim)` de cada janela, podendo partir uma em duas. */
function subtrair(janelas: Janela[], inicio: number, fim: number): Janela[] {
  const resultado: Janela[] = [];
  for (const janela of janelas) {
    if (fim <= janela.startMinute || inicio >= janela.endMinute) {
      resultado.push(janela);
      continue;
    }
    if (inicio > janela.startMinute) {
      resultado.push({ ...janela, endMinute: inicio });
    }
    if (fim < janela.endMinute) {
      resultado.push({ ...janela, startMinute: fim });
    }
  }
  return resultado;
}

function montarJanelas(entrada: EntradaSlots, data: string): Janela[] {
  let janelas: Janela[] = entrada.regras
    .filter((regra) => vigenteNaData(regra, data))
    .map((regra) => ({
      startMinute: regra.startMinute,
      endMinute: regra.endMinute,
      granularity: regra.slotGranularityMinutes,
    }));

  const granularidadePadrao =
    janelas.length > 0 ? Math.min(...janelas.map((janela) => janela.granularity)) : 15;

  for (const excecao of entrada.excecoes) {
    if (!excecao.active || paraDataISO(excecao.date) !== data) continue;

    if (excecao.type === 'BLOQUEIO') {
      if (excecao.startMinute === null || excecao.endMinute === null) {
        return [];
      }
      janelas = subtrair(janelas, excecao.startMinute, excecao.endMinute);
    } else if (excecao.startMinute !== null && excecao.endMinute !== null) {
      janelas.push({
        startMinute: excecao.startMinute,
        endMinute: excecao.endMinute,
        granularity: granularidadePadrao,
      });
    }
  }

  return janelas;
}

export function calcularSlots(entrada: EntradaSlots): SlotCalculado[] {
  const { timeZone, duracaoMinutos, bufferMinutos } = entrada;
  const limiteMinimo = new Date(entrada.agora.getTime() + entrada.avisoMinimoMinutos * 60_000);
  const bloqueioTotal = duracaoMinutos + bufferMinutos;
  const slots: SlotCalculado[] = [];
  const jaGerados = new Set<number>();

  for (const data of intervaloDeDatas(entrada.de, entrada.ate)) {
    if (entrada.feriados.has(data)) continue;

    const janelas = montarJanelas(entrada, data);
    if (janelas.length === 0) continue;

    const { year, month, day } = parseDataLocal(data);
    const ocupadosNoDia: Ocupacao[] = [...entrada.ocupados];

    for (const janela of janelas) {
      let cursor = janela.startMinute;

      while (cursor + duracaoMinutos <= janela.endMinute) {
        const inicio = utcDeLocal(
          { year, month, day, hour: Math.floor(cursor / 60), minute: cursor % 60 },
          timeZone,
        );
        const inicioMs = inicio.getTime();

        if (inicioMs < limiteMinimo.getTime()) {
          cursor += janela.granularity;
          continue;
        }

        const fimSessao = new Date(inicioMs + duracaoMinutos * 60_000);
        const fimBloqueio = new Date(inicioMs + bloqueioTotal * 60_000);
        const conflita = ocupadosNoDia.some(
          (ocupacao) =>
            inicioMs < ocupacao.endAt.getTime() &&
            ocupacao.startAt.getTime() < fimBloqueio.getTime(),
        );

        if (conflita || jaGerados.has(inicioMs)) {
          cursor += janela.granularity;
          continue;
        }

        jaGerados.add(inicioMs);
        ocupadosNoDia.push({ startAt: inicio, endAt: fimBloqueio });
        slots.push({
          professionalId: entrada.professionalId,
          date: data,
          startAt: inicio,
          endAt: fimSessao,
          startMinute: cursor,
          endMinute: cursor + duracaoMinutos,
        });

        // O proximo inicio respeita a sessao inteira: sem sobreposicao entre
        // os proprios horarios oferecidos.
        cursor += bloqueioTotal;
      }
    }
  }

  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/** Primeiro dia que pode ter slot, util para varrer feriados sem iterar 1 a 1. */
export function proximoDiaUtil(de: string, feriados: ReadonlySet<string>): string {
  let atual = de;
  while (feriados.has(atual)) {
    atual = adicionarDias(atual, 1);
  }
  return atual;
}
