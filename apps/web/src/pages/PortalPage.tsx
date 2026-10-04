import {
  adicionarDias,
  diaDaSemanaDaData,
  formatBRL,
  type PortalBooking,
  type PortalClinic,
  type PortalProfessional,
  type PortalTherapy,
  ROTULOS_DIA_SEMANA,
  type Slot,
} from '@massoterapia/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { CheckboxField, TextareaField, TextField } from '@/components/ui/field';
import { CaixaErro, Panel } from '@/components/ui/panel';
import { ApiError } from '@/lib/api';
import { dataDeHojeISO, formatarData, formatarHoraISO } from '@/lib/format';
import {
  agendarPublico,
  chavesPortal,
  listarProfissionaisPublicos,
  listarSlotsPublicos,
  listarTerapiasPublicas,
  obterClinicaPublica,
} from '@/lib/portal';

/**
 * Portal publico de agendamento (`/agendar/:slug`).
 *
 * Fora da area autenticada: o visitante escolhe terapia, profissional e
 * horario e se identifica por nome e telefone. A solicitacao nasce
 * pendente, para a clinica confirmar.
 */

const DIAS_DE_AGENDA = 20;

function Moldura({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">{children}</div>
    </main>
  );
}

/** "2099-01-05" -> "Segunda, 05/01/2099". */
function rotuloDia(data: string): string {
  return `${ROTULOS_DIA_SEMANA[diaDaSemanaDaData(data)]}, ${formatarData(data)}`;
}

/** Data/hora de um instante, no fuso do navegador. */
function rotuloInstante(valor: string): string {
  return new Date(valor).toLocaleString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PortalPage() {
  const { slug } = useParams<{ slug: string }>();

  if (!slug) {
    return (
      <Moldura>
        <Panel>
          <p className="text-sm text-slate-600">Link de agendamento invalido.</p>
        </Panel>
      </Moldura>
    );
  }

  return <Portal slug={slug} />;
}

function Portal({ slug }: { slug: string }) {
  const clinica = useQuery({
    queryKey: chavesPortal.clinica(slug),
    queryFn: () => obterClinicaPublica(slug),
  });

  if (clinica.isPending) {
    return (
      <Moldura>
        <p className="py-10 text-center text-sm text-slate-500">Carregando...</p>
      </Moldura>
    );
  }

  if (clinica.isError) {
    const naoEncontrada = clinica.error instanceof ApiError && clinica.error.status === 404;
    return (
      <Moldura>
        <Panel className="space-y-2 text-center">
          <h1 className="text-lg font-semibold text-slate-900">
            {naoEncontrada ? 'Link nao encontrado' : 'Nao foi possivel carregar'}
          </h1>
          <p className="text-sm text-slate-600">
            {naoEncontrada
              ? 'Confira o endereco com a clinica. O link pode ter sido alterado.'
              : 'Tente novamente em alguns instantes.'}
          </p>
        </Panel>
      </Moldura>
    );
  }

  return <Agendamento slug={slug} clinica={clinica.data} />;
}

function Agendamento({ slug, clinica }: { slug: string; clinica: PortalClinic }) {
  const [terapiaId, setTerapiaId] = useState<string | null>(null);
  const [profissionalId, setProfissionalId] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [confirmacao, setConfirmacao] = useState<PortalBooking | null>(null);

  const terapias = useQuery({
    queryKey: chavesPortal.terapias(slug),
    queryFn: () => listarTerapiasPublicas(slug),
  });

  const profissionais = useQuery({
    queryKey: chavesPortal.profissionais(slug, terapiaId ?? ''),
    queryFn: () => {
      if (terapiaId === null) throw new Error('Terapia nao escolhida.');
      return listarProfissionaisPublicos(slug, terapiaId);
    },
    enabled: terapiaId !== null,
  });

  const from = dataDeHojeISO();
  const to = adicionarDias(from, DIAS_DE_AGENDA);
  const slots = useQuery({
    queryKey: chavesPortal.slots(slug, terapiaId ?? '', from, profissionalId ?? ''),
    queryFn: () => {
      if (terapiaId === null || profissionalId === null) throw new Error('Agenda incompleta.');
      return listarSlotsPublicos(slug, {
        therapyId: terapiaId,
        professionalId: profissionalId,
        from,
        to,
      });
    },
    enabled: terapiaId !== null && profissionalId !== null,
  });

  const terapia = terapias.data?.items.find((item) => item.id === terapiaId) ?? null;
  const profissional = profissionais.data?.items.find((item) => item.id === profissionalId) ?? null;

  function reiniciar(): void {
    setConfirmacao(null);
    setSlot(null);
    setProfissionalId(null);
    setTerapiaId(null);
  }

  if (confirmacao !== null) {
    return (
      <Moldura>
        <Cabecalho clinica={clinica} />
        <Confirmacao agendamento={confirmacao} onNovo={reiniciar} />
      </Moldura>
    );
  }

  const porDia = new Map<string, Slot[]>();
  for (const item of slots.data?.items ?? []) {
    const lista = porDia.get(item.date) ?? [];
    lista.push(item);
    porDia.set(item.date, lista);
  }

  return (
    <Moldura>
      <Cabecalho clinica={clinica} />

      <Panel className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">1. Escolha a terapia</h2>
        {terapias.isPending ? (
          <p className="text-sm text-slate-500">Carregando...</p>
        ) : terapias.isError ? (
          <CaixaErro mensagem="Nao foi possivel carregar as terapias." />
        ) : terapias.data.items.length === 0 ? (
          <p className="text-sm text-slate-500">
            Esta clinica nao esta com agendamento online disponivel.
          </p>
        ) : (
          <ul className="grid gap-2">
            {terapias.data.items.map((item) => (
              <li key={item.id}>
                <CartaoTerapia
                  terapia={item}
                  selecionada={item.id === terapiaId}
                  onEscolher={() => {
                    setTerapiaId(item.id);
                    setProfissionalId(null);
                    setSlot(null);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {terapiaId !== null ? (
        <Panel className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">2. Escolha o profissional</h2>
          {profissionais.isPending ? (
            <p className="text-sm text-slate-500">Carregando...</p>
          ) : profissionais.isError ? (
            <CaixaErro mensagem="Nao foi possivel carregar os profissionais." />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {profissionais.data.items.map((item) => (
                <li key={item.id}>
                  <CartaoProfissional
                    profissional={item}
                    selecionado={item.id === profissionalId}
                    onEscolher={() => {
                      setProfissionalId(item.id);
                      setSlot(null);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {profissionalId !== null ? (
        <Panel className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">3. Escolha o horario</h2>
          {slots.isPending ? (
            <p className="text-sm text-slate-500">Carregando...</p>
          ) : slots.isError ? (
            <CaixaErro mensagem="Nao foi possivel carregar os horarios." />
          ) : porDia.size === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum horario livre nos proximos dias. Tente outro profissional.
            </p>
          ) : (
            <div className="space-y-4">
              {[...porDia.entries()].map(([dia, horarios]) => (
                <div key={dia} className="space-y-2">
                  <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    {rotuloDia(dia)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {horarios.map((horario) => (
                      <Button
                        key={horario.startAt}
                        type="button"
                        variante={horario.startAt === slot?.startAt ? 'primaria' : 'secundaria'}
                        tamanho="sm"
                        onClick={() => setSlot(horario)}
                      >
                        {formatarHoraISO(horario.startAt)}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {slot !== null && terapiaId !== null && profissionalId !== null ? (
        <Panel className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">4. Seus dados</h2>
          <p className="text-sm text-slate-600">
            {terapia?.name} com {profissional?.name} em {rotuloInstante(slot.startAt)}.
          </p>
          <FormularioAgendamento
            slug={slug}
            therapyId={terapiaId}
            professionalId={profissionalId}
            slot={slot}
            onVoltar={() => setSlot(null)}
            onConcluir={setConfirmacao}
          />
        </Panel>
      ) : null}

      {clinica.bookingTerms !== null ? (
        <Panel className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-800">Antes de agendar</h2>
          <p className="text-sm whitespace-pre-line text-slate-600">{clinica.bookingTerms}</p>
        </Panel>
      ) : null}
    </Moldura>
  );
}

function Cabecalho({ clinica }: { clinica: PortalClinic }) {
  const endereco = [
    clinica.addressLine1,
    clinica.addressLine2,
    [clinica.addressCity, clinica.addressState].filter(Boolean).join('/'),
  ]
    .filter((parte) => parte !== null && parte !== '')
    .join(' - ');

  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{clinica.name}</h1>
      <p className="text-sm text-slate-600">Agende seu atendimento online.</p>
      {endereco !== '' ? <p className="text-sm text-slate-500">{endereco}</p> : null}
      {clinica.phone !== null ? (
        <p className="text-sm text-slate-500">Telefone: {clinica.phone}</p>
      ) : null}
    </header>
  );
}

function CartaoTerapia({
  terapia,
  selecionada,
  onEscolher,
}: {
  terapia: PortalTherapy;
  selecionada: boolean;
  onEscolher: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEscolher}
      className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${
        selecionada
          ? 'border-brand-400 bg-brand-50'
          : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-900">{terapia.name}</span>
        <span className="text-sm font-semibold text-brand-700">
          {formatBRL(terapia.priceCents)}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-slate-500">
        {terapia.durationMinutes} min
        {terapia.category !== null ? ` - ${terapia.category}` : ''}
      </div>
      {terapia.description !== null ? (
        <p className="mt-1 text-sm text-slate-600">{terapia.description}</p>
      ) : null}
    </button>
  );
}

function CartaoProfissional({
  profissional,
  selecionado,
  onEscolher,
}: {
  profissional: PortalProfessional;
  selecionado: boolean;
  onEscolher: () => void;
}) {
  const registro =
    profissional.registrationType !== null && profissional.registrationNumber !== null
      ? `${profissional.registrationType} ${profissional.registrationNumber}`
      : null;

  return (
    <button
      type="button"
      onClick={onEscolher}
      className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${
        selecionado
          ? 'border-brand-400 bg-brand-50'
          : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/50'
      }`}
    >
      <span className="font-medium text-slate-900">{profissional.name}</span>
      {registro !== null ? <span className="block text-xs text-slate-500">{registro}</span> : null}
      {profissional.bio !== null ? (
        <span className="mt-1 block text-sm text-slate-600">{profissional.bio}</span>
      ) : null}
    </button>
  );
}

function FormularioAgendamento({
  slug,
  therapyId,
  professionalId,
  slot,
  onVoltar,
  onConcluir,
}: {
  slug: string;
  therapyId: string;
  professionalId: string;
  slot: Slot;
  onVoltar: () => void;
  onConcluir: (agendamento: PortalBooking) => void;
}) {
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [notas, setNotas] = useState('');
  const [marketing, setMarketing] = useState(false);

  const agendar = useMutation({
    mutationFn: () =>
      agendarPublico(slug, {
        therapyId,
        professionalId,
        startAt: slot.startAt,
        name: nome,
        phone: telefone,
        ...(email.trim() === '' ? {} : { email }),
        ...(notas.trim() === '' ? {} : { notes: notas }),
        marketingOptIn: marketing,
      }),
    onSuccess: onConcluir,
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    agendar.mutate();
  }

  const erro = agendar.isError
    ? agendar.error instanceof ApiError
      ? agendar.error.message
      : 'Nao foi possivel concluir. Tente novamente.'
    : null;

  return (
    <form onSubmit={enviar} className="space-y-4">
      <TextField
        label="Nome"
        required
        maxLength={120}
        value={nome}
        onChange={(evento) => setNome(evento.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Telefone (WhatsApp)"
          required
          placeholder="(51) 99999-8888"
          value={telefone}
          onChange={(evento) => setTelefone(evento.target.value)}
        />
        <TextField
          label="E-mail (opcional)"
          type="email"
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
        />
      </div>
      <TextareaField
        label="Observacoes (opcional)"
        maxLength={500}
        value={notas}
        onChange={(evento) => setNotas(evento.target.value)}
      />
      <CheckboxField
        label="Aceito receber comunicacoes da clinica"
        checked={marketing}
        onChange={(evento) => setMarketing(evento.target.checked)}
      />

      {erro !== null ? <CaixaErro mensagem={erro} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onVoltar}>
          Voltar
        </Button>
        <Button type="submit" disabled={agendar.isPending}>
          {agendar.isPending ? 'Enviando...' : 'Confirmar agendamento'}
        </Button>
      </div>
    </form>
  );
}

function Confirmacao({ agendamento, onNovo }: { agendamento: PortalBooking; onNovo: () => void }) {
  return (
    <Panel className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">Agendamento solicitado</h2>
        <p className="text-sm text-slate-600">
          Recebemos seu pedido. A clinica vai confirmar o horario em breve.
        </p>
      </div>

      <dl className="space-y-2 text-sm">
        <Linha rotulo="Clinica" valor={agendamento.clinicName} />
        <Linha rotulo="Terapia" valor={agendamento.therapyName} />
        <Linha rotulo="Profissional" valor={agendamento.professionalName} />
        <Linha rotulo="Quando" valor={rotuloInstante(agendamento.startAt)} />
        <Linha rotulo="Valor" valor={formatBRL(agendamento.priceCents)} />
        <Linha rotulo="Nome" valor={agendamento.clientName} />
      </dl>

      <Button type="button" variante="secundaria" onClick={onNovo}>
        Fazer outro agendamento
      </Button>
    </Panel>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
      <dt className="text-slate-500">{rotulo}</dt>
      <dd className="text-right font-medium text-slate-800">{valor}</dd>
    </div>
  );
}
