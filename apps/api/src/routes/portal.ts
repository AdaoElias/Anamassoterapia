import {
  dataLocal,
  normalizeSearchText,
  portalBookingCreateSchema,
  portalBookingResponseSchema,
  portalClinicSchema,
  portalProfessionalListResponseSchema,
  portalSlotListResponseSchema,
  portalTherapyListResponseSchema,
  slotQuerySchema,
  slugSchema,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { calcularSlotsDaClinica } from '../lib/agenda-service.js';
import { avaliarSessao } from '../lib/anamneses/alertas.js';
import { ehConflitoAgenda } from '../lib/cadastros.js';
import { avisarNovoAgendamento } from '../lib/notificacoes/gatilhos.js';
import { prisma } from '../lib/prisma.js';

/**
 * Portal publico do cliente.
 *
 * Sem login: o visitante chega pelo link `/agendar/:slug`, escolhe terapia,
 * profissional e horario e se identifica por nome e telefone. O cliente e
 * achado (ou criado) pelo telefone dentro da clinica do link; a sessao nasce
 * `AGENDADO_PENDENTE` para a clinica confirmar.
 *
 * O slug e o unico identificador aceito. Nenhuma rota aqui recebe `clinicId`:
 * confiar num id vindo do cliente permitiria ler e agendar na clinica alheia.
 *
 * O horario pedido nao e aceito de olhos fechados: ele e reconferido contra o
 * mesmo motor de slots do painel. A constraint de exclusao do banco cobre a
 * corrida entre a conferencia e a gravacao -- se dois clientes clicarem no
 * mesmo horario, um deles recebe 409.
 */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const paramsClinicaSchema = z.object({ slug: slugSchema });

const paramsTerapiaSchema = z.object({
  slug: slugSchema,
  therapyId: z.string().uuid('Identificador invalido'),
});

const clinicaSelect = {
  id: true,
  slug: true,
  name: true,
  timezone: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressState: true,
  bookingTerms: true,
} as const;

const terapiaSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  category: true,
  durationMinutes: true,
  priceCents: true,
  color: true,
  imageUrl: true,
} as const;

const profissionalSelect = {
  id: true,
  name: true,
  bio: true,
  color: true,
  registrationNumber: true,
  registrationType: true,
} as const;

export const portalRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  /** Clinica ativa pelo slug. `null` quando o link nao existe ou foi desligado. */
  async function clinicaPorSlug(slug: string) {
    return prisma.clinic.findFirst({ where: { slug, active: true }, select: clinicaSelect });
  }

  const NAO_ENCONTRADA = { error: 'CLINIC_NOT_FOUND', message: 'Clinica nao encontrada.' };

  app.get(
    '/clinics/:slug',
    {
      schema: {
        tags: ['public'],
        summary: 'Dados publicos da clinica do link',
        params: paramsClinicaSchema,
        response: { 200: portalClinicSchema, 404: erroSchema },
      },
    },
    async (request, reply) => {
      const clinica = await clinicaPorSlug(request.params.slug);
      if (!clinica) return reply.code(404).send(NAO_ENCONTRADA);

      const { id: _id, ...publica } = clinica;
      return reply.code(200).send(publica);
    },
  );

  app.get(
    '/clinics/:slug/therapies',
    {
      schema: {
        tags: ['public'],
        summary: 'Terapias disponiveis para agendamento online',
        description: 'Somente terapias ativas com ao menos um profissional ativo habilitado.',
        params: paramsClinicaSchema,
        response: { 200: portalTherapyListResponseSchema, 404: erroSchema },
      },
    },
    async (request, reply) => {
      const clinica = await clinicaPorSlug(request.params.slug);
      if (!clinica) return reply.code(404).send(NAO_ENCONTRADA);

      const terapias = await prisma.therapy.findMany({
        where: {
          clinicId: clinica.id,
          active: true,
          professionals: {
            some: { active: true, professional: { active: true } },
          },
        },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: terapiaSelect,
      });

      return reply.code(200).send({ items: terapias });
    },
  );

  app.get(
    '/clinics/:slug/therapies/:therapyId/professionals',
    {
      schema: {
        tags: ['public'],
        summary: 'Profissionais que atendem uma terapia',
        params: paramsTerapiaSchema,
        response: { 200: portalProfessionalListResponseSchema, 404: erroSchema },
      },
    },
    async (request, reply) => {
      const clinica = await clinicaPorSlug(request.params.slug);
      if (!clinica) return reply.code(404).send(NAO_ENCONTRADA);

      const terapia = await prisma.therapy.findFirst({
        where: { id: request.params.therapyId, clinicId: clinica.id, active: true },
        select: { id: true },
      });
      if (!terapia) {
        return reply
          .code(404)
          .send({ error: 'THERAPY_NOT_FOUND', message: 'Terapia nao encontrada.' });
      }

      const vinculos = await prisma.therapyProfessional.findMany({
        where: {
          clinicId: clinica.id,
          therapyId: terapia.id,
          active: true,
          professional: { active: true },
        },
        orderBy: { professional: { name: 'asc' } },
        select: { professional: { select: profissionalSelect } },
      });

      return reply.code(200).send({ items: vinculos.map((vinculo) => vinculo.professional) });
    },
  );

  app.get(
    '/clinics/:slug/slots',
    {
      schema: {
        tags: ['public'],
        summary: 'Horarios livres para agendamento online',
        params: paramsClinicaSchema,
        querystring: slotQuerySchema,
        response: { 200: portalSlotListResponseSchema, 404: erroSchema },
      },
    },
    async (request, reply) => {
      const clinica = await clinicaPorSlug(request.params.slug);
      if (!clinica) return reply.code(404).send(NAO_ENCONTRADA);

      const { therapyId, from, professionalId } = request.query;
      const to = request.query.to ?? from;

      const resultado = await calcularSlotsDaClinica(clinica.id, {
        therapyId,
        from,
        to,
        ...(professionalId ? { professionalId } : {}),
      });

      if (!resultado.ok) {
        if (resultado.error === 'THERAPY_NOT_FOUND') {
          return reply
            .code(404)
            .send({ error: 'THERAPY_NOT_FOUND', message: 'Terapia nao encontrada.' });
        }
        return reply.code(404).send({
          error: 'NOT_QUALIFIED',
          message: 'Profissional indisponivel para esta terapia.',
        });
      }

      return reply.code(200).send({
        items: resultado.items.map((slot) => ({
          professionalId: slot.professionalId,
          date: slot.date,
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
          startMinute: slot.startMinute,
          endMinute: slot.endMinute,
        })),
      });
    },
  );

  app.post(
    '/clinics/:slug/appointments',
    {
      schema: {
        tags: ['public'],
        summary: 'Agenda uma sessao pelo portal',
        description:
          'Identificacao por nome e telefone. O horario e reconferido contra o motor ' +
          'de slots; a sessao nasce como AGENDADO_PENDENTE para a clinica confirmar.',
        params: paramsClinicaSchema,
        body: portalBookingCreateSchema,
        response: {
          201: portalBookingResponseSchema,
          404: erroSchema,
          409: erroSchema,
          422: erroSchema,
        },
      },
      // O portal nao tem login, entao o limite por rota e a unica barreira
      // contra script: 10 reservas por minuto e por IP.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const clinica = await clinicaPorSlug(request.params.slug);
      if (!clinica) return reply.code(404).send(NAO_ENCONTRADA);

      const corpo = request.body;

      const terapia = await prisma.therapy.findFirst({
        where: { id: corpo.therapyId, clinicId: clinica.id, active: true },
        select: { durationMinutes: true, priceCents: true },
      });
      if (!terapia) {
        return reply
          .code(404)
          .send({ error: 'THERAPY_NOT_FOUND', message: 'Terapia nao encontrada.' });
      }

      const vinculo = await prisma.therapyProfessional.findFirst({
        where: {
          clinicId: clinica.id,
          therapyId: corpo.therapyId,
          professionalId: corpo.professionalId,
          active: true,
          professional: { active: true },
        },
        select: { customDurationMinutes: true, customPriceCents: true },
      });
      if (!vinculo) {
        return reply.code(404).send({
          error: 'NOT_QUALIFIED',
          message: 'Profissional indisponivel para esta terapia.',
        });
      }

      const startAt = new Date(corpo.startAt);

      // Reconferencia: o horario pedido precisa aparecer no calculo atual.
      // Entre escolher e enviar, outro cliente pode ter levado o horario, ou
      // o aviso minimo pode ter vencido.
      const dia = dataLocal(startAt, clinica.timezone);
      const disponiveis = await calcularSlotsDaClinica(clinica.id, {
        therapyId: corpo.therapyId,
        from: dia,
        to: dia,
        professionalId: corpo.professionalId,
      });

      const inicio = disponiveis.ok
        ? disponiveis.items.find((slot) => slot.startAt.getTime() === startAt.getTime())
        : undefined;

      if (!inicio) {
        return reply.code(422).send({
          error: 'SLOT_UNAVAILABLE',
          message: 'Este horario nao esta mais disponivel. Escolha outro.',
        });
      }

      const duracao = vinculo.customDurationMinutes ?? terapia.durationMinutes;
      const preco = vinculo.customPriceCents ?? terapia.priceCents;
      const endAt = new Date(startAt.getTime() + duracao * 60_000);

      // Cliente convidado: sem login. O telefone normalizado (so digitos) e a
      // chave de reencontro. Num cadastro existente, nome e dado da recepcao
      // nunca sao sobrescritos; so completamos e-mail ausente e nunca
      // desligamos um opt-in de marketing ja dado.
      const existente = await prisma.client.findFirst({
        where: { clinicId: clinica.id, phone: corpo.phone },
        orderBy: { createdAt: 'asc' },
      });

      const email = corpo.email === undefined || corpo.email === '' ? null : corpo.email;

      if (existente) {
        const completarEmail = existente.email === null && email !== null;
        const ligarOptIn = !existente.marketingOptIn && corpo.marketingOptIn;
        if (completarEmail || ligarOptIn) {
          await prisma.client.updateMany({
            where: { id: existente.id, clinicId: clinica.id },
            data: {
              email: completarEmail ? email : undefined,
              marketingOptIn: ligarOptIn ? true : undefined,
            },
          });
        }
      }

      const cliente =
        existente ??
        (await prisma.client.create({
          data: {
            clinicId: clinica.id,
            name: corpo.name,
            phone: corpo.phone,
            email,
            marketingOptIn: corpo.marketingOptIn,
            searchText: normalizeSearchText(corpo.name),
          },
        }));

      try {
        const agendamento = await prisma.appointment.create({
          data: {
            clinicId: clinica.id,
            clientId: cliente.id,
            professionalId: corpo.professionalId,
            therapyId: corpo.therapyId,
            startAt,
            endAt,
            status: 'AGENDADO_PENDENTE',
            source: 'PORTAL_CLIENTE',
            priceCents: preco,
            notes: corpo.notes ?? null,
            createdByUserId: null,
            statusHistory: {
              create: {
                clinicId: clinica.id,
                toStatus: 'AGENDADO_PENDENTE',
                changedByUserId: null,
              },
            },
          },
          include: {
            client: { select: { name: true } },
            professional: { select: { name: true } },
            therapy: { select: { name: true } },
          },
        });

        // A reserva ja esta de pe. Falha na preparacao do aviso nao vira 500
        // para o cliente que acabou de agendar: o horario e dela, o e-mail e
        // nosso.
        await avisarNovoAgendamento(agendamento.id).catch((erro: unknown) => {
          request.log.error({ err: erro }, 'falha ao preparar notificacoes do agendamento');
        });

        // O agendamento pelo portal e o caminho em que a contraindicacao do
        // cliente novo costuma aparecer pela primeira vez. A avaliacao
        // alimenta a equipe, nunca a resposta ao cliente.
        await avaliarSessao(agendamento.id).catch((erro: unknown) => {
          request.log.error({ err: erro }, 'falha ao avaliar contraindicacoes do agendamento');
        });

        return reply.code(201).send({
          id: agendamento.id,
          status: agendamento.status,
          startAt: agendamento.startAt.toISOString(),
          endAt: agendamento.endAt.toISOString(),
          priceCents: agendamento.priceCents,
          therapyName: agendamento.therapy.name,
          professionalName: agendamento.professional.name,
          clientName: agendamento.client.name,
          clinicName: clinica.name,
          clinicSlug: clinica.slug,
          timezone: clinica.timezone,
        });
      } catch (error) {
        // Corrida entre a conferencia e a gravacao: a constraint de exclusao
        // do banco barrou a segunda reserva do mesmo horario.
        if (ehConflitoAgenda(error)) {
          return reply.code(409).send({
            error: 'SLOT_UNAVAILABLE',
            message: 'Este horario acabou de ser reservado. Escolha outro.',
          });
        }
        throw error;
      }
    },
  );

  done();
};
