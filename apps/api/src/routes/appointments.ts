import {
  appointmentCreateSchema,
  appointmentListQuerySchema,
  appointmentListResponseSchema,
  appointmentSchema,
  appointmentStatusUpdateSchema,
  appointmentUpdateSchema,
  canTransition,
  idSchema,
  slotListResponseSchema,
  slotQuerySchema,
} from '@massoterapia/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client.js';
import { calcularSlotsDaClinica, periodoUtc } from '../lib/agenda-service.js';
import { avaliarSessao, vincularAnamnese } from '../lib/anamneses/alertas.js';
import { ehConflitoAgenda } from '../lib/cadastros.js';
import {
  avisarCancelamento,
  avisarConfirmacao,
  avisarNovoAgendamento,
  avisarReagendamento,
  rearmarLembrete,
} from '../lib/notificacoes/gatilhos.js';
import { prisma } from '../lib/prisma.js';

/**
 * Agenda: lista de sessoes, criacao, remarcacao e transicao de status, alem
 * do calculo dos horarios livres.
 *
 * O conflito de horario nao e verificado na mao: ele e garantido pela
 * constraint de exclusao do Postgres. A rota apenas traduz a violacao
 * (`23P01`) para 409. Verificar na aplicacao criaria uma janela de corrida
 * entre duas requisicoes simultaneas.
 */

const erroSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const paramsSchema = z.object({ id: idSchema });

const incluirRelacoes = {
  client: { select: { name: true } },
  professional: { select: { name: true } },
  therapy: { select: { name: true } },
  room: { select: { name: true } },
} as const;

type Agendamento = Prisma.AppointmentGetPayload<{ include: typeof incluirRelacoes }>;

function paraInstante(data: Date | null): string | null {
  return data === null ? null : data.toISOString();
}

function resposta(agendamento: Agendamento) {
  return {
    id: agendamento.id,
    clientId: agendamento.clientId,
    clientName: agendamento.client.name,
    professionalId: agendamento.professionalId,
    professionalName: agendamento.professional.name,
    therapyId: agendamento.therapyId,
    therapyName: agendamento.therapy.name,
    roomId: agendamento.roomId,
    roomName: agendamento.room?.name ?? null,
    startAt: agendamento.startAt.toISOString(),
    endAt: agendamento.endAt.toISOString(),
    status: agendamento.status,
    source: agendamento.source,
    priceCents: agendamento.priceCents,
    notes: agendamento.notes,
    sessionNotes: agendamento.sessionNotes,
    cancellationReason: agendamento.cancellationReason,
    cancelledAt: paraInstante(agendamento.cancelledAt),
    confirmedAt: paraInstante(agendamento.confirmedAt),
    startedAt: paraInstante(agendamento.startedAt),
    finishedAt: paraInstante(agendamento.finishedAt),
  };
}

export const appointmentRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  // --- Horarios livres -------------------------------------------------

  app.get(
    '/slots',
    {
      schema: {
        tags: ['booking'],
        summary: 'Calcula os horarios livres para uma terapia',
        querystring: slotQuerySchema,
        response: { 200: slotListResponseSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const { therapyId, from, professionalId } = request.query;
      const to = request.query.to ?? from;

      const resultado = await calcularSlotsDaClinica(sessao.clinicId, {
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
        if (resultado.error === 'NOT_QUALIFIED') {
          return reply
            .code(404)
            .send({ error: 'NOT_QUALIFIED', message: 'Profissional nao atende esta terapia.' });
        }
        return reply
          .code(404)
          .send({ error: 'PROFESSIONAL_NOT_FOUND', message: 'Profissional nao encontrado.' });
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

  // --- Sessoes ---------------------------------------------------------

  app.get(
    '/',
    {
      schema: {
        tags: ['booking'],
        summary: 'Lista as sessoes no periodo',
        querystring: appointmentListQuerySchema,
        response: { 200: appointmentListResponseSchema, 401: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const { from, to, professionalId, clientId, status } = request.query;

      const clinica = await prisma.clinic.findUnique({
        where: { id: sessao.clinicId },
        select: { timezone: true },
      });
      const { inicio, fim } = periodoUtc(clinica?.timezone ?? 'America/Sao_Paulo', from, to);

      const agendamentos = await prisma.appointment.findMany({
        where: {
          clinicId: sessao.clinicId,
          startAt: { gte: inicio, lt: fim },
          ...(professionalId ? { professionalId } : {}),
          ...(clientId ? { clientId } : {}),
          ...(status ? { status } : {}),
        },
        include: incluirRelacoes,
        orderBy: { startAt: 'asc' },
      });

      return reply.code(200).send({ items: agendamentos.map(resposta) });
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['booking'],
        summary: 'Detalhe de uma sessao',
        params: paramsSchema,
        response: { 200: appointmentSchema, 401: erroSchema, 404: erroSchema },
      },
      preHandler: app.requireAuth,
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const agendamento = await prisma.appointment.findFirst({
        where: { id: request.params.id, clinicId: sessao.clinicId },
        include: incluirRelacoes,
      });

      if (!agendamento) {
        return reply
          .code(404)
          .send({ error: 'APPOINTMENT_NOT_FOUND', message: 'Sessao nao encontrada.' });
      }

      return reply.code(200).send(resposta(agendamento));
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['booking'],
        summary: 'Cria uma sessao na agenda',
        body: appointmentCreateSchema,
        response: {
          201: appointmentSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const corpo = request.body;

      const [cliente, profissional, terapia] = await Promise.all([
        prisma.client.findFirst({
          where: { id: corpo.clientId, clinicId: sessao.clinicId },
          select: { id: true },
        }),
        prisma.professional.findFirst({
          where: { id: corpo.professionalId, clinicId: sessao.clinicId },
          select: { id: true },
        }),
        prisma.therapy.findFirst({
          where: { id: corpo.therapyId, clinicId: sessao.clinicId },
          select: { id: true, durationMinutes: true, priceCents: true },
        }),
      ]);

      if (!cliente) {
        return reply
          .code(404)
          .send({ error: 'CLIENT_NOT_FOUND', message: 'Cliente nao encontrado.' });
      }
      if (!profissional) {
        return reply
          .code(404)
          .send({ error: 'PROFESSIONAL_NOT_FOUND', message: 'Profissional nao encontrado.' });
      }
      if (!terapia) {
        return reply
          .code(404)
          .send({ error: 'THERAPY_NOT_FOUND', message: 'Terapia nao encontrada.' });
      }

      let roomId: string | null = null;
      if (corpo.roomId !== undefined && corpo.roomId !== '') {
        const sala = await prisma.room.findFirst({
          where: { id: corpo.roomId, clinicId: sessao.clinicId },
          select: { id: true },
        });
        if (!sala) {
          return reply.code(404).send({ error: 'ROOM_NOT_FOUND', message: 'Sala nao encontrada.' });
        }
        roomId = sala.id;
      }

      const vinculo = await prisma.therapyProfessional.findUnique({
        where: {
          therapyId_professionalId: {
            therapyId: corpo.therapyId,
            professionalId: corpo.professionalId,
          },
        },
        select: { customDurationMinutes: true, customPriceCents: true },
      });

      const duracao = vinculo?.customDurationMinutes ?? terapia.durationMinutes;
      const preco = vinculo?.customPriceCents ?? terapia.priceCents;
      const startAt = new Date(corpo.startAt);
      const endAt = new Date(startAt.getTime() + duracao * 60_000);
      const status = corpo.status ?? 'AGENDADO_PENDENTE';

      try {
        const agendamento = await prisma.appointment.create({
          data: {
            clinicId: sessao.clinicId,
            clientId: corpo.clientId,
            professionalId: corpo.professionalId,
            therapyId: corpo.therapyId,
            roomId,
            startAt,
            endAt,
            status,
            source: 'ADMIN',
            priceCents: preco,
            notes: corpo.notes ?? null,
            createdByUserId: sessao.userId,
            statusHistory: {
              create: {
                clinicId: sessao.clinicId,
                toStatus: status,
                changedByUserId: sessao.userId,
              },
            },
          },
          include: incluirRelacoes,
        });

        // A sessao ja esta criada: se a preparacao do aviso falhar, a
        // resposta continua 201. Devolver erro aqui diria ao painel que a
        // reserva nao existe -- e ela existe, com horario travado.
        await avisarNovoAgendamento(agendamento.id).catch((erro: unknown) => {
          request.log.error({ err: erro }, 'falha ao preparar notificacoes da nova sessao');
        });

        // Mesmo contrato: a avaliacao clinica e aviso, e falha nela nao
        // desfaz agendamento. E ela roda depois do aviso, para que uma
        // contraindicacao apareca na mesma tela, e nao atras de um envio.
        await avaliarSessao(agendamento.id).catch((erro: unknown) => {
          request.log.error({ err: erro }, 'falha ao avaliar contraindicacoes da nova sessao');
        });

        return reply.code(201).send(resposta(agendamento));
      } catch (error) {
        if (ehConflitoAgenda(error)) {
          return reply.code(409).send({
            error: 'SCHEDULE_CONFLICT',
            message: 'Ja existe uma sessao para este profissional nesse horario.',
          });
        }
        throw error;
      }
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['booking'],
        summary: 'Remarca ou edita uma sessao',
        params: paramsSchema,
        body: appointmentUpdateSchema,
        response: {
          200: appointmentSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const corpo = request.body;
      const { id } = request.params;

      const atual = await prisma.appointment.findFirst({
        where: { id, clinicId: sessao.clinicId },
      });
      if (!atual) {
        return reply
          .code(404)
          .send({ error: 'APPOINTMENT_NOT_FOUND', message: 'Sessao nao encontrada.' });
      }

      const professionalId = corpo.professionalId ?? atual.professionalId;
      const therapyId = corpo.therapyId ?? atual.therapyId;
      const trocouVinculo =
        professionalId !== atual.professionalId || therapyId !== atual.therapyId;

      let duracao = Math.round((atual.endAt.getTime() - atual.startAt.getTime()) / 60_000);
      let preco = atual.priceCents;

      if (trocouVinculo) {
        const [profissional, terapia] = await Promise.all([
          prisma.professional.findFirst({
            where: { id: professionalId, clinicId: sessao.clinicId },
            select: { id: true },
          }),
          prisma.therapy.findFirst({
            where: { id: therapyId, clinicId: sessao.clinicId },
            select: { durationMinutes: true, priceCents: true },
          }),
        ]);
        if (!profissional) {
          return reply
            .code(404)
            .send({ error: 'PROFESSIONAL_NOT_FOUND', message: 'Profissional nao encontrado.' });
        }
        if (!terapia) {
          return reply
            .code(404)
            .send({ error: 'THERAPY_NOT_FOUND', message: 'Terapia nao encontrada.' });
        }

        const vinculo = await prisma.therapyProfessional.findUnique({
          where: { therapyId_professionalId: { therapyId, professionalId } },
          select: { customDurationMinutes: true, customPriceCents: true },
        });
        duracao = vinculo?.customDurationMinutes ?? terapia.durationMinutes;
        preco = vinculo?.customPriceCents ?? terapia.priceCents;
      }

      let roomId = atual.roomId;
      if (corpo.roomId !== undefined) {
        if (corpo.roomId === '') {
          roomId = null;
        } else {
          const sala = await prisma.room.findFirst({
            where: { id: corpo.roomId, clinicId: sessao.clinicId },
            select: { id: true },
          });
          if (!sala) {
            return reply
              .code(404)
              .send({ error: 'ROOM_NOT_FOUND', message: 'Sala nao encontrada.' });
          }
          roomId = sala.id;
        }
      }

      const startAt = corpo.startAt === undefined ? atual.startAt : new Date(corpo.startAt);
      const endAt = new Date(startAt.getTime() + duracao * 60_000);
      const notes =
        corpo.notes === undefined ? atual.notes : corpo.notes === '' ? null : corpo.notes;

      // So interessa avisar quando o horario realmente mudou. Trocar
      // profissional ou terapia no mesmo horario nao e reagendamento, e o
      // cliente nao precisa receber um aviso por isso.
      const mudouHorario = startAt.getTime() !== atual.startAt.getTime();

      try {
        const agendamento = await prisma.appointment.update({
          where: { id },
          data: {
            professionalId,
            therapyId,
            roomId,
            startAt,
            endAt,
            priceCents: preco,
            notes,
          },
          include: incluirRelacoes,
        });

        if (mudouHorario) {
          await avisarReagendamento(id, atual.startAt).catch((erro: unknown) => {
            request.log.error({ err: erro }, 'falha ao preparar notificacoes do reagendamento');
          });
        }

        return reply.code(200).send(resposta(agendamento));
      } catch (error) {
        if (ehConflitoAgenda(error)) {
          return reply.code(409).send({
            error: 'SCHEDULE_CONFLICT',
            message: 'Ja existe uma sessao para este profissional nesse horario.',
          });
        }
        throw error;
      }
    },
  );

  app.patch(
    '/:id/status',
    {
      schema: {
        tags: ['booking'],
        summary: 'Muda o status de uma sessao',
        params: paramsSchema,
        body: appointmentStatusUpdateSchema,
        response: {
          200: appointmentSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
          422: erroSchema,
        },
      },
      preHandler: [app.requireAuth, app.requireRole('ADMIN')],
    },
    async (request, reply) => {
      const sessao = request.auth;
      if (!sessao)
        return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Faca login.' });

      const { id } = request.params;
      const corpo = request.body;

      const atual = await prisma.appointment.findFirst({
        where: { id, clinicId: sessao.clinicId },
        select: { status: true },
      });
      if (!atual) {
        return reply
          .code(404)
          .send({ error: 'APPOINTMENT_NOT_FOUND', message: 'Sessao nao encontrada.' });
      }

      if (!canTransition(atual.status, corpo.status)) {
        return reply.code(422).send({
          error: 'INVALID_TRANSITION',
          message: `Nao e possivel mudar de ${atual.status} para ${corpo.status}.`,
        });
      }

      const agora = new Date();
      const carimbos = {
        CONFIRMADO: { confirmedAt: agora },
        EM_ATENDIMENTO: { startedAt: agora },
        CONCLUIDO: { finishedAt: agora },
        CANCELADO: {
          cancelledAt: agora,
          cancelledByUserId: sessao.userId,
          cancellationReason: corpo.cancellationReason ?? 'NAO_INFORMADO',
        },
        AGENDADO_PENDENTE: {
          cancelledAt: null,
          cancelledByUserId: null,
          cancellationReason: null,
        },
        NO_SHOW: {},
      } as const;

      try {
        const atualizado = await prisma.$transaction(async (tx) => {
          const { count } = await tx.appointment.updateMany({
            where: { id, clinicId: sessao.clinicId },
            data: { status: corpo.status, ...(carimbos[corpo.status] ?? {}) },
          });
          if (count === 0) return null;

          await tx.appointmentStatusHistory.create({
            data: {
              clinicId: sessao.clinicId,
              appointmentId: id,
              fromStatus: atual.status,
              toStatus: corpo.status,
              reason: corpo.reason ?? null,
              changedByUserId: sessao.userId,
            },
          });

          return tx.appointment.findUniqueOrThrow({ where: { id }, include: incluirRelacoes });
        });

        if (!atualizado) {
          return reply
            .code(404)
            .send({ error: 'APPOINTMENT_NOT_FOUND', message: 'Sessao nao encontrada.' });
        }

        // A transacao acima ja consolidou o status; os avisos vem depois.
        // Cada destino tem consequencia diferente para o cliente: confirmar
        // avisa que deu certo, cancelar avisa e aposenta o lembrete, voltar
        // para pendente so precisa rearmar o lembrete. Os demais status
        // (em atendimento, concluido, no-show) nao geram aviso.
        const gatilhos = {
          CONFIRMADO: avisarConfirmacao,
          CANCELADO: avisarCancelamento,
          AGENDADO_PENDENTE: rearmarLembrete,
          // Entrar em atendimento e o momento em que o profissional le o
          // prontuario: e aqui que a versao da anamnese fica congelada para
          // esta sessao. Sem isso, um prontuario reescrito depois mudaria o
          // que o profissional "viu" no dia.
          EM_ATENDIMENTO: vincularAnamnese,
        } as const;

        await (gatilhos[corpo.status as keyof typeof gatilhos]?.(id) ?? Promise.resolve()).catch(
          (erro: unknown) => {
            request.log.error({ err: erro }, 'falha ao preparar notificacoes da mudanca de status');
          },
        );

        return reply.code(200).send(resposta(atualizado));
      } catch (error) {
        if (ehConflitoAgenda(error)) {
          return reply.code(409).send({
            error: 'SCHEDULE_CONFLICT',
            message: 'O horario desta sessao ja esta ocupado por outra sessao.',
          });
        }
        throw error;
      }
    },
  );

  done();
};
