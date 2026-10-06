import {
  COMMISSION_STATUS_LABELS,
  COMMISSION_STATUSES,
  type CommissionStatus,
  FINANCIAL_ENTRY_KINDS,
  FINANCIAL_ENTRY_STATUS_LABELS,
  FINANCIAL_ENTRY_STATUSES,
  type FinancialEntry,
  type FinancialEntryCreate,
  type FinancialEntryKind,
  type FinancialEntryPaymentInput,
  type FinancialEntryStatus,
  type Package,
  PACKAGE_SESSION_STATUS_LABELS,
  PACKAGE_STATUS_LABELS,
  PACKAGE_STATUSES,
  type PackageDetail,
  type PackageStatus,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@massoterapia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField, TextareaField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { CaixaErro, Carregando, EstadoVazio, PageHeader, Panel } from '@/components/ui/panel';
import { listarClientes, listarProfissionais, mensagemDeErro } from '@/lib/cadastros';
import {
  aprovarComissao,
  cancelarComissao,
  cancelarLancamento,
  chavesFinanceiro,
  criarLancamento,
  criarPacote,
  disponibilizarSessao,
  listarComissoes,
  listarLancamentos,
  listarPacotes,
  mudarStatusPacote,
  obterPacote,
  obterResumo,
  pagarComissao,
  pagarLancamento,
  usarSessao,
} from '@/lib/financeiro';
import { dataDeHojeISO, formatarData, formatBRL, paraCentavos } from '@/lib/format';

const ABAS = ['lancamentos', 'pacotes', 'comissoes', 'resumo'] as const;
type Aba = (typeof ABAS)[number];

const KIND_LABELS: Record<FinancialEntryKind, string> = {
  RECEITA: 'Receita',
  DESPESA: 'Despesa',
  COMISSAO: 'Comissao',
};

const TOM_ENTRADA: Record<FinancialEntryStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  PENDENTE: 'warning',
  PAGO: 'success',
  CANCELADO: 'neutral',
  INADIMPENTE: 'danger',
};

const TOM_PACOTE: Record<PackageStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  ATIVO: 'success',
  CONCLUIDO: 'neutral',
  CANCELADO: 'neutral',
  EXPIRADO: 'warning',
};

const TOM_COMISSAO: Record<
  CommissionStatus,
  'neutral' | 'success' | 'warning' | 'danger' | 'brand'
> = {
  PREVISTA: 'warning',
  APROVADA: 'brand',
  PAGA: 'success',
  CANCELADA: 'neutral',
};

/** "2026-02-03T14:05:00.000Z" -> "03/02/2026", no fuso do navegador. */
function rotuloDataISO(valor: string): string {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleDateString('pt-BR');
}

export function FinanceiroPage() {
  const [aba, setAba] = useState<Aba>('lancamentos');

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Financeiro"
        descricao="O que entrou, o que entra, pacotes de sessoes e comissoes dos profissionais."
      />

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {ABAS.map((valor) => (
          <button
            key={valor}
            type="button"
            onClick={() => setAba(valor)}
            className={`border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${
              aba === valor
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {valor === 'lancamentos' && 'Lancamentos'}
            {valor === 'pacotes' && 'Pacotes'}
            {valor === 'comissoes' && 'Comissoes'}
            {valor === 'resumo' && 'Resumo'}
          </button>
        ))}
      </div>

      {aba === 'lancamentos' ? <AbaLancamentos /> : null}
      {aba === 'pacotes' ? <AbaPacotes /> : null}
      {aba === 'comissoes' ? <AbaComissoes /> : null}
      {aba === 'resumo' ? <AbaResumo /> : null}
    </div>
  );
}

// --- Lancamentos ------------------------------------------------------

function AbaLancamentos() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [kind, setKind] = useState<FinancialEntryKind | ''>('');
  const [status, setStatus] = useState<FinancialEntryStatus | ''>('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [pagina, setPagina] = useState(0);
  const [criando, setCriando] = useState(false);
  const [liquidando, setLiquidando] = useState<FinancialEntry | null>(null);
  const POR_PAGINA = 25;

  const filtro = {
    page: pagina + 1,
    perPage: POR_PAGINA,
    kind: kind === '' ? undefined : kind,
    status: status === '' ? undefined : status,
    de: de === '' ? undefined : de,
    ate: ate === '' ? undefined : ate,
  };

  const { data, isPending, isError } = useQuery({
    queryKey: chavesFinanceiro.lancamentos(filtro),
    queryFn: () => listarLancamentos(filtro),
  });

  function invalidar(): void {
    void queryClient.invalidateQueries({ queryKey: ['financeiro'] });
  }

  function trocarFiltro(apply: () => void): void {
    apply();
    setPagina(0);
  }

  const cancelar = useMutation({
    mutationFn: (id: string) => cancelarLancamento(id, {}),
    onSuccess: invalidar,
  });

  const totalPaginas = data === undefined ? 0 : data.meta.totalPages;

  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label="Tipo"
            value={kind}
            onChange={(evento) =>
              trocarFiltro(() => setKind(evento.target.value as FinancialEntryKind | ''))
            }
          >
            <option value="">Todos</option>
            {FINANCIAL_ENTRY_KINDS.map((valor) => (
              <option key={valor} value={valor}>
                {KIND_LABELS[valor]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Situacao"
            value={status}
            onChange={(evento) =>
              trocarFiltro(() => setStatus(evento.target.value as FinancialEntryStatus | ''))
            }
          >
            <option value="">Todas</option>
            {FINANCIAL_ENTRY_STATUSES.map((valor) => (
              <option key={valor} value={valor}>
                {FINANCIAL_ENTRY_STATUS_LABELS[valor]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="De"
            type="date"
            value={de}
            onChange={(e) => trocarFiltro(() => setDe(e.target.value))}
          />
          <TextField
            label="Ate"
            type="date"
            value={ate}
            onChange={(e) => trocarFiltro(() => setAte(e.target.value))}
          />
        </div>
        {podeEscrever ? <Button onClick={() => setCriando(true)}>Novo lancamento</Button> : null}
      </div>

      {cancelar.isError ? <CaixaErro mensagem={mensagemDeErro(cancelar.error)} /> : null}

      {isPending ? (
        <Carregando />
      ) : isError ? (
        <CaixaErro mensagem="Nao foi possivel carregar os lancamentos." />
      ) : data.items.length === 0 ? (
        <EstadoVazio mensagem="Nenhum lancamento encontrado com esses filtros." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                <th className="py-2">Vencimento</th>
                <th className="py-2">Cliente</th>
                <th className="py-2">Lancamento</th>
                <th className="py-2">Metodo</th>
                <th className="py-2 text-right">Valor</th>
                <th className="py-2">Situacao</th>
                <th className="py-2 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((lancamento) => (
                <tr key={lancamento.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 whitespace-nowrap text-slate-600">
                    {lancamento.dueDate === null ? '—' : formatarData(lancamento.dueDate)}
                    {lancamento.paidAt !== null ? (
                      <span className="block text-xs text-slate-400">
                        pago em {rotuloDataISO(lancamento.paidAt)}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 text-slate-800">{lancamento.clientName ?? '—'}</td>
                  <td className="py-2">
                    <span className="block font-medium text-slate-800">
                      {KIND_LABELS[lancamento.kind]}
                      {lancamento.description !== null ? ` · ${lancamento.description}` : ''}
                    </span>
                    {lancamento.notes !== null ? (
                      <span className="block text-xs text-slate-400">{lancamento.notes}</span>
                    ) : null}
                  </td>
                  <td className="py-2 text-slate-600">
                    {lancamento.method === null ? '—' : PAYMENT_METHOD_LABELS[lancamento.method]}
                  </td>
                  <td className="py-2 text-right font-medium whitespace-nowrap text-slate-800">
                    {formatBRL(lancamento.amountCents)}
                  </td>
                  <td className="py-2">
                    <Badge tone={TOM_ENTRADA[lancamento.status]}>
                      {FINANCIAL_ENTRY_STATUS_LABELS[lancamento.status]}
                    </Badge>
                  </td>
                  <td className="py-2 text-right">
                    {podeEscrever && lancamento.status === 'PENDENTE' ? (
                      <Button
                        variante="secundaria"
                        tamanho="sm"
                        onClick={() => setLiquidando(lancamento)}
                      >
                        Receber
                      </Button>
                    ) : podeEscrever &&
                      (lancamento.status === 'PENDENTE' || lancamento.status === 'INADIMPENTE') ? (
                      <Button
                        variante="perigo"
                        tamanho="sm"
                        disabled={cancelar.isPending}
                        onClick={() => {
                          if (window.confirm('Cancelar este lancamento?'))
                            cancelar.mutate(lancamento.id);
                        }}
                      >
                        Cancelar
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPaginas > 1 ? (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <Button
            variante="fantasma"
            tamanho="sm"
            disabled={pagina === 0}
            onClick={() => setPagina((atual) => Math.max(0, atual - 1))}
          >
            Anterior
          </Button>
          <span>
            Pagina {pagina + 1} de {totalPaginas} · {data?.meta.total ?? 0} lancamento(s)
          </span>
          <Button
            variante="fantasma"
            tamanho="sm"
            disabled={pagina + 1 >= totalPaginas}
            onClick={() => setPagina((atual) => atual + 1)}
          >
            Proxima
          </Button>
        </div>
      ) : null}

      <Modal aberto={criando} titulo="Novo lancamento" onFechar={() => setCriando(false)}>
        <FormularioNovoLancamento
          onConcluir={() => {
            setCriando(false);
            invalidar();
          }}
        />
      </Modal>

      <Modal
        aberto={liquidando !== null}
        titulo="Receber lancamento"
        onFechar={() => setLiquidando(null)}
      >
        {liquidando !== null ? (
          <FormularioReceber
            lancamento={liquidando}
            onConcluir={() => {
              setLiquidando(null);
              invalidar();
            }}
          />
        ) : null}
      </Modal>
    </Panel>
  );
}

function FormularioNovoLancamento({ onConcluir }: { onConcluir: () => void }) {
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: () => listarClientes({}) });

  const [kind, setKind] = useState<FinancialEntryKind>('RECEITA');
  const [clientId, setClientId] = useState('');
  const [description, setDescription] = useState('');
  const [valor, setValor] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [notes, setNotes] = useState('');

  const salvar = useMutation({
    mutationFn: () =>
      criarLancamento({
        kind,
        clientId: clientId === '' ? undefined : clientId,
        description: description.trim() === '' ? undefined : description.trim(),
        amountCents: paraCentavos(valor),
        method: method === '' ? undefined : method,
        dueDate: dueDate === '' ? undefined : dueDate,
        paidAt:
          method === '' ? undefined : paidAt === '' ? undefined : new Date(paidAt).toISOString(),
        notes: notes.trim() === '' ? undefined : notes.trim(),
        idempotencyKey: crypto.randomUUID(),
      } satisfies FinancialEntryCreate),
    onSuccess: onConcluir,
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    if (paraCentavos(valor) === 0) return;
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Tipo"
          required
          value={kind}
          onChange={(e) => setKind(e.target.value as FinancialEntryKind)}
        >
          {FINANCIAL_ENTRY_KINDS.map((valor) => (
            <option key={valor} value={valor}>
              {KIND_LABELS[valor]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Valor (R$)"
          required
          placeholder="0,00"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </div>

      <SelectField label="Cliente" value={clientId} onChange={(e) => setClientId(e.target.value)}>
        <option value="">Sem cliente</option>
        {(clientes.data?.items ?? []).map((cliente) => (
          <option key={cliente.id} value={cliente.id}>
            {cliente.name}
          </option>
        ))}
      </SelectField>

      <TextField
        label="Descricao"
        maxLength={300}
        placeholder="Ex.: Sessao avulsa, venda de produto..."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Pagamento agora"
          hint="Sem forma de pagamento, o lancamento vai para a receber."
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod | '')}
        >
          <option value="">A receber</option>
          {PAYMENT_METHODS.map((valor) => (
            <option key={valor} value={valor}>
              {PAYMENT_METHOD_LABELS[valor]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Vencimento"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>

      {method !== '' ? (
        <TextField
          label="Pago em"
          type="datetime-local"
          value={paidAt}
          onChange={(e) => setPaidAt(e.target.value)}
        />
      ) : null}

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
        <Button type="submit" disabled={salvar.isPending || paraCentavos(valor) === 0}>
          {salvar.isPending ? 'Salvando...' : 'Lancar'}
        </Button>
      </div>
    </form>
  );
}

function FormularioReceber({
  lancamento,
  onConcluir,
}: {
  lancamento: FinancialEntry;
  onConcluir: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [paidAt, setPaidAt] = useState('');
  const [notes, setNotes] = useState('');

  const salvar = useMutation({
    mutationFn: () =>
      pagarLancamento(lancamento.id, {
        method,
        paidAt: paidAt === '' ? undefined : new Date(paidAt).toISOString(),
        notes: notes.trim() === '' ? undefined : notes.trim(),
      } satisfies FinancialEntryPaymentInput),
    onSuccess: onConcluir,
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <p className="text-sm text-slate-600">
        {KIND_LABELS[lancamento.kind]}
        {lancamento.description !== null ? ` · ${lancamento.description}` : ''} ·{' '}
        {formatBRL(lancamento.amountCents)}
      </p>

      <SelectField
        label="Forma de pagamento"
        required
        value={method}
        onChange={(e) => setMethod(e.target.value as PaymentMethod)}
      >
        {PAYMENT_METHODS.map((valor) => (
          <option key={valor} value={valor}>
            {PAYMENT_METHOD_LABELS[valor]}
          </option>
        ))}
      </SelectField>

      <TextField
        label="Pago em"
        type="datetime-local"
        value={paidAt}
        onChange={(e) => setPaidAt(e.target.value)}
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
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando...' : 'Confirmar recebimento'}
        </Button>
      </div>
    </form>
  );
}

// --- Pacotes ----------------------------------------------------------

function AbaPacotes() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<PackageStatus | ''>('');
  const [pagina, setPagina] = useState(0);
  const [criando, setCriando] = useState(false);
  const [aberto, setAberto] = useState<Package | null>(null);
  const POR_PAGINA = 25;

  const filtro = {
    status: status === '' ? undefined : status,
    page: pagina + 1,
    perPage: POR_PAGINA,
  };

  const { data, isPending, isError } = useQuery({
    queryKey: ['financeiro', 'pacotes', filtro],
    queryFn: () => listarPacotes(filtro),
  });

  function invalidar(): void {
    void queryClient.invalidateQueries({ queryKey: ['financeiro'] });
  }

  const mudarStatus = useMutation({
    mutationFn: ({ id, novo }: { id: string; novo: 'CONCLUIDO' | 'CANCELADO' }) =>
      mudarStatusPacote(id, { status: novo }),
    onSuccess: invalidar,
  });

  const totalPaginas = data === undefined ? 0 : data.meta.totalPages;

  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelectField
          label="Situacao"
          value={status}
          onChange={(evento) => {
            setStatus(evento.target.value as PackageStatus | '');
            setPagina(0);
          }}
        >
          <option value="">Todos</option>
          {PACKAGE_STATUSES.map((valor) => (
            <option key={valor} value={valor}>
              {PACKAGE_STATUS_LABELS[valor]}
            </option>
          ))}
        </SelectField>
        {podeEscrever ? <Button onClick={() => setCriando(true)}>Novo pacote</Button> : null}
      </div>

      {mudarStatus.isError ? <CaixaErro mensagem={mensagemDeErro(mudarStatus.error)} /> : null}

      {isPending ? (
        <Carregando />
      ) : isError ? (
        <CaixaErro mensagem="Nao foi possivel carregar os pacotes." />
      ) : data.items.length === 0 ? (
        <EstadoVazio mensagem="Nenhum pacote encontrado." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                <th className="py-2">Cliente</th>
                <th className="py-2">Pacote</th>
                <th className="py-2">Saldo</th>
                <th className="py-2 text-right">Valor</th>
                <th className="py-2">Validade</th>
                <th className="py-2">Situacao</th>
                <th className="py-2 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((pacote) => (
                <tr key={pacote.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 text-slate-800">{pacote.clientName}</td>
                  <td className="py-2 font-medium text-slate-800">{pacote.name}</td>
                  <td className="py-2 text-slate-600">
                    {pacote.sessoesUsadas}/{pacote.totalSessions} usadas ·{' '}
                    <span className="font-medium text-slate-800">
                      {pacote.sessoesRestantes} restantes
                    </span>
                  </td>
                  <td className="py-2 text-right font-medium whitespace-nowrap text-slate-800">
                    {formatBRL(pacote.priceCents)}
                  </td>
                  <td className="py-2 text-slate-600">
                    {formatarData(pacote.validFrom)} a {formatarData(pacote.validUntil)}
                  </td>
                  <td className="py-2">
                    <Badge tone={TOM_PACOTE[pacote.status]}>
                      {PACKAGE_STATUS_LABELS[pacote.status]}
                    </Badge>
                  </td>
                  <td className="py-2 text-right">
                    <Button variante="secundaria" tamanho="sm" onClick={() => setAberto(pacote)}>
                      Sessoes
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPaginas > 1 ? (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <Button
            variante="fantasma"
            tamanho="sm"
            disabled={pagina === 0}
            onClick={() => setPagina((atual) => Math.max(0, atual - 1))}
          >
            Anterior
          </Button>
          <span>
            Pagina {pagina + 1} de {totalPaginas} · {data?.meta.total ?? 0} pacote(s)
          </span>
          <Button
            variante="fantasma"
            tamanho="sm"
            disabled={pagina + 1 >= totalPaginas}
            onClick={() => setPagina((atual) => atual + 1)}
          >
            Proxima
          </Button>
        </div>
      ) : null}

      <Modal aberto={criando} titulo="Novo pacote de sessoes" onFechar={() => setCriando(false)}>
        <FormularioNovoPacote
          onConcluir={() => {
            setCriando(false);
            invalidar();
          }}
        />
      </Modal>

      <Modal aberto={aberto !== null} titulo="Sessoes do pacote" onFechar={() => setAberto(null)}>
        {aberto !== null ? (
          <DetalhePacote
            pacote={aberto}
            onConcluir={() => {
              setAberto(null);
              invalidar();
            }}
          />
        ) : null}
      </Modal>
    </Panel>
  );
}

function FormularioNovoPacote({ onConcluir }: { onConcluir: () => void }) {
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: () => listarClientes({}) });

  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('');
  const [sessoes, setSessoes] = useState('1');
  const [valor, setValor] = useState('');
  const [validFrom, setValidFrom] = useState(dataDeHojeISO());
  const [validUntil, setValidUntil] = useState('');
  const [notas, setNotas] = useState('');
  const [receberAgora, setReceberAgora] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [paidAt, setPaidAt] = useState('');

  const salvar = useMutation({
    mutationFn: () =>
      criarPacote({
        clientId,
        name: name.trim(),
        totalSessions: Number(sessoes),
        priceCents: paraCentavos(valor),
        validFrom,
        validUntil,
        notes: notas.trim() === '' ? undefined : notas.trim(),
        payment: receberAgora
          ? { method, paidAt: paidAt === '' ? undefined : new Date(paidAt).toISOString() }
          : undefined,
      }),
    onSuccess: onConcluir,
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    if (clientId === '' || paraCentavos(valor) === 0 || validUntil === '') return;
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

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Nome do pacote"
          required
          placeholder="Ex.: Relaxante 5x"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="Sessoes"
          required
          type="number"
          min={1}
          max={999}
          value={sessoes}
          onChange={(e) => setSessoes(e.target.value)}
        />
        <TextField
          label="Valor (R$)"
          required
          placeholder="0,00"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Vigencia de"
          required
          type="date"
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
        />
        <TextField
          label="Vigencia ate"
          required
          type="date"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
        />
      </div>

      <CheckboxField
        label="Receber o valor agora"
        checked={receberAgora}
        onChange={(e) => setReceberAgora(e.target.checked)}
      />

      {receberAgora ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Forma de pagamento"
            required
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {PAYMENT_METHODS.map((valor) => (
              <option key={valor} value={valor}>
                {PAYMENT_METHOD_LABELS[valor]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Pago em"
            type="datetime-local"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          Sem pagamento na venda, a receita fica a receber nos lancamentos.
        </p>
      )}

      <TextareaField
        label="Observacoes"
        maxLength={600}
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
      />

      {salvar.isError ? <CaixaErro mensagem={mensagemDeErro(salvar.error)} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={
            salvar.isPending || clientId === '' || paraCentavos(valor) === 0 || validUntil === ''
          }
        >
          {salvar.isPending ? 'Salvando...' : 'Criar pacote'}
        </Button>
      </div>
    </form>
  );
}

function DetalhePacote({ pacote, onConcluir }: { pacote: Package; onConcluir: () => void }) {
  const queryClient = useQueryClient();
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';

  const { data, isPending, isError } = useQuery({
    queryKey: ['financeiro', 'pacote', pacote.id],
    queryFn: () => obterPacote(pacote.id),
  });

  function invalidar(): void {
    void queryClient.invalidateQueries({ queryKey: ['financeiro'] });
  }

  const usar = useMutation({
    mutationFn: (id: string) => usarSessao(pacote.id, id),
    onSuccess: invalidar,
  });
  const devolver = useMutation({
    mutationFn: (id: string) => disponibilizarSessao(pacote.id, id),
    onSuccess: invalidar,
  });
  const mudarStatus = useMutation({
    mutationFn: (novo: 'CONCLUIDO' | 'CANCELADO') => mudarStatusPacote(pacote.id, { status: novo }),
    onSuccess: invalidar,
  });

  const detalhe: PackageDetail | undefined = data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">{detalhe?.name ?? pacote.name}</span> ·{' '}
          {detalhe?.clientName ?? pacote.clientName}
        </p>
        <Badge tone={TOM_PACOTE[pacote.status]}>{PACKAGE_STATUS_LABELS[pacote.status]}</Badge>
      </div>

      {isPending ? (
        <Carregando />
      ) : isError ? (
        <CaixaErro mensagem="Nao foi possivel carregar as sessoes." />
      ) : detalhe === undefined ? (
        <CaixaErro mensagem="Pacote nao encontrado." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                <th className="py-2">Sessao</th>
                <th className="py-2">Situacao</th>
                <th className="py-2">Vence</th>
                <th className="py-2 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {detalhe.sessions.map((sessao) => (
                <tr key={sessao.id} className="border-t border-slate-100">
                  <td className="py-2 text-slate-600">#{sessao.id.slice(0, 8)}</td>
                  <td className="py-2">
                    <Badge tone="neutral">{PACKAGE_SESSION_STATUS_LABELS[sessao.status]}</Badge>
                    {sessao.appointmentId !== null ? (
                      <span className="ml-1 text-xs text-slate-400">com agendamento</span>
                    ) : null}
                  </td>
                  <td className="py-2 text-slate-600">
                    {sessao.expiresAt === null ? '—' : formatarData(sessao.expiresAt)}
                  </td>
                  <td className="py-2 text-right">
                    {podeEscrever && sessao.status === 'DISPONIVEL' ? (
                      <Button
                        variante="secundaria"
                        tamanho="sm"
                        disabled={usar.isPending}
                        onClick={() => usar.mutate(sessao.id)}
                      >
                        Usar sessao
                      </Button>
                    ) : podeEscrever &&
                      sessao.status === 'UTILIZADA' &&
                      sessao.appointmentId === null ? (
                      <Button
                        variante="secundaria"
                        tamanho="sm"
                        disabled={devolver.isPending}
                        onClick={() => devolver.mutate(sessao.id)}
                      >
                        Devolver ao saldo
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {usar.isError ? <CaixaErro mensagem={mensagemDeErro(usar.error)} /> : null}
      {devolver.isError ? <CaixaErro mensagem={mensagemDeErro(devolver.error)} /> : null}
      {mudarStatus.isError ? <CaixaErro mensagem={mensagemDeErro(mudarStatus.error)} /> : null}

      {podeEscrever && pacote.status === 'ATIVO' ? (
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button
            variante="secundaria"
            disabled={mudarStatus.isPending || pacote.sessoesRestantes > 0}
            title={pacote.sessoesRestantes > 0 ? 'Conclua as sessoes antes' : undefined}
            onClick={() => {
              if (window.confirm('Concluir este pacote?')) mudarStatus.mutate('CONCLUIDO');
            }}
          >
            Concluir
          </Button>
          <Button
            variante="perigo"
            disabled={mudarStatus.isPending}
            onClick={() => {
              if (window.confirm('Cancelar este pacote?')) mudarStatus.mutate('CANCELADO');
            }}
          >
            Cancelar
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button variante="fantasma" onClick={onConcluir}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

// --- Comissoes --------------------------------------------------------

function AbaComissoes() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<CommissionStatus | ''>('');
  const [profissionalId, setProfissionalId] = useState('');
  const [pagina, setPagina] = useState(0);
  const POR_PAGINA = 25;

  const profissionais = useQuery({
    queryKey: ['profissionais'],
    queryFn: () => listarProfissionais({}),
  });

  const filtro = {
    status: status === '' ? undefined : status,
    professionalId: profissionalId === '' ? undefined : profissionalId,
    page: pagina + 1,
    perPage: POR_PAGINA,
  };

  const { data, isPending, isError } = useQuery({
    queryKey: ['financeiro', 'comissoes', filtro],
    queryFn: () => listarComissoes(filtro),
  });

  function invalidar(): void {
    void queryClient.invalidateQueries({ queryKey: ['financeiro'] });
  }

  function aplicarFiltro(apply: () => void): void {
    apply();
    setPagina(0);
  }

  const aprovar = useMutation({
    mutationFn: (id: string) => aprovarComissao(id),
    onSuccess: invalidar,
  });
  const pagar = useMutation({
    mutationFn: (id: string) => pagarComissao(id),
    onSuccess: invalidar,
  });
  const cancelar = useMutation({
    mutationFn: (id: string) => cancelarComissao(id),
    onSuccess: invalidar,
  });

  const totalPaginas = data === undefined ? 0 : data.meta.totalPages;

  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <SelectField
          label="Situacao"
          value={status}
          onChange={(evento) =>
            aplicarFiltro(() => setStatus(evento.target.value as CommissionStatus | ''))
          }
        >
          <option value="">Todas</option>
          {COMMISSION_STATUSES.map((valor) => (
            <option key={valor} value={valor}>
              {COMMISSION_STATUS_LABELS[valor]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Profissional"
          value={profissionalId}
          onChange={(evento) => aplicarFiltro(() => setProfissionalId(evento.target.value))}
        >
          <option value="">Todos</option>
          {(profissionais.data?.items ?? []).map((profissional) => (
            <option key={profissional.id} value={profissional.id}>
              {profissional.name}
            </option>
          ))}
        </SelectField>
      </div>

      {aprovar.isError || pagar.isError || cancelar.isError ? (
        <CaixaErro mensagem="Nao foi possivel concluir a acao. Tente novamente." />
      ) : null}

      {isPending ? (
        <Carregando />
      ) : isError ? (
        <CaixaErro mensagem="Nao foi possivel carregar as comissoes." />
      ) : data.items.length === 0 ? (
        <EstadoVazio mensagem="Nenhuma comissao encontrada." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                <th className="py-2">Profissional</th>
                <th className="py-2">Periodo</th>
                <th className="py-2">Base</th>
                <th className="py-2">Comissao</th>
                <th className="py-2">Situacao</th>
                <th className="py-2 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((comissao) => (
                <tr key={comissao.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 font-medium text-slate-800">{comissao.professionalName}</td>
                  <td className="py-2 text-slate-600">
                    {formatarData(comissao.periodStart)} a {formatarData(comissao.periodEnd)}
                  </td>
                  <td className="py-2 whitespace-nowrap text-slate-600">
                    {formatBRL(comissao.baseAmountCents)}
                  </td>
                  <td className="py-2 font-medium whitespace-nowrap text-slate-800">
                    {formatBRL(comissao.amountCents)}
                    <span className="block text-xs font-normal text-slate-400">
                      {comissao.percentBasisPoints / 100}%
                    </span>
                  </td>
                  <td className="py-2">
                    <Badge tone={TOM_COMISSAO[comissao.status]}>
                      {COMMISSION_STATUS_LABELS[comissao.status]}
                    </Badge>
                    {comissao.paidAt !== null ? (
                      <span className="block text-xs text-slate-400">
                        paga em {rotuloDataISO(comissao.paidAt)}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 text-right">
                    {podeEscrever && comissao.status === 'PREVISTA' ? (
                      <Button
                        variante="secundaria"
                        tamanho="sm"
                        disabled={aprovar.isPending}
                        onClick={() => aprovar.mutate(comissao.id)}
                      >
                        Aprovar
                      </Button>
                    ) : podeEscrever && comissao.status === 'APROVADA' ? (
                      <span className="inline-flex gap-1">
                        <Button
                          variante="secundaria"
                          tamanho="sm"
                          disabled={pagar.isPending}
                          onClick={() => pagar.mutate(comissao.id)}
                        >
                          Pagar
                        </Button>
                        <Button
                          variante="perigo"
                          tamanho="sm"
                          disabled={cancelar.isPending}
                          onClick={() => {
                            if (window.confirm('Cancelar esta comissao?'))
                              cancelar.mutate(comissao.id);
                          }}
                        >
                          Cancelar
                        </Button>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPaginas > 1 ? (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <Button
            variante="fantasma"
            tamanho="sm"
            disabled={pagina === 0}
            onClick={() => setPagina((atual) => Math.max(0, atual - 1))}
          >
            Anterior
          </Button>
          <span>
            Pagina {pagina + 1} de {totalPaginas} · {data?.meta.total ?? 0} comissao(oes)
          </span>
          <Button
            variante="fantasma"
            tamanho="sm"
            disabled={pagina + 1 >= totalPaginas}
            onClick={() => setPagina((atual) => atual + 1)}
          >
            Proxima
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

// --- Resumo -----------------------------------------------------------

function AbaResumo() {
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');

  const query = {
    de: de === '' ? undefined : de,
    ate: ate === '' ? undefined : ate,
  };

  const { data, isPending, isError } = useQuery({
    queryKey: chavesFinanceiro.resumo(query.de ?? '', query.ate ?? ''),
    queryFn: () => obterResumo(query),
  });

  return (
    <Panel className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-md">
        <TextField label="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        <TextField label="Ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
      </div>
      <p className="text-xs text-slate-400">
        Sem datas, o periodo e o mes corrente. "A receber" usa o vencimento; o pago usa a data de
        pagamento.
      </p>

      {isPending ? (
        <Carregando />
      ) : isError ? (
        <CaixaErro mensagem="Nao foi possivel carregar o resumo." />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CartãoResumo rotulo="Recebido" valor={data.recebido} tom="success" />
            <CartãoResumo rotulo="Despesas" valor={data.despesas} tom="neutral" />
            <CartãoResumo rotulo="Saldo do periodo" valor={data.saldoPeriodo} tom="neutral" />
            <CartãoResumo rotulo="A receber (vencido)" valor={data.aReceberVencido} tom="danger" />
            <CartãoResumo rotulo="A receber total" valor={data.aReceber} tom="warning" />
            <CartãoResumo rotulo="Comissoes a pagar" valor={data.comissoes.aPagar} tom="warning" />
            <CartãoResumo rotulo="Comissoes pagas" valor={data.comissoes.pagas} tom="success" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {data.recebidoPorMetodo.length > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">
                  Recebido por forma de pagamento
                </h3>
                <table className="w-full text-sm">
                  <tbody>
                    {data.recebidoPorMetodo.map((linha) => (
                      <tr key={linha.method} className="border-t border-slate-100">
                        <td className="py-2 text-slate-600">
                          {PAYMENT_METHOD_LABELS[linha.method]}
                        </td>
                        <td className="py-2 text-right text-slate-400">
                          {linha.quantidade} lancamento(s)
                        </td>
                        <td className="py-2 text-right font-medium whitespace-nowrap text-slate-800">
                          {formatBRL(linha.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {data.aReceberPorCliente.length > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">A receber por cliente</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {data.aReceberPorCliente.map((linha) => (
                      <tr key={linha.clientName} className="border-t border-slate-100">
                        <td className="py-2 text-slate-600">{linha.clientName}</td>
                        <td className="py-2 text-right font-medium whitespace-nowrap text-slate-800">
                          {formatBRL(linha.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}

function CartãoResumo({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string;
  valor: number;
  tom: 'neutral' | 'success' | 'danger' | 'warning';
}) {
  const cor =
    tom === 'success'
      ? 'text-emerald-700'
      : tom === 'danger'
        ? 'text-rose-700'
        : tom === 'warning'
          ? 'text-amber-700'
          : 'text-slate-900';

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs tracking-wide text-slate-500 uppercase">{rotulo}</p>
      <p className={`mt-1 text-lg font-bold whitespace-nowrap ${cor}`}>{formatBRL(valor)}</p>
    </div>
  );
}
