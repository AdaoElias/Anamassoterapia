import {
  ALERT_DECISION_LABELS,
  ALERT_SEVERITY_LABELS,
  type AlertSeverity,
  type Anamnesis,
  ANAMNESIS_STATUS_LABELS,
  type AnamnesisAnswers,
  type AnamnesisInviteListItem,
  APPOINTMENT_STATUS_LABELS,
  type Contraindication,
  type ContraindicationAlert,
  validarRespostasAnamnesis,
} from '@massoterapia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useParams } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField, TextareaField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { CaixaErro, Carregando, EstadoVazio, PageHeader, Panel } from '@/components/ui/panel';
import { mensagemDeErro } from '@/lib/cadastros';
import { env } from '@/lib/env';
import { formatarData, formatarTelefone } from '@/lib/format';
import {
  chavesProntuario,
  criarConvite,
  decidirAlerta,
  listarContraindicacoes,
  listarConvites,
  listarTemplates,
  obterAnamnese,
  obterProntuario,
  registrarAnamnese,
  registrarCondicao,
  resolverCondicao,
  revisarAnamnese,
} from '@/lib/prontuario';

/**
 * Prontuario do cliente: a tela que o profissional abre antes da sessao.
 *
 * A ordem das secoes segue as tres perguntas que ele precisa responder: o que
 * o cliente tem de restricao (alertas e condicoes), o que ele ja respondeu
 * (anamnese) e o que aconteceu antes (sessoes). Alerta vem primeiro de
 * proposito -- e a unica secao que pode mudar a decisao de atender.
 *
 * As respostas vem decifradas pela API: o painel nunca guarda chave de
 * cifragem, e o navegador so ve texto quando alguem autenticado da clinica
 * abre o prontuario.
 */

const TOM_SEVERIDADE: Record<AlertSeverity, 'neutral' | 'warning' | 'danger'> = {
  BAIXA: 'neutral',
  MEDIA: 'warning',
  ALTA: 'danger',
};

const TOM_SITUACAO_ANAMNESE: Record<
  Anamnesis['status'],
  'neutral' | 'warning' | 'success' | 'danger'
> = {
  RASCUNHO: 'neutral',
  ENVIADA: 'warning',
  APROVADA: 'success',
  REJEITADA: 'danger',
  EXPIRADA: 'neutral',
};

/** ISO -> "03/02/2026 14:05", no fuso do navegador. */
function rotuloInstante(valor: string | null): string {
  if (valor === null) return '—';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function idadeDe(nascimento: string | null): string | null {
  if (nascimento === null) return null;
  const data = new Date(nascimento);
  if (Number.isNaN(data.getTime())) return null;
  const anos = Math.floor((Date.now() - data.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return `${anos} ano(s)`;
}

/**
 * Sessao concluida ou em atendimento e verde; cancelada e no-show ficam
 * neutras porque o horario existiu mas o atendimento nao. Status desconhecido
 * cai no proprio texto em vez de virar `undefined` na tela.
 */
const TOM_SESSAO: Record<string, 'neutral' | 'success'> = {
  CONFIRMADO: 'success',
  EM_ATENDIMENTO: 'success',
  CONCLUIDO: 'success',
};

function rotuloSessao(status: string): string {
  return status in APPOINTMENT_STATUS_LABELS
    ? APPOINTMENT_STATUS_LABELS[status as keyof typeof APPOINTMENT_STATUS_LABELS]
    : status;
}

/** `false` quando o alerta ainda nao foi decidido: ele so tem um caminho valido. */
function podeDecidirAlerta(alerta: ContraindicationAlert): boolean {
  return alerta.decision === 'PENDENTE';
}

export function ProntuarioPage() {
  const { clientId } = useParams<{ clientId: string }>();

  if (!clientId) {
    return (
      <div className="space-y-6">
        <PageHeader titulo="Prontuario" descricao="Cliente nao informado." />
        <Panel>
          <EstadoVazio mensagem="Link de prontuario invalido." />
        </Panel>
      </div>
    );
  }

  return <Prontuario clientId={clientId} />;
}

function Prontuario({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();

  const [anamneseAberta, setAnamneseAberta] = useState<string | null>(null);
  const [decidindoAlerta, setDecidindoAlerta] = useState<ContraindicationAlert | null>(null);
  const [registrandoCondicao, setRegistrandoCondicao] = useState(false);
  const [registrandoAnamnese, setRegistrandoAnamnese] = useState(false);
  const [gerandoConvite, setGerandoConvite] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: chavesProntuario.cliente(clientId),
    queryFn: () => obterProntuario(clientId),
  });

  const resolver = useMutation({
    mutationFn: (entrada: { conditionId: string; notes?: string }) =>
      resolverCondicao(
        entrada.conditionId,
        entrada.notes === undefined ? {} : { notes: entrada.notes },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.cliente(clientId) });
    },
  });

  if (isPending) return <Carregando />;
  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader titulo="Prontuario" />
        <Panel>
          <CaixaErro mensagem="Nao foi possivel carregar o prontuario." />
        </Panel>
      </div>
    );
  }
  if (data === undefined) return null;

  const { client, situacao, anamneses, sessoes, condicoes, alertas } = data;
  const pendentes = alertas.filter((alerta) => alerta.decision === 'PENDENTE');

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={client.name}
        descricao={[
          client.phone !== null ? formatarTelefone(client.phone) : null,
          client.email,
          idadeDe(client.birthDate),
        ]
          .filter((parte) => parte !== null)
          .join(' · ')}
      />

      <div className="flex flex-wrap gap-2">
        {situacao.anamneseVigente !== null ? (
          <Badge tone="success">Anamnese aprovada v{situacao.anamneseVigente.version}</Badge>
        ) : (
          <Badge tone="warning">Sem anamnese aprovada</Badge>
        )}
        {situacao.anamnesePendente > 0 ? (
          <Badge tone="warning">{situacao.anamnesePendente} aguardando revisao</Badge>
        ) : null}
        <Badge tone={situacao.condicoesAtivas > 0 ? 'warning' : 'neutral'}>
          {situacao.condicoesAtivas} condicao(oes) ativa(s)
        </Badge>
        {situacao.alertasPendentes > 0 ? (
          <Badge tone="danger">{situacao.alertasPendentes} alerta(s) a decidir</Badge>
        ) : null}
        <Badge tone="neutral">{situacao.sessoesRealizadas} sessao(oes) realizada(s)</Badge>
      </div>

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Alertas de contraindicacao</h2>
          {pendentes.length > 0 ? (
            <p className="text-xs text-slate-500">
              O sistema avisa, quem decide e voce: registre a decisao para a trilha ficar completa.
            </p>
          ) : null}
        </div>

        {alertas.length === 0 ? (
          <EstadoVazio mensagem="Nenhum alerta para este cliente." />
        ) : (
          <ul className="space-y-2">
            {alertas.map((alerta) => (
              <li
                key={alerta.id}
                className="rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-slate-800">{alerta.message}</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {alerta.therapyName} · {rotuloInstante(alerta.startAt)} ·{' '}
                      {alerta.professionalName}
                    </span>
                    {alerta.decisionNotes !== null ? (
                      <span className="mt-1 block text-xs text-slate-500">
                        Justificativa: {alerta.decisionNotes}
                      </span>
                    ) : null}
                    {alerta.acknowledgedAt !== null ? (
                      <span className="mt-1 block text-xs text-slate-400">
                        Decidido em {rotuloInstante(alerta.acknowledgedAt)}
                        {alerta.acknowledgedByName !== null
                          ? ` por ${alerta.acknowledgedByName}`
                          : ''}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={TOM_SEVERIDADE[alerta.severity] ?? 'neutral'}>
                      {ALERT_SEVERITY_LABELS[alerta.severity]}
                    </Badge>
                    <Badge tone={alerta.decision === 'PENDENTE' ? 'warning' : 'neutral'}>
                      {ALERT_DECISION_LABELS[alerta.decision]}
                    </Badge>
                    {podeDecidirAlerta(alerta) ? (
                      <Button tamanho="sm" onClick={() => setDecidindoAlerta(alerta)}>
                        Decidir
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Anamneses</h2>
          <div className="flex flex-wrap gap-2">
            <Button tamanho="sm" variante="secundaria" onClick={() => setGerandoConvite(true)}>
              Enviar link
            </Button>
            <Button tamanho="sm" onClick={() => setRegistrandoAnamnese(true)}>
              Registrar anamnese
            </Button>
          </div>
        </div>

        {anamneses.length === 0 ? (
          <EstadoVazio mensagem="Nenhuma anamnese registrada para este cliente." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="py-2">Versao</th>
                  <th className="py-2">Formulario</th>
                  <th className="py-2">Situacao</th>
                  <th className="py-2">Enviada</th>
                  <th className="py-2">Revisao</th>
                  <th className="py-2 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {anamneses.map((anamnese) => (
                  <tr key={anamnese.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 font-medium text-slate-800">v{anamnese.version}</td>
                    <td className="py-2 text-slate-700">
                      {anamnese.templateName ?? '—'}
                      <span className="mt-1 block text-xs text-slate-400">
                        {anamnese.templateVersion === null ? '' : `v${anamnese.templateVersion}`}
                        {anamnese.hasAnswers ? '' : ' · sem respostas'}
                      </span>
                    </td>
                    <td className="py-2">
                      <Badge tone={TOM_SITUACAO_ANAMNESE[anamnese.status]}>
                        {ANAMNESIS_STATUS_LABELS[anamnese.status]}
                      </Badge>
                    </td>
                    <td className="py-2 text-slate-600">{rotuloInstante(anamnese.submittedAt)}</td>
                    <td className="py-2 text-slate-600">
                      {rotuloInstante(anamnese.reviewedAt)}
                      {anamnese.reviewedByName !== null ? (
                        <span className="mt-1 block text-xs text-slate-400">
                          {anamnese.reviewedByName}
                        </span>
                      ) : null}
                      {anamnese.reviewNotes !== null ? (
                        <span className="mt-1 block text-xs text-slate-500">
                          {anamnese.reviewNotes}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variante="fantasma"
                        tamanho="sm"
                        onClick={() => setAnamneseAberta(anamnese.id)}
                      >
                        Ver respostas
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Condicoes de saude</h2>
          <Button tamanho="sm" onClick={() => setRegistrandoCondicao(true)}>
            Registrar condicao
          </Button>
        </div>

        {condicoes.length === 0 ? (
          <EstadoVazio mensagem="Nenhuma condicao registrada." />
        ) : (
          <ul className="space-y-2">
            {condicoes.map((condicao) => {
              const ativa = condicao.resolvedAt === null;
              return (
                <li
                  key={condicao.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-slate-800">{condicao.title}</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {condicao.code}
                      {condicao.requiresMedicalClearance ? ' · exige atestado' : ''}
                      {condicao.diagnosedAt !== null
                        ? ` · desde ${formatarData(condicao.diagnosedAt)}`
                        : ''}
                    </span>
                    {condicao.notes !== null ? (
                      <span className="mt-1 block text-xs text-slate-500">{condicao.notes}</span>
                    ) : null}
                    {condicao.resolvedAt !== null ? (
                      <span className="mt-1 block text-xs text-slate-400">
                        Resolvida em {rotuloInstante(condicao.resolvedAt)}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={TOM_SEVERIDADE[condicao.severity] ?? 'neutral'}>
                      {ALERT_SEVERITY_LABELS[condicao.severity]}
                    </Badge>
                    <Badge tone={ativa ? 'warning' : 'neutral'}>
                      {ativa ? 'Ativa' : 'Resolvida'}
                    </Badge>
                    {ativa ? (
                      <Button
                        variante="fantasma"
                        tamanho="sm"
                        disabled={resolver.isPending}
                        onClick={() => resolver.mutate({ conditionId: condicao.id })}
                      >
                        Resolver
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-800">Sessoes</h2>

        {sessoes.length === 0 ? (
          <EstadoVazio mensagem="Nenhuma sessao registrada para este cliente." />
        ) : (
          <ul className="space-y-2">
            {sessoes.map((sessao) => (
              <li
                key={sessao.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-800">
                    {rotuloInstante(sessao.startAt)}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {sessao.therapyName} · {sessao.professionalName}
                  </span>
                  {sessao.sessionNotes !== null ? (
                    <span className="mt-1 block text-xs text-slate-600">{sessao.sessionNotes}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={sessao.anamnesisVersion === null ? 'warning' : 'success'}>
                    {sessao.anamnesisVersion === null
                      ? 'Sem anamnese congelada'
                      : `Anamnese v${sessao.anamnesisVersion}`}
                  </Badge>
                  <Badge tone={TOM_SESSAO[sessao.status] ?? 'neutral'}>
                    {rotuloSessao(sessao.status)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Modal
        aberto={anamneseAberta !== null}
        titulo="Respostas da anamnese"
        onFechar={() => setAnamneseAberta(null)}
      >
        {anamneseAberta !== null ? (
          <AnamneseDetalhe
            anamneseId={anamneseAberta}
            clientId={clientId}
            onFechar={() => setAnamneseAberta(null)}
          />
        ) : null}
      </Modal>

      <Modal
        aberto={decidindoAlerta !== null}
        titulo="Decidir alerta"
        onFechar={() => setDecidindoAlerta(null)}
      >
        {decidindoAlerta !== null ? (
          <FormularioDecisao alerta={decidindoAlerta} onConcluir={() => setDecidindoAlerta(null)} />
        ) : null}
      </Modal>

      <Modal
        aberto={registrandoCondicao}
        titulo="Registrar condicao de saude"
        onFechar={() => setRegistrandoCondicao(false)}
      >
        <FormularioCondicao clientId={clientId} onConcluir={() => setRegistrandoCondicao(false)} />
      </Modal>

      <Modal
        aberto={registrandoAnamnese}
        titulo="Registrar anamnese"
        onFechar={() => setRegistrandoAnamnese(false)}
      >
        <FormularioAnamnese clientId={clientId} onConcluir={() => setRegistrandoAnamnese(false)} />
      </Modal>

      <Modal
        aberto={gerandoConvite}
        titulo="Enviar link de anamnese"
        onFechar={() => setGerandoConvite(false)}
      >
        <FormularioConvite clientId={clientId} onConcluir={() => setGerandoConvite(false)} />
      </Modal>
    </div>
  );
}

/**
 * Respostas decifradas, na ordem do formulario original.
 *
 * A API devolve o `schema` junto das `answers` justamente para isso: sem o
 * formulario, a tela mostraria as chaves (`dor_principal`) e nao as perguntas
 * que o clienterespondiu. Para rascunho sem resposta, o schema vem nulo e a
 * tela diz isso em vez de mostrar lista vazia.
 */
function AnamneseDetalhe({
  anamneseId,
  clientId,
  onFechar,
}: {
  anamneseId: string;
  clientId: string;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();

  const { data, isPending, isError } = useQuery({
    queryKey: chavesProntuario.anamnese(anamneseId),
    queryFn: () => obterAnamnese(anamneseId),
  });

  const revisar = useMutation({
    mutationFn: (decisao: 'APROVADA' | 'REJEITADA') =>
      revisarAnamnese(anamneseId, { decision: decisao }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.anamnese(anamneseId) });
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.cliente(clientId) });
    },
  });

  if (isPending) return <Carregando />;
  if (isError) return <CaixaErro mensagem="Nao foi possivel carregar as respostas." />;
  if (data === undefined) return null;

  const revisavel = data.status === 'ENVIADA';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TOM_SITUACAO_ANAMNESE[data.status]}>
          {ANAMNESIS_STATUS_LABELS[data.status]}
        </Badge>
        <span className="text-xs text-slate-500">
          {data.templateName ?? 'Sem formulario'}{' '}
          {data.templateVersion === null ? '' : `v${data.templateVersion}`} · versao {data.version}
        </span>
      </div>

      {data.schema === null ? (
        <EstadoVazio mensagem="Esta versao nao tem formulario associado." />
      ) : data.schema.order.length === 0 ? (
        <EstadoVazio mensagem="Esta versao foi criada sem respostas." />
      ) : (
        <dl className="space-y-3">
          {data.schema.order.map((chave) => {
            const definicao = data.schema?.properties[chave];
            const resposta = data.answers[chave];
            return (
              <div key={chave} className="space-y-1">
                <dt className="text-sm font-medium text-slate-700">{definicao?.title ?? chave}</dt>
                <dd className="text-sm text-slate-800">{rotuloResposta(resposta)}</dd>
              </div>
            );
          })}
        </dl>
      )}

      {data.reviewNotes !== null ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Observacao da revisao: {data.reviewNotes}
        </p>
      ) : null}

      {revisar.isError ? <CaixaErro mensagem={mensagemDeErro(revisar.error)} /> : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variante="secundaria" onClick={onFechar}>
          Fechar
        </Button>
        {revisavel ? (
          <>
            <Button
              variante="perigo"
              disabled={revisar.isPending}
              onClick={() => revisar.mutate('REJEITADA')}
            >
              Rejeitar
            </Button>
            <Button disabled={revisar.isPending} onClick={() => revisar.mutate('APROVADA')}>
              Aprovar
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Lista de opcoes, texto longo ou valor simples -- sem distinguir `false` de "nao respondeu". */
function rotuloResposta(resposta: AnamnesisAnswers[string] | undefined): string {
  if (resposta === undefined || resposta === null || resposta === '') return '—';
  if (Array.isArray(resposta)) return resposta.length === 0 ? '—' : resposta.join(', ');
  if (typeof resposta === 'boolean') return resposta ? 'Sim' : 'Nao';
  return String(resposta);
}

/**
 * Decisao do alerta com justificativa obrigatoria no caminho bloqueante.
 *
 * A justificativa e o que responde "por que a massagem aconteceu mesmo com
 * essa restricao". Bloquear com justificativa curta e inutil; por isso o
 * campo e exigido quando a escolha e `BLOQUEADO`.
 */
function FormularioDecisao({
  alerta,
  onConcluir,
}: {
  alerta: ContraindicationAlert;
  onConcluir: () => void;
}) {
  const queryClient = useQueryClient();
  const clientId = alerta.clientId;

  const [decisao, setDecisao] = useState<'ACEITO' | 'BLOQUEADO'>('ACEITO');
  const [justificativa, setJustificativa] = useState('');

  const decidir = useMutation({
    mutationFn: () =>
      decidirAlerta(alerta.id, {
        decision: decisao,
        ...(justificativa.trim() === '' ? {} : { decisionNotes: justificativa.trim() }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.cliente(clientId) });
      onConcluir();
    },
  });

  const faltaJustificativa = decisao === 'BLOQUEADO' && justificativa.trim() === '';

  return (
    <form
      className="space-y-4"
      onSubmit={(evento) => {
        evento.preventDefault();
        decidir.mutate();
      }}
    >
      <p className="text-sm text-slate-600">{alerta.message}</p>

      <SelectField
        label="Decisao"
        value={decisao}
        onChange={(evento) => setDecisao(evento.target.value as 'ACEITO' | 'BLOQUEADO')}
      >
        <option value="ACEITO">Atendimento autorizado</option>
        <option value="BLOQUEADO">Atendimento bloqueado</option>
      </SelectField>

      <TextareaField
        label="Justificativa"
        hint={decisao === 'BLOQUEADO' ? 'Obrigatoria ao bloquear.' : 'Opcional.'}
        maxLength={1000}
        value={justificativa}
        onChange={(evento) => setJustificativa(evento.target.value)}
      />

      {decidir.isError ? <CaixaErro mensagem={mensagemDeErro(decidir.error)} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button type="submit" disabled={decidir.isPending || faltaJustificativa}>
          {decidir.isPending ? 'Registrando...' : 'Registrar decisao'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Condicao nova. O catalogo e a fonte preferida porque e ele que se cruza com
 * as therapies e gera alerta; o caminho avulso existe para o que so o
 * profissional ouviu (e nesse caso o codigo escrito e o que faz o casamento).
 */
function FormularioCondicao({
  clientId,
  onConcluir,
}: {
  clientId: string;
  onConcluir: () => void;
}) {
  const queryClient = useQueryClient();

  const [doCatalogo, setDoCatalogo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [gravidade, setGravidade] = useState<'BAIXA' | 'MEDIA' | 'ALTA'>('MEDIA');
  const [atestado, setAtestado] = useState(false);
  const [notas, setNotas] = useState('');

  const catalogo = useQuery({
    queryKey: chavesProntuario.contraindicacoes,
    queryFn: () => listarContraindicacoes(false),
  });

  const escolhida: Contraindication | undefined = catalogo.data?.items.find(
    (item) => item.id === doCatalogo,
  );

  const salvar = useMutation({
    mutationFn: () =>
      registrarCondicao(clientId, {
        // A API usa o titulo do corpo mesmo quando a condicao vem do catalogo,
        // entao o painel envia o titulo do item escolhido. Codigo, gravidade e
        // atestado sao herdados do catalogo quando o painel nao os manda.
        ...(doCatalogo === ''
          ? {
              code: codigo.trim().toUpperCase(),
              severity: gravidade,
              requiresMedicalClearance: atestado,
            }
          : { contraindicationId: doCatalogo }),
        title: escolhida?.title ?? titulo.trim(),
        ...(descricao.trim() === '' ? {} : { description: descricao.trim() }),
        ...(notas.trim() === '' ? {} : { notes: notas.trim() }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.cliente(clientId) });
      onConcluir();
    },
  });

  const invalido = doCatalogo === '' && (codigo.trim() === '' || titulo.trim() === '');

  return (
    <form
      className="space-y-4"
      onSubmit={(evento) => {
        evento.preventDefault();
        salvar.mutate();
      }}
    >
      <SelectField
        label="Do catalogo da clinica"
        value={doCatalogo}
        onChange={(evento) => setDoCatalogo(evento.target.value)}
      >
        <option value="">Nao -- registrar condicao avulsa</option>
        {(catalogo.data?.items ?? []).map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </SelectField>

      {escolhida !== undefined ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Gravidade e exigencia de atestado vem do catalogo:{' '}
          {ALERT_SEVERITY_LABELS[escolhida.severity]}
          {escolhida.requiresMedicalClearance ? ' · exige atestado' : ''}.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextareaField
              label="Titulo"
              maxLength={120}
              value={titulo}
              onChange={(evento) => setTitulo(evento.target.value)}
            />
            <TextField
              label="Codigo"
              hint="Em maiusculas, como GESTACAO"
              maxLength={40}
              value={codigo}
              onChange={(evento) => setCodigo(evento.target.value)}
            />
            <SelectField
              label="Gravidade"
              value={gravidade}
              onChange={(evento) => setGravidade(evento.target.value as 'BAIXA' | 'MEDIA' | 'ALTA')}
            >
              <option value="BAIXA">Baixa</option>
              <option value="MEDIA">Media</option>
              <option value="ALTA">Alta</option>
            </SelectField>
            <div className="flex items-end pb-1">
              <CheckboxField
                label="Exige atestado"
                checked={atestado}
                onChange={(evento) => setAtestado(evento.target.checked)}
              />
            </div>
          </div>
        </>
      )}

      <TextareaField
        label="Detalhe"
        hint="O que o profissional contou. Aparece so para a equipe."
        maxLength={600}
        value={descricao}
        onChange={(evento) => setDescricao(evento.target.value)}
      />

      <TextareaField
        label="Observacao"
        maxLength={1000}
        value={notas}
        onChange={(evento) => setNotas(evento.target.value)}
      />

      {invalido ? <CaixaErro mensagem="Escolha do catalogo ou preencha titulo e codigo." /> : null}
      {salvar.isError ? <CaixaErro mensagem={mensagemDeErro(salvar.error)} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvar.isPending || invalido}>
          {salvar.isPending ? 'Salvando...' : 'Registrar'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Registrar anamnese dita pelo profissional durante a conversa.
 *
 * O formulario vem do template escolhido e a validacao roda **antes** do POST
 * com a mesma funcao do backend (`validarRespostasAnamnesis`): mostrar o erro
 * aqui evita o 422 e mantem o texto da mensagem igual nos dois lados.
 */
function FormularioAnamnese({
  clientId,
  onConcluir,
}: {
  clientId: string;
  onConcluir: () => void;
}) {
  const queryClient = useQueryClient();

  const [templateId, setTemplateId] = useState('');
  const [respostas, setRespostas] = useState<AnamnesisAnswers>({});
  const [errosDeCampo, setErrosDeCampo] = useState<string[]>([]);

  const templates = useQuery({
    queryKey: chavesProntuario.templates,
    queryFn: () => listarTemplates(false),
  });

  const salvar = useMutation({
    mutationFn: () =>
      registrarAnamnese(clientId, {
        templateId,
        answers: respostas,
        enviar: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.cliente(clientId) });
      onConcluir();
    },
  });

  const template = templates.data?.items.find((item) => item.id === templateId);

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    if (template === undefined) return;

    const problemas = validarRespostasAnamnesis(template.schema, respostas);
    setErrosDeCampo(problemas);
    if (problemas.length === 0) salvar.mutate();
  }

  return (
    <form className="space-y-4" onSubmit={enviar}>
      <SelectField
        label="Formulario"
        value={templateId}
        onChange={(evento) => {
          setTemplateId(evento.target.value);
          setRespostas({});
          setErrosDeCampo([]);
        }}
      >
        <option value="">Escolha...</option>
        {(templates.data?.items ?? []).map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} (v{item.version})
          </option>
        ))}
      </SelectField>

      {template !== undefined ? (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-800">Respostas</legend>
          {template.schema.order.map((chave) => {
            const definicao = template.schema.properties[chave];
            if (definicao === undefined) return null;
            return (
              <CampoResposta
                key={chave}
                titulo={definicao.title ?? chave}
                descricao={definicao.description}
                formato={definicao.format}
                tipo={definicao.type}
                opcoes={definicao.enum}
                obrigatorio={template.schema.required.includes(chave)}
                valor={respostas[chave]}
                onChange={(valor) => setRespostas((atuais) => ({ ...atuais, [chave]: valor }))}
              />
            );
          })}
        </fieldset>
      ) : (
        <p className="text-xs text-slate-400">Escolha um formulario para preencher.</p>
      )}

      {errosDeCampo.length > 0 ? <CaixaErro mensagem={errosDeCampo.join(' ')} /> : null}
      {salvar.isError ? <CaixaErro mensagem={mensagemDeErro(salvar.error)} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvar.isPending || template === undefined}>
          {salvar.isPending ? 'Registrando...' : 'Registrar e enviar'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Link de anamnese para o cliente responder sozinho.
 *
 * Diferente de `FormularioAnamnese`, que dita a resposta no atendimento: aqui a
 * profissional nao digita nada, ela so escolhe o formulario e entrega o link.
 *
 * O token em claro aparece **uma vez**, na resposta da criacao. O banco guarda
 * so o SHA-256, entao a listagem mostra situacao (aberto, enviado, expirado) e
 * nao o link -- link perdido se resolve gerando outro, nao existe "reenviar o
 * mesmo".
 */
function FormularioConvite({ clientId, onConcluir }: { clientId: string; onConcluir: () => void }) {
  const queryClient = useQueryClient();

  const [templateId, setTemplateId] = useState('');
  const [validade, setValidade] = useState('7');
  const [linkGerado, setLinkGerado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const templates = useQuery({
    queryKey: chavesProntuario.templates,
    queryFn: () => listarTemplates(false),
  });

  const convites = useQuery({
    queryKey: chavesProntuario.convites(clientId),
    queryFn: () => listarConvites(clientId),
  });

  const criar = useMutation({
    mutationFn: () =>
      criarConvite(clientId, {
        templateId,
        expiresInDays: Number(validade),
      }),
    onSuccess: (convite) => {
      setLinkGerado(`${env.VITE_WEB_URL}/anamnese/${convite.token}`);
      setCopiado(false);
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.convites(clientId) });
    },
  });

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    criar.mutate();
  }

  async function copiar() {
    if (linkGerado === null) return;
    try {
      await navigator.clipboard.writeText(linkGerado);
      setCopiado(true);
    } catch {
      // Clipboard bloqueado (http sem TLS, permissao negada): o campo fica
      // selecionado para o profissional copiar na mao.
      setCopiado(false);
    }
  }

  const anteriores = convites.data?.items ?? [];

  return (
    <form className="space-y-4" onSubmit={aoEnviar}>
      <p className="text-sm text-slate-600">
        Gere o link e mande por WhatsApp ou SMS. O cliente responde sem login e o link vale para um
        unico envio.
      </p>

      {templates.isPending ? (
        <p className="text-sm text-slate-500">Carregando formularios...</p>
      ) : (templates.data?.items ?? []).length === 0 ? (
        <EstadoVazio mensagem="Nenhum formulario ativo. Cadastre um em Formularios antes de gerar link." />
      ) : (
        <SelectField
          label="Formulario"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">Selecione...</option>
          {(templates.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} (v{item.version})
            </option>
          ))}
        </SelectField>
      )}

      <SelectField
        label="Validade do link"
        value={validade}
        onChange={(e) => setValidade(e.target.value)}
      >
        <option value="1">1 dia</option>
        <option value="3">3 dias</option>
        <option value="7">7 dias</option>
        <option value="14">14 dias</option>
        <option value="30">30 dias</option>
      </SelectField>

      {criar.isError ? <CaixaErro mensagem={mensagemDeErro(criar.error)} /> : null}

      {linkGerado !== null ? (
        <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            Link criado. Copie agora: ele nao aparece de novo.
          </p>
          <TextField label="Link" readOnly value={linkGerado} />
          <div className="flex justify-end">
            <Button type="button" tamanho="sm" onClick={() => void copiar()}>
              {copiado ? 'Copiado' : 'Copiar link'}
            </Button>
          </div>
        </div>
      ) : null}

      {anteriores.length > 0 ? (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <h3 className="text-sm font-semibold text-slate-800">Links anteriores</h3>
          <ul className="space-y-2">
            {anteriores.map((convite) => {
              const situacao = situacaoConvite(convite);
              return (
                <li key={convite.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-700">{convite.templateName}</span>
                  <Badge tone={situacao.tom}>{situacao.rotulo}</Badge>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-slate-400">
            O link em claro nao fica guardado. Se o cliente nao responder, gere outro.
          </p>
        </div>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Fechar
        </Button>
        <Button type="submit" disabled={criar.isPending || templateId === ''}>
          {criar.isPending ? 'Gerando...' : 'Gerar link'}
        </Button>
      </div>
    </form>
  );
}

/** Situacao do convite pelo que a listagem devolve: `usedAt` e `expiresAt`. */
function situacaoConvite(convite: AnamnesisInviteListItem): {
  tom: 'neutral' | 'success' | 'warning';
  rotulo: string;
} {
  if (convite.usedAt !== null) return { tom: 'success', rotulo: 'Respondido' };
  if (new Date(convite.expiresAt).getTime() <= Date.now()) {
    return { tom: 'neutral', rotulo: 'Expirado' };
  }
  return { tom: 'warning', rotulo: 'Aberto' };
}

/**
 * Controle do formulario conforme o tipo do campo.
 *
 * `boolean` e checkbox (nao select "sim/nao"): em formulario de saude a
 * pergunta "tem alguma alergia?" respondida com um clique e resposta mais
 * honesta que uma lista de duas opcoes.
 */
function CampoResposta({
  titulo,
  descricao,
  formato,
  tipo,
  opcoes,
  obrigatorio,
  valor,
  onChange,
}: {
  titulo: string;
  descricao: string | undefined;
  formato: 'text' | 'textarea' | 'date' | undefined;
  tipo: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  opcoes: string[] | undefined;
  obrigatorio: boolean;
  valor: AnamnesisAnswers[string] | undefined;
  onChange: (valor: AnamnesisAnswers[string]) => void;
}) {
  const rotulo = `${titulo}${obrigatorio ? ' *' : ''}`;
  const comum = { label: rotulo, hint: descricao } as const;

  if (tipo === 'boolean') {
    return (
      <CheckboxField
        label={rotulo}
        checked={valor === true}
        onChange={(evento) => onChange(evento.target.checked)}
      />
    );
  }

  if (tipo === 'array') {
    const marcadas = Array.isArray(valor) ? valor : [];
    return (
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-slate-700">{rotulo}</legend>
        {descricao !== undefined ? <p className="text-xs text-slate-500">{descricao}</p> : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(opcoes ?? []).map((opcao) => (
            <CheckboxField
              key={opcao}
              label={opcao}
              checked={marcadas.includes(opcao)}
              onChange={(evento) =>
                onChange(
                  evento.target.checked
                    ? [...marcadas, opcao]
                    : marcadas.filter((item) => item !== opcao),
                )
              }
            />
          ))}
        </div>
      </fieldset>
    );
  }

  if (opcoes !== undefined && opcoes.length > 0) {
    return (
      <SelectField
        {...comum}
        value={typeof valor === 'string' ? valor : ''}
        onChange={(evento) => onChange(evento.target.value === '' ? null : evento.target.value)}
      >
        <option value="">Sem resposta</option>
        {opcoes.map((opcao) => (
          <option key={opcao} value={opcao}>
            {opcao}
          </option>
        ))}
      </SelectField>
    );
  }

  if (formato === 'textarea') {
    return (
      <TextareaField
        {...comum}
        value={typeof valor === 'string' ? valor : ''}
        onChange={(evento) => onChange(evento.target.value)}
      />
    );
  }

  if (formato === 'date') {
    return (
      <TextField
        {...comum}
        type="date"
        value={typeof valor === 'string' ? valor : ''}
        onChange={(evento) => onChange(evento.target.value === '' ? null : evento.target.value)}
      />
    );
  }

  if (tipo === 'number' || tipo === 'integer') {
    return (
      <TextField
        {...comum}
        type="number"
        step={tipo === 'integer' ? 1 : 'any'}
        value={typeof valor === 'number' ? String(valor) : ''}
        onChange={(evento) =>
          onChange(evento.target.value === '' ? null : Number(evento.target.value))
        }
      />
    );
  }

  return (
    <TextField
      {...comum}
      value={typeof valor === 'string' ? valor : ''}
      onChange={(evento) => onChange(evento.target.value)}
    />
  );
}
