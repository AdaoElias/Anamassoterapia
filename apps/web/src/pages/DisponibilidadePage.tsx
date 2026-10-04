import {
  adicionarDias,
  AVAILABILITY_EXCEPTION_TYPE_LABELS,
  type AvailabilityExceptionCreate,
  type AvailabilityRule,
  type AvailabilityRuleCreate,
  type AvailabilityRuleUpdate,
  horaParaMinutos,
  minutosParaHora,
  ROTULOS_DIA_SEMANA,
} from '@massoterapia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { CaixaErro, Carregando, EstadoVazio, PageHeader, Panel } from '@/components/ui/panel';
import {
  atualizarRegra,
  criarExcecao,
  criarFeriado,
  criarRegra,
  desativarRegra,
  listarExcecoes,
  listarFeriados,
  listarRegras,
  removerExcecao,
  removerFeriado,
} from '@/lib/agenda';
import { listarProfissionais, mensagemDeErro } from '@/lib/cadastros';
import { dataDeHojeISO, formatarData } from '@/lib/format';

/** Disponibilidade dos profissionais: regras, excecoes e feriados. */
export function DisponibilidadePage() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';

  const [professionalId, setProfessionalId] = useState('');
  const [from, setFrom] = useState(dataDeHojeISO());
  const [to, setTo] = useState(adicionarDias(dataDeHojeISO(), 59));
  const [editandoRegra, setEditandoRegra] = useState<AvailabilityRule | 'nova' | null>(null);
  const [criandoExcecao, setCriandoExcecao] = useState(false);
  const [criandoFeriado, setCriandoFeriado] = useState(false);

  const profissionais = useQuery({
    queryKey: ['profissionais'],
    queryFn: () => listarProfissionais({}),
  });

  const regras = useQuery({
    queryKey: ['disponibilidade', 'regras', professionalId],
    queryFn: () => listarRegras(professionalId, true),
    enabled: professionalId !== '',
  });

  const excecoes = useQuery({
    queryKey: ['disponibilidade', 'excecoes', professionalId, from, to],
    queryFn: () => listarExcecoes(professionalId, from, to),
    enabled: professionalId !== '',
  });

  const feriados = useQuery({
    queryKey: ['disponibilidade', 'feriados', from, to],
    queryFn: () => listarFeriados(from, to),
  });

  const queryClient = useQueryClient();
  const invalidar = () => queryClient.invalidateQueries({ queryKey: ['disponibilidade'] });

  const alternarRegra = useMutation({
    mutationFn: async (regra: AvailabilityRule) => {
      if (regra.active) await desativarRegra(regra.id);
      else await atualizarRegra(regra.id, { active: true });
    },
    onSuccess: () => void invalidar(),
  });

  const removerExcecaoMut = useMutation({
    mutationFn: (id: string) => removerExcecao(id),
    onSuccess: () => void invalidar(),
  });

  const removerFeriadoMut = useMutation({
    mutationFn: (id: string) => removerFeriado(id),
    onSuccess: () => void invalidar(),
  });

  const regrasOrdenadas = useMemo(
    () =>
      [...(regras.data?.items ?? [])].sort(
        (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
      ),
    [regras.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Disponibilidade"
        descricao="Horarios de atendimento, folgas e feriados."
      />

      <Panel className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            label="Profissional"
            value={professionalId}
            onChange={(e) => setProfessionalId(e.target.value)}
          >
            <option value="">Selecione</option>
            {(profissionais.data?.items ?? []).map((profissional) => (
              <option key={profissional.id} value={profissional.id}>
                {profissional.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="De"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField label="Ate" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </Panel>

      {professionalId === '' ? (
        <Panel>
          <EstadoVazio mensagem="Escolha um profissional para ver a disponibilidade." />
        </Panel>
      ) : (
        <div className="space-y-6">
          <Panel className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                Grade semanal
              </h2>
              {podeEscrever ? (
                <Button tamanho="sm" onClick={() => setEditandoRegra('nova')}>
                  Nova regra
                </Button>
              ) : null}
            </div>

            {alternarRegra.isError ? (
              <CaixaErro mensagem={mensagemDeErro(alternarRegra.error)} />
            ) : null}
            {regras.isPending ? (
              <Carregando />
            ) : regrasOrdenadas.length === 0 ? (
              <EstadoVazio mensagem="Nenhuma regra cadastrada." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {regrasOrdenadas.map((regra) => (
                  <li key={regra.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="w-20 text-sm font-medium text-slate-700">
                      {ROTULOS_DIA_SEMANA[regra.weekday]}
                    </span>
                    <span className="font-mono text-sm text-slate-600">
                      {minutosParaHora(regra.startMinute)} - {minutosParaHora(regra.endMinute)}
                    </span>
                    <span className="text-xs text-slate-400">
                      a cada {regra.slotGranularityMinutes} min
                    </span>
                    <span className="text-xs text-slate-400">
                      de {formatarData(regra.effectiveFrom)}
                      {regra.effectiveTo !== null ? ` ate ${formatarData(regra.effectiveTo)}` : ''}
                    </span>
                    <Badge tone={regra.active ? 'success' : 'neutral'}>
                      {regra.active ? 'Ativa' : 'Inativa'}
                    </Badge>
                    {podeEscrever ? (
                      <span className="ml-auto flex gap-1">
                        <Button
                          variante="fantasma"
                          tamanho="sm"
                          onClick={() => setEditandoRegra(regra)}
                        >
                          Editar
                        </Button>
                        <Button
                          variante="fantasma"
                          tamanho="sm"
                          disabled={alternarRegra.isPending}
                          onClick={() => alternarRegra.mutate(regra)}
                        >
                          {regra.active ? 'Desativar' : 'Reativar'}
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                Excecoes ({formatarData(from)} - {formatarData(to)})
              </h2>
              {podeEscrever ? (
                <Button tamanho="sm" onClick={() => setCriandoExcecao(true)}>
                  Nova excecao
                </Button>
              ) : null}
            </div>

            {removerExcecaoMut.isError ? (
              <CaixaErro mensagem={mensagemDeErro(removerExcecaoMut.error)} />
            ) : null}
            {excecoes.isPending ? (
              <Carregando />
            ) : (excecoes.data?.items.length ?? 0) === 0 ? (
              <EstadoVazio mensagem="Nenhuma excecao no periodo." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {excecoes.data?.items.map((excecao) => (
                  <li key={excecao.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="w-24 text-sm text-slate-700">
                      {formatarData(excecao.date)}
                    </span>
                    <Badge tone={excecao.type === 'EXTRA' ? 'brand' : 'warning'}>
                      {AVAILABILITY_EXCEPTION_TYPE_LABELS[excecao.type]}
                    </Badge>
                    <span className="font-mono text-sm text-slate-600">
                      {excecao.startMinute === null
                        ? 'dia inteiro'
                        : `${minutosParaHora(excecao.startMinute)} - ${minutosParaHora(excecao.endMinute ?? 0)}`}
                    </span>
                    {excecao.reason !== null ? (
                      <span className="text-xs text-slate-400">{excecao.reason}</span>
                    ) : null}
                    {podeEscrever ? (
                      <Button
                        className="ml-auto"
                        variante="perigo"
                        tamanho="sm"
                        disabled={removerExcecaoMut.isPending}
                        onClick={() => removerExcecaoMut.mutate(excecao.id)}
                      >
                        Remover
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                Feriados da clinica
              </h2>
              {podeEscrever ? (
                <Button tamanho="sm" onClick={() => setCriandoFeriado(true)}>
                  Novo feriado
                </Button>
              ) : null}
            </div>

            {removerFeriadoMut.isError ? (
              <CaixaErro mensagem={mensagemDeErro(removerFeriadoMut.error)} />
            ) : null}
            {feriados.isPending ? (
              <Carregando />
            ) : (feriados.data?.items.length ?? 0) === 0 ? (
              <EstadoVazio mensagem="Nenhum feriado no periodo." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {feriados.data?.items.map((feriado) => (
                  <li key={feriado.id} className="flex items-center gap-3 py-2">
                    <span className="w-24 text-sm text-slate-700">
                      {formatarData(feriado.date)}
                    </span>
                    <span className="text-sm text-slate-600">
                      {feriado.description ?? 'Feriado'}
                    </span>
                    {podeEscrever ? (
                      <Button
                        className="ml-auto"
                        variante="perigo"
                        tamanho="sm"
                        disabled={removerFeriadoMut.isPending}
                        onClick={() => removerFeriadoMut.mutate(feriado.id)}
                      >
                        Remover
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      <Modal
        aberto={editandoRegra !== null}
        titulo={editandoRegra === 'nova' ? 'Nova regra' : 'Editar regra'}
        onFechar={() => setEditandoRegra(null)}
      >
        {editandoRegra !== null ? (
          <FormularioRegra
            professionalId={professionalId}
            regra={editandoRegra === 'nova' ? null : editandoRegra}
            onConcluir={() => setEditandoRegra(null)}
          />
        ) : null}
      </Modal>

      <Modal
        aberto={criandoExcecao}
        titulo="Nova excecao"
        onFechar={() => setCriandoExcecao(false)}
      >
        <FormularioExcecao
          professionalId={professionalId}
          dataInicial={from}
          onConcluir={() => setCriandoExcecao(false)}
        />
      </Modal>

      <Modal
        aberto={criandoFeriado}
        titulo="Novo feriado"
        onFechar={() => setCriandoFeriado(false)}
      >
        <FormularioFeriado onConcluir={() => setCriandoFeriado(false)} />
      </Modal>
    </div>
  );
}

function FormularioRegra({
  professionalId,
  regra,
  onConcluir,
}: {
  professionalId: string;
  regra: AvailabilityRule | null;
  onConcluir: () => void;
}) {
  const queryClient = useQueryClient();
  const [weekday, setWeekday] = useState(String(regra?.weekday ?? 1));
  const [inicio, setInicio] = useState(regra ? minutosParaHora(regra.startMinute) : '09:00');
  const [fim, setFim] = useState(regra ? minutosParaHora(regra.endMinute) : '18:00');
  const [granularidade, setGranularidade] = useState(String(regra?.slotGranularityMinutes ?? 15));
  const [effectiveFrom, setEffectiveFrom] = useState(regra?.effectiveFrom ?? dataDeHojeISO());
  const [effectiveTo, setEffectiveTo] = useState(regra?.effectiveTo ?? '');
  const [active, setActive] = useState(regra?.active ?? true);
  const [erro, setErro] = useState('');

  const salvar = useMutation({
    mutationFn: (body: AvailabilityRuleCreate | AvailabilityRuleUpdate) =>
      regra ? atualizarRegra(regra.id, body) : criarRegra(body as AvailabilityRuleCreate),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['disponibilidade'] });
      onConcluir();
    },
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    const startMinute = horaParaMinutos(inicio);
    const endMinute = horaParaMinutos(fim);
    const granularity = Number(granularidade);
    if (startMinute === null || endMinute === null) {
      setErro('Horario invalido.');
      return;
    }
    if (startMinute >= endMinute) {
      setErro('O horario final deve ser depois do inicial.');
      return;
    }
    setErro('');
    const corpo: AvailabilityRuleCreate = {
      professionalId,
      weekday: Number(weekday),
      startMinute,
      endMinute,
      slotGranularityMinutes: granularity,
      effectiveFrom,
      effectiveTo,
      active,
    };
    salvar.mutate(corpo);
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Dia da semana"
          value={weekday}
          onChange={(e) => setWeekday(e.target.value)}
        >
          {ROTULOS_DIA_SEMANA.map((rotulo, indice) => (
            <option key={rotulo} value={indice}>
              {rotulo}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Intervalo entre horarios (min)"
          type="number"
          min={5}
          max={240}
          value={granularidade}
          onChange={(e) => setGranularidade(e.target.value)}
        />
        <TextField
          label="Inicio"
          type="time"
          required
          value={inicio}
          onChange={(e) => setInicio(e.target.value)}
        />
        <TextField
          label="Fim"
          type="time"
          required
          value={fim}
          onChange={(e) => setFim(e.target.value)}
        />
        <TextField
          label="Vigencia inicial"
          type="date"
          required
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
        <TextField
          label="Vigencia final"
          type="date"
          value={effectiveTo}
          onChange={(e) => setEffectiveTo(e.target.value)}
        />
      </div>

      <CheckboxField
        label="Regra ativa"
        checked={active}
        onChange={(e) => setActive(e.target.checked)}
      />

      {erro !== '' ? <CaixaErro mensagem={erro} /> : null}
      {salvar.isError ? <CaixaErro mensagem={mensagemDeErro(salvar.error)} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}

function FormularioExcecao({
  professionalId,
  dataInicial,
  onConcluir,
}: {
  professionalId: string;
  dataInicial: string;
  onConcluir: () => void;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(dataInicial);
  const [type, setType] = useState<'BLOQUEIO' | 'EXTRA'>('BLOQUEIO');
  const [diaInteiro, setDiaInteiro] = useState(true);
  const [inicio, setInicio] = useState('09:00');
  const [fim, setFim] = useState('18:00');
  const [reason, setReason] = useState('');
  const [erro, setErro] = useState('');

  const salvar = useMutation({
    mutationFn: (body: AvailabilityExceptionCreate) => criarExcecao(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['disponibilidade'] });
      onConcluir();
    },
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    const parcial = type === 'EXTRA' || !diaInteiro;
    let startMinute: number | undefined;
    let endMinute: number | undefined;
    if (parcial) {
      const inicioMin = horaParaMinutos(inicio);
      const fimMin = horaParaMinutos(fim);
      if (inicioMin === null || fimMin === null || inicioMin >= fimMin) {
        setErro('Informe um intervalo valido.');
        return;
      }
      startMinute = inicioMin;
      endMinute = fimMin;
    }
    setErro('');
    salvar.mutate({
      professionalId,
      date,
      type,
      startMinute,
      endMinute,
      reason: reason.trim() === '' ? undefined : reason,
      active: true,
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Data"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <SelectField
          label="Tipo"
          value={type}
          onChange={(e) => setType(e.target.value as 'BLOQUEIO' | 'EXTRA')}
        >
          <option value="BLOQUEIO">Bloqueio (folga)</option>
          <option value="EXTRA">Janela extra</option>
        </SelectField>
      </div>

      {type === 'BLOQUEIO' ? (
        <CheckboxField
          label="Dia inteiro"
          checked={diaInteiro}
          onChange={(e) => setDiaInteiro(e.target.checked)}
        />
      ) : null}

      {type === 'EXTRA' || !diaInteiro ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Inicio"
            type="time"
            required
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
          />
          <TextField
            label="Fim"
            type="time"
            required
            value={fim}
            onChange={(e) => setFim(e.target.value)}
          />
        </div>
      ) : null}

      <TextField
        label="Motivo (opcional)"
        maxLength={200}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />

      {erro !== '' ? <CaixaErro mensagem={erro} /> : null}
      {salvar.isError ? <CaixaErro mensagem={mensagemDeErro(salvar.error)} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}

function FormularioFeriado({ onConcluir }: { onConcluir: () => void }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(dataDeHojeISO());
  const [description, setDescription] = useState('');

  const salvar = useMutation({
    mutationFn: () =>
      criarFeriado({
        date,
        description: description.trim() === '' ? undefined : description,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['disponibilidade'] });
      onConcluir();
    },
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <TextField
        label="Data"
        type="date"
        required
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <TextField
        label="Descricao"
        maxLength={120}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      {salvar.isError ? <CaixaErro mensagem={mensagemDeErro(salvar.error)} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}
