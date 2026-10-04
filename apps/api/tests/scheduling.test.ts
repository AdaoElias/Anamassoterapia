import {
  adicionarDias,
  dataLocal,
  diaDaSemanaDaData,
  parseDataLocal,
  utcDeLocal,
} from '@massoterapia/shared';
import { describe, expect, it } from 'vitest';

import { calcularSlots } from '../src/lib/scheduling.js';

/**
 * Motor de slots, sem banco.
 *
 * Cobre as regras que decidem se um horario aparece ou nao: janela semanal,
 * vigencia, folga, janela extra, feriado, ocupacao e aviso minimo.
 */

const TZ = 'America/Sao_Paulo';

/** Uma data futura e distante: nunca esbarra no aviso minimo real. */
const DIA = '2099-01-05';
const DOW = diaDaSemanaDaData(DIA);
const AGORA = new Date('2099-01-01T00:00:00.000Z');

function emMinutos(hora: number, minuto = 0): number {
  return hora * 60 + minuto;
}

function localHora(hora: number, minuto = 0): string {
  return utcDeLocal({ ...parseDataLocal(DIA), hour: hora, minute: minuto }, TZ).toISOString();
}

function entradaBase(overrides: Partial<Parameters<typeof calcularSlots>[0]> = {}) {
  return {
    timeZone: TZ,
    de: DIA,
    ate: DIA,
    agora: AGORA,
    professionalId: 'prof-1',
    duracaoMinutos: 60,
    bufferMinutos: 0,
    avisoMinimoMinutos: 0,
    regras: [
      {
        weekday: DOW,
        startMinute: emMinutos(9),
        endMinute: emMinutos(12),
        slotGranularityMinutes: 60,
        effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
        effectiveTo: null,
        active: true,
      },
    ],
    excecoes: [],
    feriados: new Set<string>(),
    ocupados: [],
    ...overrides,
  };
}

describe('datas e fuso', () => {
  it('converte horario local da clinica para UTC', () => {
    const instante = utcDeLocal({ ...parseDataLocal(DIA), hour: 9, minute: 0 }, TZ);
    // America/Sao_Paulo sem horario de verao: 09:00 local = 12:00Z.
    expect(instante.toISOString()).toBe(`${DIA}T12:00:00.000Z`);
    expect(dataLocal(instante, TZ)).toBe(DIA);
  });

  it('soma dias atravessando o fim do mes', () => {
    expect(adicionarDias('2099-01-31', 1)).toBe('2099-02-01');
  });
});

describe('calcularSlots', () => {
  it('gera um inicio por granularidade dentro da janela', () => {
    const slots = calcularSlots(entradaBase());
    expect(slots.map((slot) => slot.startMinute)).toEqual([
      emMinutos(9),
      emMinutos(10),
      emMinutos(11),
    ]);
    expect(slots[0]?.startAt.toISOString()).toBe(localHora(9));
  });

  it('respeita a folga entre sessoes', () => {
    const slots = calcularSlots(entradaBase({ bufferMinutos: 30, duracaoMinutos: 60 }));
    // Sessao de 60 + folga de 30 = passo de 90: 09:00 e 10:30.
    expect(slots.map((slot) => slot.startMinute)).toEqual([emMinutos(9), emMinutos(10, 30)]);
  });

  it('pula o inicio ocupado por outra sessao', () => {
    const slots = calcularSlots(
      entradaBase({
        ocupados: [
          {
            // 10:00 local.
            startAt: new Date(localHora(10)),
            endAt: new Date(localHora(11)),
          },
        ],
      }),
    );
    expect(slots.map((slot) => slot.startMinute)).toEqual([emMinutos(9), emMinutos(11)]);
  });

  it('remove a janela bloqueada e mantem o resto do dia', () => {
    const slots = calcularSlots(
      entradaBase({
        excecoes: [
          {
            date: new Date(`${DIA}T00:00:00.000Z`),
            type: 'BLOQUEIO',
            startMinute: emMinutos(10),
            endMinute: emMinutos(11),
            active: true,
          },
        ],
      }),
    );
    expect(slots.map((slot) => slot.startMinute)).toEqual([emMinutos(9), emMinutos(11)]);
  });

  it('fecha o dia inteiro no bloqueio all-day', () => {
    const slots = calcularSlots(
      entradaBase({
        excecoes: [
          {
            date: new Date(`${DIA}T00:00:00.000Z`),
            type: 'BLOQUEIO',
            startMinute: null,
            endMinute: null,
            active: true,
          },
        ],
      }),
    );
    expect(slots).toHaveLength(0);
  });

  it('acrescenta uma janela extra fora do horario recorrente', () => {
    const slots = calcularSlots(
      entradaBase({
        excecoes: [
          {
            date: new Date(`${DIA}T00:00:00.000Z`),
            type: 'EXTRA',
            startMinute: emMinutos(18),
            endMinute: emMinutos(20),
            active: true,
          },
        ],
      }),
    );
    expect(slots.map((slot) => slot.startMinute)).toContain(emMinutos(18));
    expect(slots.map((slot) => slot.startMinute)).toContain(emMinutos(19));
  });

  it('nao oferece horarios em feriado da clinica', () => {
    const slots = calcularSlots(entradaBase({ feriados: new Set([DIA]) }));
    expect(slots).toHaveLength(0);
  });

  it('respeita o aviso minimo', () => {
    const slots = calcularSlots(
      entradaBase({
        agora: new Date(localHora(9, 30)),
        avisoMinimoMinutos: 60,
      }),
    );
    // 09:00 ja passou e 10:00 nao cabe no aviso de 60min (limite 10:30).
    expect(slots.map((slot) => slot.startMinute)).toEqual([emMinutos(11)]);
  });

  it('ignora regra com vigencia que ainda nao comecou', () => {
    const slots = calcularSlots(
      entradaBase({
        regras: [
          {
            weekday: DOW,
            startMinute: emMinutos(9),
            endMinute: emMinutos(12),
            slotGranularityMinutes: 60,
            effectiveFrom: new Date('2100-01-01T00:00:00.000Z'),
            effectiveTo: null,
            active: true,
          },
        ],
      }),
    );
    expect(slots).toHaveLength(0);
  });

  it('nao oferece horario que ultrapassa o fim da janela', () => {
    const slots = calcularSlots(
      entradaBase({
        regras: [
          {
            weekday: DOW,
            startMinute: emMinutos(9),
            endMinute: emMinutos(10, 30),
            slotGranularityMinutes: 60,
            effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
            effectiveTo: null,
            active: true,
          },
        ],
      }),
    );
    // Janela de 90min so cabe uma sessao de 60.
    expect(slots.map((slot) => slot.startMinute)).toEqual([emMinutos(9)]);
  });
});
