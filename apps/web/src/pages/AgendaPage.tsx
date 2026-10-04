import {
  type Appointment,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TRANSITIONS,
  type AppointmentStatus,
} from '@massoterapia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectField, TextareaField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { CaixaErro, Carregando, EstadoVazio, PageHeader, Panel } from '@/components/ui/panel';
import {
  atualizarAgendamento,
  criarAgendamento,
  listarAgendamentos,
  listarSlots,
  mudarStatusAgendamento,
} from '@/lib/agenda';
import {
  listarClientes,
  listarProfissionais,
  listarTerapias,
  mensagemDeErro,
} from '@/lib/cadastros';
import { dataDeHojeISO, formatarHoraISO, formatBRL, paraInputDateTime } from '@/lib/format';

/** Agenda do dia, agrupada por profissional. */
export function AgendaPage() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [data, setData] = useState(dataDeHojeISO());
  const [profissionalId, setProfissionalId] = useState('');
  const [criando, setCriando] = useState(false);
  const [remarcando, setRemarcando] = useState<Appointment | null>(null);

  const profissionais = useQuery({
    queryKey: ['profissionais'],
    queryFn: () => listarProfissionais({}),
  });

  const {
    data: agenda,
    isPending,
    isError,
  } = useQuery({
    queryKey: ['agenda', 'agendamentos', data, profissionalId],
    queryFn: () =>
      listarAgendamentos({
        from: data,
        to: data,
        professionalId: profissionalId === '' ? undefined : profissionalId,
      }),
  });

  const mudarStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AppointmentStatus }) =>
      mudarStatusAgendamento(id, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agenda'] });
    },
  });

  const grupos = useMemo(() => {
    const mapa = new Map<string, { nome: string; itens: Appointment[] }>();
    for (const item of agenda?.items ?? []) {
      const grupo = mapa.get(item.professionalId) ?? { nome: item.professionalName, itens: [] };
      grupo.itens.push(item);
      mapa.set(item.professionalId, grupo);
    }
    return [...mapa.values()];
  }, [agenda]);

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Agenda"
        descricao="Sessoes do dia por profissional."
        acoes={
          podeEscrever ? <Button onClick={() => setCriando(true)}>Nova sessao</Button> : undefined
        }
      />

      <Panel className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Dia"
            type="date"
            value={data}
            onChange={(evento) => setData(evento.target.value)}
          />
          <SelectField
            label="Profissional"
            value={profissionalId}
            onChange={(evento) => setProfissionalId(evento.target.value)}
          >
            <option value="">Todos</option>
            {(profissionais.data?.items ?? []).map((profissional) => (
              <option key={profissional.id} value={profissional.id}>
                {profissional.name}
              </option>
            ))}
          </SelectField>
        </div>

        {mudarStatus.isError ? <CaixaErro mensagem={mensagemDeErro(mudarStatus.error)} /> : null}

        {isPending ? (
          <Carregando />
        ) : isError ? (
          <CaixaErro mensagem="Nao foi possivel carregar a agenda." />
        ) : grupos.length === 0 ? (
          <EstadoVazio mensagem="Nenhuma sessao neste dia." />
        ) : (
          <div className="space-y-6">
            {grupos.map((grupo) => (
              <div key={grupo.nome} className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">
                  {grupo.nome}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {grupo.itens.length} sessao(oes)
                  </span>
                </h3>
                <ul className="space-y-2">
                  {grupo.itens.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2"
                    >
                      <span className="w-28 font-mono text-sm text-slate-700">
                        {formatarHoraISO(item.startAt)} - {formatarHoraISO(item.endAt)}
                      </span>
                      <span className="min-w-40 flex-1 text-sm text-slate-800">
                        {item.clientName}
                        <span className="ml-2 text-xs text-slate-400">{item.therapyName}</span>
                      </span>
                      <Badge tone={item.status === 'CANCELADO' ? 'neutral' : 'success'}>
                        {APPOINTMENT_STATUS_LABELS[item.status]}
                      </Badge>
                      <span className="text-sm text-slate-500">{formatBRL(item.priceCents)}</span>
                      {podeEscrever ? (
                        <span className="flex flex-wrap gap-1">
                          {APPOINTMENT_TRANSITIONS[item.status].map((proximo) => (
                            <Button
                              key={proximo}
                              variante="fantasma"
                              tamanho="sm"
                              disabled={mudarStatus.isPending}
                              onClick={() => mudarStatus.mutate({ id: item.id, status: proximo })}
                            >
                              {APPOINTMENT_STATUS_LABELS[proximo]}
                            </Button>
                          ))}
                          <Button
                            variante="fantasma"
                            tamanho="sm"
                            onClick={() => setRemarcando(item)}
                          >
                            Remarcar
                          </Button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Modal aberto={criando} titulo="Nova sessao" onFechar={() => setCriando(false)}>
        <FormularioNova onConcluir={() => setCriando(false)} dataInicial={data} />
      </Modal>

      <Modal
        aberto={remarcando !== null}
        titulo="Remarcar sessao"
        onFechar={() => setRemarcando(null)}
      >
        {remarcando ? (
          <FormularioRemarcar agendamento={remarcando} onConcluir={() => setRemarcando(null)} />
        ) : null}
      </Modal>
    </div>
  );
}

function SeletorDeHorario({
  therapyId,
  professionalId,
  data,
  valor,
  onChange,
}: {
  therapyId: string;
  professionalId: string;
  data: string;
  valor: string;
  onChange: (iso: string) => void;
}) {
  const pronto = therapyId !== '' && professionalId !== '' && data !== '';

  const { data: slots, isPending } = useQuery({
    queryKey: ['agenda', 'slots', therapyId, professionalId, data],
    queryFn: () => listarSlots({ therapyId, from: data, to: data, professionalId }),
    enabled: pronto,
  });

  if (!pronto) {
    return <p className="text-xs text-slate-400">Escolha terapia, profissional e data.</p>;
  }
  if (isPending) return <Carregando />;
  if ((slots?.items.length ?? 0) === 0) {
    return <p className="text-xs text-slate-400">Nenhum horario livre nesta data.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {slots?.items.map((slot) => (
        <Button
          key={slot.startAt}
          type="button"
          variante={valor === slot.startAt ? 'primaria' : 'secundaria'}
          tamanho="sm"
          onClick={() => onChange(slot.startAt)}
        >
          {formatarHoraISO(slot.startAt)}
        </Button>
      ))}
    </div>
  );
}

function FormularioNova({
  onConcluir,
  dataInicial,
}: {
  onConcluir: () => void;
  dataInicial: string;
}) {
  const queryClient = useQueryClient();
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: () => listarClientes({}) });
  const terapias = useQuery({ queryKey: ['terapias'], queryFn: () => listarTerapias({}) });
  const profissionais = useQuery({
    queryKey: ['profissionais'],
    queryFn: () => listarProfissionais({}),
  });

  const [clientId, setClientId] = useState('');
  const [therapyId, setTherapyId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [data, setData] = useState(dataInicial);
  const [startAt, setStartAt] = useState('');
  const [notes, setNotes] = useState('');

  const salvar = useMutation({
    mutationFn: () =>
      criarAgendamento({
        clientId,
        professionalId,
        therapyId,
        startAt,
        notes: notes.trim() === '' ? undefined : notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agenda'] });
      onConcluir();
    },
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <SelectField
        label="Cliente"
        required
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
      >
        <option value="">Selecione</option>
        {(clientes.data?.items ?? []).map((cliente) => (
          <option key={cliente.id} value={cliente.id}>
            {cliente.name}
          </option>
        ))}
      </SelectField>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Terapia"
          required
          value={therapyId}
          onChange={(e) => {
            setTherapyId(e.target.value);
            setStartAt('');
          }}
        >
          <option value="">Selecione</option>
          {(terapias.data?.items ?? []).map((terapia) => (
            <option key={terapia.id} value={terapia.id}>
              {terapia.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Profissional"
          required
          value={professionalId}
          onChange={(e) => {
            setProfessionalId(e.target.value);
            setStartAt('');
          }}
        >
          <option value="">Selecione</option>
          {(profissionais.data?.items ?? []).map((profissional) => (
            <option key={profissional.id} value={profissional.id}>
              {profissional.name}
            </option>
          ))}
        </SelectField>
      </div>

      <TextField
        label="Dia"
        type="date"
        required
        value={data}
        onChange={(e) => {
          setData(e.target.value);
          setStartAt('');
        }}
      />

      <SeletorDeHorario
        therapyId={therapyId}
        professionalId={professionalId}
        data={data}
        valor={startAt}
        onChange={setStartAt}
      />

      <TextareaField
        label="Observacoes"
        maxLength={1000}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {salvar.isError ? <CaixaErro mensagem={mensagemDeErro(salvar.error)} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvar.isPending || startAt === ''}>
          {salvar.isPending ? 'Salvando...' : 'Agendar'}
        </Button>
      </div>
    </form>
  );
}

function FormularioRemarcar({
  agendamento,
  onConcluir,
}: {
  agendamento: Appointment;
  onConcluir: () => void;
}) {
  const queryClient = useQueryClient();
  const [data, setData] = useState(agendamento.startAt.slice(0, 10));
  const [startAt, setStartAt] = useState(agendamento.startAt);
  const [notes, setNotes] = useState(agendamento.notes ?? '');

  const salvar = useMutation({
    mutationFn: () =>
      atualizarAgendamento(agendamento.id, {
        startAt,
        notes: notes.trim() === '' ? '' : notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agenda'] });
      onConcluir();
    },
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <p className="text-sm text-slate-600">
        {agendamento.clientName} · {agendamento.therapyName} com {agendamento.professionalName}
      </p>
      <p className="text-xs text-slate-400">
        Horario atual: {paraInputDateTime(agendamento.startAt).replace('T', ' ')}
      </p>

      <TextField
        label="Novo dia"
        type="date"
        required
        value={data}
        onChange={(e) => {
          setData(e.target.value);
          setStartAt('');
        }}
      />

      <SeletorDeHorario
        therapyId={agendamento.therapyId}
        professionalId={agendamento.professionalId}
        data={data}
        valor={startAt}
        onChange={setStartAt}
      />

      <TextareaField
        label="Observacoes"
        maxLength={1000}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {salvar.isError ? <CaixaErro mensagem={mensagemDeErro(salvar.error)} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvar.isPending || startAt === ''}>
          {salvar.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}
