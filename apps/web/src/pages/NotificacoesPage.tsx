import {
  type Notification as Notificacao,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUS_LABELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPE_LABELS,
  type NotificationChannel,
  type NotificationStatus,
} from '@massoterapia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/field';
import { CaixaErro, Carregando, EstadoVazio, PageHeader, Panel } from '@/components/ui/panel';
import { formatarTelefone } from '@/lib/format';
import { listarNotificacoes, reenviarNotificacao } from '@/lib/notificacoes';

/** "2026-02-03T14:05:00.000Z" -> "03/02/2026 14:05", no fuso do navegador. */
function rotuloInstante(valor: string): string {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const TOM_POR_SITUACAO: Record<NotificationStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  PENDENTE: 'warning',
  ENVIANDO: 'neutral',
  ENVIADO: 'success',
  ERRO: 'danger',
  CANCELADO: 'neutral',
};

/**
 * Reenvio e uma acao humana sobre um aviso que falhou: por isso o botao
 * pergunta antes. Um clique a mais aqui vira mensagem duplicada para o
 * cliente, que e o erro que a clinica mais reclama.
 */
function podeReenviar(notificacao: Notificacao): boolean {
  return (
    notificacao.status === 'PENDENTE' ||
    notificacao.status === 'ERRO' ||
    notificacao.status === 'ENVIADO'
  );
}

export function NotificacoesPage() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [situacao, setSituacao] = useState<NotificationStatus | ''>('');
  const [canal, setCanal] = useState<NotificationChannel | ''>('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(0);

  const POR_PAGINA = 25;

  const { data, isPending, isError } = useQuery({
    queryKey: ['notificacoes', situacao, canal, busca, pagina],
    queryFn: () =>
      listarNotificacoes({
        status: situacao === '' ? undefined : situacao,
        channel: canal === '' ? undefined : canal,
        search: busca.trim() === '' ? undefined : busca.trim(),
        limit: POR_PAGINA,
        offset: pagina * POR_PAGINA,
      }),
  });

  const reenviar = useMutation({
    mutationFn: (id: string) => reenviarNotificacao(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notificacoes'] });
    },
  });

  // Mudar filtro volta para a primeira pagina: senao o usuario cai em uma
  // pagina vazia e conclui que o filtro escondeu tudo.
  function trocarFiltro(apply: () => void): void {
    apply();
    setPagina(0);
  }

  function confirmarReenvio(notificacao: Notificacao): void {
    const para =
      notificacao.clientName ??
      (notificacao.channel === 'EMAIL' ? notificacao.recipient : 'cliente');
    if (window.confirm(`Reenviar "${NOTIFICATION_TYPE_LABELS[notificacao.type]}" para ${para}?`)) {
      reenviar.mutate(notificacao.id);
    }
  }

  const resumo = data?.resumo;
  const totalPaginas = data === undefined ? 0 : Math.ceil(data.total / POR_PAGINA);
  const erroReenvio = reenviar.isError
    ? 'Nao foi possivel reenviar o aviso. Tente novamente.'
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Notificacoes"
        descricao="O que a clinica avisou o cliente, se o aviso saiu e o que falhou."
      />

      {resumo !== undefined ? (
        <div className="flex flex-wrap gap-2">
          <Badge tone="danger">Falharam: {resumo.erro}</Badge>
          <Badge tone="warning">Na fila: {resumo.pendente + resumo.enviando}</Badge>
          <Badge tone="success">Enviados: {resumo.enviado}</Badge>
          <Badge tone="neutral">Cancelados: {resumo.cancelado}</Badge>
        </div>
      ) : null}

      <Panel className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="Situacao"
            value={situacao}
            onChange={(evento) =>
              trocarFiltro(() => setSituacao(evento.target.value as NotificationStatus | ''))
            }
          >
            <option value="">Todas</option>
            {NOTIFICATION_STATUSES.map((valor) => (
              <option key={valor} value={valor}>
                {NOTIFICATION_STATUS_LABELS[valor]}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Canal"
            value={canal}
            onChange={(evento) =>
              trocarFiltro(() => setCanal(evento.target.value as NotificationChannel | ''))
            }
          >
            <option value="">Todos</option>
            {NOTIFICATION_CHANNELS.map((valor) => (
              <option key={valor} value={valor}>
                {NOTIFICATION_CHANNEL_LABELS[valor]}
              </option>
            ))}
          </SelectField>

          <TextField
            label="Buscar"
            placeholder="Nome do cliente ou destinatario"
            value={busca}
            onChange={(evento) => trocarFiltro(() => setBusca(evento.target.value))}
          />
        </div>

        {erroReenvio !== null ? <CaixaErro mensagem={erroReenvio} /> : null}

        {isPending ? (
          <Carregando />
        ) : isError ? (
          <CaixaErro mensagem="Nao foi possivel carregar as notificacoes." />
        ) : data.items.length === 0 ? (
          <EstadoVazio mensagem="Nenhum aviso encontrado com esses filtros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="py-2">Criado</th>
                  <th className="py-2">Cliente</th>
                  <th className="py-2">Aviso</th>
                  <th className="py-2">Destinatario</th>
                  <th className="py-2">Situacao</th>
                  <th className="py-2 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((notificacao) => (
                  <tr key={notificacao.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 whitespace-nowrap text-slate-600">
                      {rotuloInstante(notificacao.createdAt)}
                    </td>
                    <td className="py-2 text-slate-800">
                      {notificacao.clientName ?? '—'}
                      {notificacao.appointmentId !== null ? (
                        <span className="block text-xs text-slate-400">Agendamento</span>
                      ) : null}
                    </td>
                    <td className="py-2">
                      <span className="block font-medium text-slate-800">
                        {NOTIFICATION_TYPE_LABELS[notificacao.type]}
                      </span>
                      <span className="block text-xs text-slate-400">
                        {NOTIFICATION_CHANNEL_LABELS[notificacao.channel]}
                      </span>
                      <span
                        className="mt-1 block max-w-md text-xs text-slate-500"
                        title={notificacao.body}
                      >
                        <span className="line-clamp-2">{notificacao.body}</span>
                      </span>
                      {notificacao.lastError !== null ? (
                        <span className="mt-1 block max-w-md text-xs text-rose-600">
                          {notificacao.lastError}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-slate-600">
                      {notificacao.channel === 'WHATSAPP'
                        ? formatarTelefone(notificacao.recipient)
                        : notificacao.recipient}
                    </td>
                    <td className="py-2">
                      <Badge tone={TOM_POR_SITUACAO[notificacao.status]}>
                        {NOTIFICATION_STATUS_LABELS[notificacao.status]}
                      </Badge>
                      <span className="mt-1 block text-xs text-slate-400">
                        {notificacao.attempts === 0
                          ? 'sem tentativas'
                          : `${notificacao.attempts} tentativa(s)`}
                      </span>
                      {notificacao.sentAt !== null ? (
                        <span className="block text-xs text-slate-400">
                          {rotuloInstante(notificacao.sentAt)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right">
                      {podeEscrever && podeReenviar(notificacao) ? (
                        <Button
                          variante="secundaria"
                          tamanho="sm"
                          disabled={reenviar.isPending}
                          onClick={() => confirmarReenvio(notificacao)}
                        >
                          Reenviar
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
              Pagina {pagina + 1} de {totalPaginas} · {data?.total ?? 0} aviso(s)
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
    </div>
  );
}
