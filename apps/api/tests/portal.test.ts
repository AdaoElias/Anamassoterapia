import { randomUUID } from 'node:crypto';

import { diaDaSemanaDaData, parseDataLocal, utcDeLocal } from '@massoterapia/shared';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { type App, buildApp } from '../src/app.js';
import { disconnectPrisma, prisma } from '../src/lib/prisma.js';

/**
 * Portal publico do cliente contra o banco de teste.
 *
 * Sem login: o que se verifica aqui e o recorte de tenant pelo slug, o
 * filtro de terapias/profissionais oferecidos, a reconferencia do horario
 * contra o motor de slots e o reencontro do cliente pelo telefone.
 */

const TZ = 'America/Sao_Paulo';

/** Data futura e distante, para nao esbarrar no relogio real. */
const DIA = '2099-01-05';
const DOW = diaDaSemanaDaData(DIA);

const apps: App[] = [];

interface Clinica {
  clinicId: string;
  slug: string;
  professionalId: string;
  therapyId: string;
}

const criadas: Clinica[] = [];

async function novaApp(): Promise<App> {
  const app = await buildApp();
  await app.ready();
  apps.push(app);
  return app;
}

async function criarClinica(): Promise<Clinica> {
  const clinicId = randomUUID();
  const slug = `clinica-${clinicId.slice(0, 8)}`;
  const professionalId = randomUUID();
  const therapyId = randomUUID();

  await prisma.clinic.create({ data: { id: clinicId, name: 'Clinica Portal', slug } });
  await prisma.professional.create({
    data: { id: professionalId, clinicId, name: 'Profissional Portal' },
  });
  await prisma.therapy.create({
    data: {
      id: therapyId,
      clinicId,
      name: 'Massagem Relaxante',
      slug: `relaxante-${clinicId.slice(0, 8)}`,
      durationMinutes: 60,
      priceCents: 12_000,
      minNoticeMinutes: 0,
    },
  });
  await prisma.therapyProfessional.create({ data: { clinicId, therapyId, professionalId } });
  await prisma.availabilityRule.create({
    data: {
      clinicId,
      professionalId,
      weekday: DOW,
      startMinute: 9 * 60,
      endMinute: 12 * 60,
      slotGranularityMinutes: 60,
      effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    },
  });

  const clinica: Clinica = { clinicId, slug, professionalId, therapyId };
  criadas.push(clinica);
  return clinica;
}

function corpoDe<T>(resposta: { json(): unknown }): T {
  return resposta.json() as T;
}

function localHora(hora: number): string {
  return utcDeLocal({ ...parseDataLocal(DIA), hour: hora, minute: 0 }, TZ).toISOString();
}

function agendamento(
  clinica: Clinica,
  startAt: string,
  campos: { name?: string; phone?: string; marketingOptIn?: boolean } = {},
) {
  return {
    therapyId: clinica.therapyId,
    professionalId: clinica.professionalId,
    startAt,
    name: campos.name ?? 'Ana Portal',
    phone: campos.phone ?? '(51) 99999-8888',
    ...(campos.marketingOptIn === undefined ? {} : { marketingOptIn: campos.marketingOptIn }),
  };
}

afterEach(async () => {
  const doTeste = criadas.splice(0, criadas.length);
  if (doTeste.length === 0) return;

  await prisma.appointment.deleteMany({
    where: { clinicId: { in: doTeste.map((c) => c.clinicId) } },
  });
  await prisma.clinic.deleteMany({ where: { id: { in: doTeste.map((c) => c.clinicId) } } });
});

afterAll(async () => {
  for (const app of apps) {
    await app.close();
  }
  await disconnectPrisma();
});

describe('portal publico', () => {
  it('devolve a clinica do link e 404 para slug desconhecido', async () => {
    const app = await novaApp();
    const clinica = await criarClinica();

    const resposta = await app.inject({ method: 'GET', url: `/public/clinics/${clinica.slug}` });
    expect(resposta.statusCode).toBe(200);
    expect(corpoDe<{ slug: string; name: string }>(resposta)).toMatchObject({
      slug: clinica.slug,
      name: 'Clinica Portal',
    });

    const inexistente = await app.inject({
      method: 'GET',
      url: '/public/clinics/nao-existe',
    });
    expect(inexistente.statusCode).toBe(404);
  });

  it('lista so terapias ativas com profissional ativo', async () => {
    const app = await novaApp();
    const clinica = await criarClinica();

    // Terapia ativa, porem sem nenhum profissional habilitado: nao e oferecida.
    await prisma.therapy.create({
      data: {
        clinicId: clinica.clinicId,
        name: 'Sem Profissional',
        slug: `sem-prof-${clinica.clinicId.slice(0, 8)}`,
        durationMinutes: 60,
        priceCents: 9_000,
      },
    });
    // Terapia desativada, mesmo com profissional.
    const outra = randomUUID();
    await prisma.therapy.create({
      data: {
        id: outra,
        clinicId: clinica.clinicId,
        name: 'Desativada',
        slug: `desativada-${clinica.clinicId.slice(0, 8)}`,
        durationMinutes: 60,
        priceCents: 8_000,
        active: false,
      },
    });
    await prisma.therapyProfessional.create({
      data: {
        clinicId: clinica.clinicId,
        therapyId: outra,
        professionalId: clinica.professionalId,
      },
    });

    const resposta = await app.inject({
      method: 'GET',
      url: `/public/clinics/${clinica.slug}/therapies`,
    });
    expect(resposta.statusCode).toBe(200);
    const itens = corpoDe<{ items: Array<{ id: string }> }>(resposta).items;
    expect(itens.map((item) => item.id)).toEqual([clinica.therapyId]);
  });

  it('lista os profissionais que atendem a terapia', async () => {
    const app = await novaApp();
    const clinica = await criarClinica();

    const resposta = await app.inject({
      method: 'GET',
      url: `/public/clinics/${clinica.slug}/therapies/${clinica.therapyId}/professionals`,
    });
    expect(resposta.statusCode).toBe(200);
    const itens = corpoDe<{ items: Array<{ id: string; name: string }> }>(resposta).items;
    expect(itens).toEqual([
      expect.objectContaining({ id: clinica.professionalId, name: 'Profissional Portal' }),
    ]);
  });

  it('calcula horarios livres sem login', async () => {
    const app = await novaApp();
    const clinica = await criarClinica();

    const resposta = await app.inject({
      method: 'GET',
      url: `/public/clinics/${clinica.slug}/slots?therapyId=${clinica.therapyId}&from=${DIA}&to=${DIA}`,
    });
    expect(resposta.statusCode).toBe(200);
    const itens = corpoDe<{ items: Array<{ startAt: string }> }>(resposta).items;
    expect(itens.map((item) => item.startAt)).toEqual([localHora(9), localHora(10), localHora(11)]);
  });

  it('agenda pelo portal e reaproveita o cliente pelo telefone', async () => {
    const app = await novaApp();
    const clinica = await criarClinica();

    const primeira = await app.inject({
      method: 'POST',
      url: `/public/clinics/${clinica.slug}/appointments`,
      payload: agendamento(clinica, localHora(9), { marketingOptIn: true }),
    });
    expect(primeira.statusCode).toBe(201);
    expect(corpoDe<{ status: string; priceCents: number }>(primeira)).toMatchObject({
      status: 'AGENDADO_PENDENTE',
      priceCents: 12_000,
    });

    const segunda = await app.inject({
      method: 'POST',
      url: `/public/clinics/${clinica.slug}/appointments`,
      payload: agendamento(clinica, localHora(10)),
    });
    expect(segunda.statusCode).toBe(201);

    const clientes = await prisma.client.findMany({ where: { clinicId: clinica.clinicId } });
    expect(clientes).toHaveLength(1);
    expect(clientes[0]?.phone).toBe('5551999998888');
    // Opt-in ja dado nunca e desligado por um agendamento posterior.
    expect(clientes[0]?.marketingOptIn).toBe(true);

    const agendamentos = await prisma.appointment.findMany({
      where: { clinicId: clinica.clinicId },
    });
    expect(agendamentos).toHaveLength(2);
    expect(agendamentos.every((item) => item.clientId === clientes[0]?.id)).toBe(true);
    expect(agendamentos.every((item) => item.source === 'PORTAL_CLIENTE')).toBe(true);

    // O horario reservado some da lista publica.
    const slots = await app.inject({
      method: 'GET',
      url: `/public/clinics/${clinica.slug}/slots?therapyId=${clinica.therapyId}&from=${DIA}&to=${DIA}`,
    });
    const itens = corpoDe<{ items: Array<{ startAt: string }> }>(slots).items;
    expect(itens.map((item) => item.startAt)).toEqual([localHora(11)]);
  });

  it('recusa horario fora da agenda com 422', async () => {
    const app = await novaApp();
    const clinica = await criarClinica();

    const resposta = await app.inject({
      method: 'POST',
      url: `/public/clinics/${clinica.slug}/appointments`,
      payload: agendamento(clinica, localHora(13)),
    });
    expect(resposta.statusCode).toBe(422);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('SLOT_UNAVAILABLE');
  });

  it('nao agenda em clinica diferente da do slug', async () => {
    const app = await novaApp();
    const clinica = await criarClinica();
    const outra = await criarClinica();

    const resposta = await app.inject({
      method: 'POST',
      url: `/public/clinics/${outra.slug}/appointments`,
      payload: agendamento(clinica, localHora(9)),
    });
    expect(resposta.statusCode).toBe(404);
    expect(corpoDe<{ error: string }>(resposta).error).toBe('THERAPY_NOT_FOUND');
  });
});
