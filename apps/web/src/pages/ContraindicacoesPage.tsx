import {
  ALERT_SEVERITY_LABELS,
  type AlertSeverity,
  type Contraindication,
} from '@massoterapia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField, TextareaField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { CaixaErro, Carregando, EstadoVazio, PageHeader, Panel } from '@/components/ui/panel';
import { listarTerapias, mensagemDeErro } from '@/lib/cadastros';
import {
  atualizarContraindication,
  chavesProntuario,
  criarContraindicacao,
  desvincularContraindicacao,
  listarContraindicacoes,
  vincularContraindicacao,
} from '@/lib/prontuario';

/**
 * Catalogo de contraindicacoes da clinica.
 *
 * E a fonte unica de "isto nao se faz": o prontuario do cliente escolhe um item
 * daqui e herda gravidade e exigencia de atestado. Por isso a tela separa o
 * que e regra clinica (gravidade, atestado) do que e organizacao (titulo,
 * description, ativo).
 *
 * O vinculo com a terapia e opcional e tambem aceita sobrescrever a gravidade
 * so naquele par. Como a lista do catalogo devolve apenas os ids das terapias,
 * a tela mostra o nome da terapia e deixa o ajuste como edicao explicita do
 * vinculo -- em vez de afirmar na tela uma severidade que ela nao leu.
 */

const TOM_SEVERIDADE: Record<AlertSeverity, 'neutral' | 'warning' | 'danger'> = {
  BAIXA: 'neutral',
  MEDIA: 'warning',
  ALTA: 'danger',
};

/** "Herdar" precisa existir como opcao: e o que mantem o catalogo no comando. */
const OPCOES_SEVERIDADE: Array<{ valor: '' | AlertSeverity; rotulo: string }> = [
  { valor: '', rotulo: 'Herdar do catalogo' },
  { valor: 'BAIXA', rotulo: 'Baixa' },
  { valor: 'MEDIA', rotulo: 'Media' },
  { valor: 'ALTA', rotulo: 'Alta' },
];

interface Rascunho {
  codigo: string;
  titulo: string;
  descricao: string;
  gravidade: AlertSeverity;
  atestado: boolean;
}

function rascunhoDe(item: Contraindication): Rascunho {
  return {
    codigo: item.code,
    titulo: item.title,
    descricao: item.description ?? '',
    gravidade: item.severity,
    atestado: item.requiresMedicalClearance,
  };
}

export function ContraindicacoesPage() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [incluirInativas, setIncluirInativas] = useState(false);
  const [busca, setBusca] = useState('');
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Contraindication | null>(null);
  const [vinculando, setVinculando] = useState<Contraindication | null>(null);

  const catalogo = useQuery({
    queryKey: [...chavesProntuario.contraindicacoes, incluirInativas],
    queryFn: () => listarContraindicacoes(incluirInativas),
  });

  const terapias = useQuery({
    queryKey: ['terapias', 'catalogo-contraindicacoes'],
    queryFn: () => listarTerapias({ includeInactive: true }),
    enabled: podeEscrever,
  });

  const nomeDaTerapia = new Map(
    (terapias.data?.items ?? []).map((terapia) => [terapia.id, terapia.name]),
  );

  const alternarAtiva = useMutation({
    mutationFn: (item: Contraindication) =>
      atualizarContraindication(item.id, { active: !item.active }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.contraindicacoes });
    },
    onError: (erro) => {
      window.alert(mensagemDeErro(erro));
    },
  });

  const itens = (catalogo.data?.items ?? []).filter((item) => {
    const termo = busca.trim().toLowerCase();
    if (termo === '') return true;
    return item.code.toLowerCase().includes(termo) || item.title.toLowerCase().includes(termo);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Contraindicacoes"
        descricao="O que a clinica considera risco. O prontuario do cliente herda gravidade e exigencia de atestado daqui."
        acoes={
          podeEscrever ? (
            <Button onClick={() => setCriando(true)}>Nova contraindicacao</Button>
          ) : null
        }
      />

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <TextField
            label="Buscar"
            className="max-w-xs"
            placeholder="Codigo ou titulo"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
          <CheckboxField
            label="Mostrar inativas"
            checked={incluirInativas}
            onChange={(evento) => setIncluirInativas(evento.target.checked)}
          />
        </div>

        {catalogo.isPending ? (
          <Carregando />
        ) : catalogo.isError ? (
          <CaixaErro mensagem="Nao foi possivel carregar o catalogo de contraindicacoes." />
        ) : itens.length === 0 ? (
          <EstadoVazio mensagem="Nenhuma contraindicacao cadastrada." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="py-2">Contraindicacao</th>
                  <th className="py-2">Gravidade</th>
                  <th className="py-2">Terapias</th>
                  <th className="py-2">Situacao</th>
                  <th className="py-2 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100 align-top">
                    <td className="py-2">
                      <span className="font-mono text-xs text-slate-500">{item.code}</span>
                      <span className="block font-medium text-slate-800">{item.title}</span>
                      {item.description !== null ? (
                        <span className="mt-1 block max-w-md text-xs text-slate-500">
                          {item.description}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2">
                      <Badge tone={TOM_SEVERIDADE[item.severity]}>
                        {ALERT_SEVERITY_LABELS[item.severity]}
                      </Badge>
                      {item.requiresMedicalClearance ? (
                        <Badge tone="warning" className="ml-1">
                          Exige atestado
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-2 text-slate-600">
                      {item.therapyIds.length === 0 ? (
                        <span className="text-xs text-slate-400">Nenhuma</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {item.therapyIds.map((id) => (
                            <li key={id}>{nomeDaTerapia.get(id) ?? 'Terapia removida'}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-2">
                      <Badge tone={item.active ? 'success' : 'neutral'}>
                        {item.active ? 'Ativa' : 'Inativa'}
                      </Badge>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {podeEscrever ? (
                        <>
                          <Button
                            variante="fantasma"
                            tamanho="sm"
                            onClick={() => setVinculando(item)}
                          >
                            Terapias
                          </Button>
                          <Button
                            variante="fantasma"
                            tamanho="sm"
                            onClick={() => setEditando(item)}
                          >
                            Editar
                          </Button>
                          <Button
                            variante="fantasma"
                            tamanho="sm"
                            disabled={alternarAtiva.isPending}
                            onClick={() => alternarAtiva.mutate(item)}
                          >
                            {item.active ? 'Desativar' : 'Ativar'}
                          </Button>
                        </>
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
      </Panel>

      <Modal aberto={criando} titulo="Nova contraindicacao" onFechar={() => setCriando(false)}>
        <FormularioContraindicacao
          onConcluir={() => setCriando(false)}
          onSalvar={(rascunho) =>
            criarContraindicacao({
              code: rascunho.codigo,
              title: rascunho.titulo,
              ...(rascunho.descricao === '' ? {} : { description: rascunho.descricao }),
              severity: rascunho.gravidade,
              requiresMedicalClearance: rascunho.atestado,
              // Item nasce sem terapia: o vinculo tem endpoint proprio porque
              // aceita sobrescrever a gravidade so naquele par.
              therapyIds: [],
            })
          }
        />
      </Modal>

      <Modal
        aberto={editando !== null}
        titulo="Editar contraindicacao"
        onFechar={() => setEditando(null)}
      >
        {editando !== null ? (
          <FormularioContraindicacao
            inicial={rascunhoDe(editando)}
            somenteLeituraCodigo
            onConcluir={() => setEditando(null)}
            onSalvar={(rascunho) =>
              // O codigo e a chave que o prontuario e a API usam para casar a
              // condicao com o catalogo: trocar depois deixaria historico
              // apontando para um codigo que nao existe mais.
              atualizarContraindication(editando.id, {
                title: rascunho.titulo,
                description: rascunho.descricao,
                severity: rascunho.gravidade,
                requiresMedicalClearance: rascunho.atestado,
              })
            }
          />
        ) : null}
      </Modal>

      <Modal
        aberto={vinculando !== null}
        titulo="Terapias com esta contraindicacao"
        onFechar={() => setVinculando(null)}
      >
        {vinculando !== null ? (
          <VinculosContraindicacao
            item={vinculando}
            onConcluir={() => setVinculando(null)}
            nomeDaTerapia={nomeDaTerapia}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function FormularioContraindicacao({
  inicial,
  somenteLeituraCodigo = false,
  onSalvar,
  onConcluir,
}: {
  inicial?: Rascunho;
  somenteLeituraCodigo?: boolean;
  onSalvar: (rascunho: Rascunho) => Promise<unknown>;
  onConcluir: () => void;
}) {
  const queryClient = useQueryClient();
  const [codigo, setCodigo] = useState(inicial?.codigo ?? '');
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '');
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '');
  const [gravidade, setGravidade] = useState<AlertSeverity>(inicial?.gravidade ?? 'MEDIA');
  const [atestado, setAtestado] = useState(inicial?.atestado ?? false);

  const salvar = useMutation({
    mutationFn: () => onSalvar({ codigo, titulo, descricao, gravidade, atestado }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.contraindicacoes });
      onConcluir();
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(evento) => {
        evento.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Codigo"
          hint="Em maiusculas, como GESTACAO"
          maxLength={40}
          readOnly={somenteLeituraCodigo}
          value={codigo}
          onChange={(evento) => setCodigo(evento.target.value)}
        />
        <TextField
          label="Titulo"
          maxLength={120}
          value={titulo}
          onChange={(evento) => setTitulo(evento.target.value)}
        />
        <SelectField
          label="Gravidade"
          value={gravidade}
          onChange={(evento) => setGravidade(evento.target.value as AlertSeverity)}
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

      <TextareaField
        label="Descricao"
        hint="O que a equipe precisa saber antes de atender."
        maxLength={600}
        value={descricao}
        onChange={(evento) => setDescricao(evento.target.value)}
      />

      {salvar.isError ? <CaixaErro mensagem={mensagemDeErro(salvar.error)} /> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variante="fantasma" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvar.isPending}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

function VinculosContraindicacao({
  item,
  nomeDaTerapia,
  onConcluir,
}: {
  item: Contraindication;
  nomeDaTerapia: Map<string, string>;
  onConcluir: () => void;
}) {
  const queryClient = useQueryClient();
  const [terapiaId, setTerapiaId] = useState('');
  const [gravidade, setGravidade] = useState<'' | AlertSeverity>('');
  const [atestado, setAtestado] = useState<boolean | null>(null);

  const terapias = useQuery({
    queryKey: ['terapias', 'catalogo-contraindicacoes'],
    queryFn: () => listarTerapias({ includeInactive: true }),
  });

  const vincular = useMutation({
    mutationFn: () =>
      vincularContraindicacao(terapiaId, {
        contraindicationId: item.id,
        // `null` e o que a API grava como "herda": manda-se `undefined` apenas
        // quando o painel nem tocou no campo.
        severity: gravidade === '' ? null : gravidade,
        requiresMedicalClearance: atestado,
      }),
    onSuccess: () => {
      setTerapiaId('');
      setGravidade('');
      setAtestado(null);
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.contraindicacoes });
    },
  });

  const desvincular = useMutation({
    mutationFn: (id: string) => desvincularContraindicacao(id, item.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.contraindicacoes });
    },
  });

  const disponiveis = (terapias.data?.items ?? []).filter(
    (terapia) => !item.therapyIds.includes(terapia.id),
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Vincular faz esta contraindicacao aparecer como alerta sempre que a terapia for agendada.
        Gravidade e atestado <strong>herdam</strong> o catalogo, salvo se voce sobrescrever aqui.
      </p>

      {item.therapyIds.length === 0 ? (
        <EstadoVazio mensagem="Nenhuma terapia vinculada." />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {item.therapyIds.map((id) => (
            <li key={id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm text-slate-700">{nomeDaTerapia.get(id) ?? id}</span>
              <Button
                variante="fantasma"
                tamanho="sm"
                disabled={desvincular.isPending}
                onClick={() => desvincular.mutate(id)}
              >
                Desvincular
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
        onSubmit={(evento) => {
          evento.preventDefault();
          vincular.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="Terapia"
            value={terapiaId}
            onChange={(evento) => setTerapiaId(evento.target.value)}
          >
            <option value="">Escolha...</option>
            {disponiveis.map((terapia) => (
              <option key={terapia.id} value={terapia.id}>
                {terapia.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Gravidade nesta terapia"
            value={gravidade}
            onChange={(evento) => setGravidade(evento.target.value as '' | AlertSeverity)}
          >
            {OPCOES_SEVERIDADE.map((opcao) => (
              <option key={opcao.valor} value={opcao.valor}>
                {opcao.rotulo}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Atestado nesta terapia"
            value={atestado === null ? '' : atestado ? 'true' : 'false'}
            onChange={(evento) =>
              setAtestado(evento.target.value === '' ? null : evento.target.value === 'true')
            }
          >
            <option value="">Herdar do catalogo</option>
            <option value="true">Exigir atestado</option>
            <option value="false">Nao exigir</option>
          </SelectField>
        </div>

        {vincular.isError ? <CaixaErro mensagem={mensagemDeErro(vincular.error)} /> : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={terapiaId === '' || vincular.isPending}>
            Vincular
          </Button>
        </div>
      </form>

      <div className="flex justify-end">
        <Button variante="fantasma" onClick={onConcluir}>
          Concluir
        </Button>
      </div>
    </div>
  );
}
