import { adicionarDias, BLOCKING_STATUSES, parseDataLocal, utcDeLocal } from '@massoterapia/shared';

import { dataCalendario, paraDataISO } from './cadastros.js';
import { prisma } from './prisma.js';
import { calcularSlots, type SlotCalculado } from './scheduling.js';

/**
 * Servico de agenda compartilhado entre o painel e o portal publico.
 *
 * O calculo dos horarios livres nasceu privado da rota `/appointments/slots`.
 * O portal publico precisa exatamente do mesmo resultado -- mesma folga,
 * mesmo feriado, mesmo aviso minimo -- entao a regra vive aqui e as rotas
 * so traduzem o retorno para o formato que expoem. Duplicar o calculo
 * deixaria as duas agendas divergindo com o tempo.
 */

/** Limites UTC do periodo de datas civis no fuso da clinica. */
export function periodoUtc(timeZone: string, de: string, ate: string) {
  return {
    inicio: utcDeLocal({ ...parseDataLocal(de), hour: 0, minute: 0 }, timeZone),
    fim: utcDeLocal({ ...parseDataLocal(adicionarDias(ate, 1)), hour: 0, minute: 0 }, timeZone),
  };
}

export type ErroSlots = 'THERAPY_NOT_FOUND' | 'PROFESSIONAL_NOT_FOUND' | 'NOT_QUALIFIED';

export type ResultadoSlots =
  { ok: true; timeZone: string; items: SlotCalculado[] } | { ok: false; error: ErroSlots };

export interface ParametrosSlots {
  therapyId: string;
  from: string;
  to: string;
  professionalId?: string | undefined;
}

export async function calcularSlotsDaClinica(
  clinicId: string,
  params: ParametrosSlots,
): Promise<ResultadoSlots> {
  const { therapyId, from, to, professionalId } = params;

  const [clinica, terapia] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } }),
    prisma.therapy.findFirst({
      where: { id: therapyId, clinicId },
      select: { durationMinutes: true, bufferMinutes: true, minNoticeMinutes: true },
    }),
  ]);

  if (!terapia) return { ok: false, error: 'THERAPY_NOT_FOUND' };

  const timeZone = clinica?.timezone ?? 'America/Sao_Paulo';

  // Profissionais que atendem a terapia. Com `professionalId`, so ele.
  const vinculos = await prisma.therapyProfessional.findMany({
    where: {
      clinicId,
      therapyId,
      active: true,
      ...(professionalId ? { professionalId } : {}),
    },
    select: {
      professionalId: true,
      customDurationMinutes: true,
      customBufferMinutes: true,
      professional: { select: { active: true } },
    },
  });

  const configs = vinculos
    .filter((vinculo) => vinculo.professional.active)
    .map((vinculo) => ({
      professionalId: vinculo.professionalId,
      duracaoMinutos: vinculo.customDurationMinutes ?? terapia.durationMinutes,
      bufferMinutos: vinculo.customBufferMinutes ?? terapia.bufferMinutes,
    }));

  if (professionalId && configs.length === 0) {
    const existe = await prisma.professional.count({ where: { id: professionalId, clinicId } });
    return { ok: false, error: existe > 0 ? 'NOT_QUALIFIED' : 'PROFESSIONAL_NOT_FOUND' };
  }

  const { inicio, fim } = periodoUtc(timeZone, from, to);

  const feriados = await prisma.clinicHoliday.findMany({
    where: {
      clinicId,
      date: { gte: dataCalendario(from), lte: dataCalendario(to) },
    },
    select: { date: true },
  });
  const conjuntoFeriados = new Set(
    feriados.map((feriado) => paraDataISO(feriado.date) ?? '').filter(Boolean),
  );

  const agora = new Date();
  const itens: SlotCalculado[] = [];

  for (const config of configs) {
    const [regras, excecoes, ocupados] = await Promise.all([
      prisma.availabilityRule.findMany({
        where: { clinicId, professionalId: config.professionalId, active: true },
      }),
      prisma.availabilityException.findMany({
        where: {
          clinicId,
          professionalId: config.professionalId,
          active: true,
          date: { gte: dataCalendario(from), lte: dataCalendario(to) },
        },
      }),
      prisma.appointment.findMany({
        where: {
          clinicId,
          professionalId: config.professionalId,
          status: { in: [...BLOCKING_STATUSES] },
          startAt: { lt: fim },
          endAt: { gt: inicio },
        },
        select: { startAt: true, endAt: true },
      }),
    ]);

    itens.push(
      ...calcularSlots({
        timeZone,
        de: from,
        ate: to,
        agora,
        professionalId: config.professionalId,
        duracaoMinutos: config.duracaoMinutos,
        bufferMinutos: config.bufferMinutos,
        avisoMinimoMinutos: terapia.minNoticeMinutes,
        regras,
        excecoes,
        feriados: conjuntoFeriados,
        ocupados,
      }),
    );
  }

  itens.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  return { ok: true, timeZone, items: itens };
}
