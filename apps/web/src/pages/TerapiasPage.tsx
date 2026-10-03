import type { Therapy, TherapyCreate } from '@massoterapia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField, TextareaField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { CaixaErro, Carregando, EstadoVazio, PageHeader, Panel } from '@/components/ui/panel';
import {
  atualizarTerapia,
  criarTerapia,
  desativarTerapia,
  listarTerapias,
  mensagemDeErro,
} from '@/lib/cadastros';
import { deCentavos, formatBRL, paraCentavos, paraNumero } from '@/lib/format';

export function TerapiasPage() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [busca, setBusca] = useState('');
  const [incluirInativas, setIncluirInativas] = useState(false);
  const [editando, setEditando] = useState<Therapy | null>(null);
  const [criando, setCriando] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ['terapias', busca, incluirInativas],
    queryFn: () => listarTerapias({ search: busca, includeInactive: incluirInativas }),
  });

  const desativar = useMutation({
    mutationFn: (id: string) => desativarTerapia(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['terapias'] });
    },
  });

  function fecharFormulario(): void {
    setEditando(null);
    setCriando(false);
  }

  function confirmarDesativar(terapia: Therapy): void {
    if (window.confirm(`Desativar a terapia "${terapia.name}"?`)) {
      desativar.mutate(terapia.id);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Terapias"
        descricao="Cardapio de terapias, com duracao, intervalo e preco."
        acoes={
          podeEscrever ? <Button onClick={() => setCriando(true)}>Nova terapia</Button> : undefined
        }
      />

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full max-w-xs">
            <TextField
              label="Buscar"
              placeholder="Nome da terapia"
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
            />
          </div>
          <CheckboxField
            label="Mostrar inativas"
            checked={incluirInativas}
            onChange={(evento) => setIncluirInativas(evento.target.checked)}
          />
        </div>

        {isPending ? (
          <Carregando />
        ) : isError ? (
          <CaixaErro mensagem="Nao foi possivel carregar as terapias." />
        ) : data.items.length === 0 ? (
          <EstadoVazio mensagem="Nenhuma terapia cadastrada." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="py-2">Terapia</th>
                  <th className="py-2">Duracao</th>
                  <th className="py-2">Preco</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((terapia) => (
                  <tr key={terapia.id} className="border-t border-slate-100">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border border-slate-200"
                          style={{ backgroundColor: terapia.color ?? '#e2e8f0' }}
                        />
                        <span className="font-medium text-slate-800">{terapia.name}</span>
                      </div>
                      {terapia.category !== null ? (
                        <span className="text-xs text-slate-400">{terapia.category}</span>
                      ) : null}
                    </td>
                    <td className="py-2 text-slate-600">{terapia.durationMinutes} min</td>
                    <td className="py-2 text-slate-600">{formatBRL(terapia.priceCents)}</td>
                    <td className="py-2">
                      <Badge tone={terapia.active ? 'success' : 'neutral'}>
                        {terapia.active ? 'Ativa' : 'Inativa'}
                      </Badge>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {podeEscrever ? (
                        <>
                          <Button
                            variante="fantasma"
                            tamanho="sm"
                            onClick={() => setEditando(terapia)}
                          >
                            Editar
                          </Button>
                          {terapia.active ? (
                            <Button
                              variante="fantasma"
                              tamanho="sm"
                              onClick={() => confirmarDesativar(terapia)}
                            >
                              Desativar
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        aberto={criando || editando !== null}
        titulo={editando ? 'Editar terapia' : 'Nova terapia'}
        onFechar={fecharFormulario}
      >
        <FormularioTerapia terapia={editando ?? undefined} onConcluir={fecharFormulario} />
      </Modal>
    </div>
  );
}

function FormularioTerapia({ terapia, onConcluir }: { terapia?: Therapy; onConcluir: () => void }) {
  const queryClient = useQueryClient();

  const [nome, setNome] = useState(terapia?.name ?? '');
  const [categoria, setCategoria] = useState(terapia?.category ?? '');
  const [descricao, setDescricao] = useState(terapia?.description ?? '');
  const [duracao, setDuracao] = useState(String(terapia?.durationMinutes ?? 60));
  const [intervalo, setIntervalo] = useState(String(terapia?.bufferMinutes ?? 0));
  const [preco, setPreco] = useState(terapia ? deCentavos(terapia.priceCents) : '');
  const [corAtiva, setCorAtiva] = useState(terapia?.color !== null && terapia?.color !== undefined);
  const [cor, setCor] = useState(terapia?.color ?? '#14b8a6');
  const [exigeAnamnese, setExigeAnamnese] = useState(terapia?.requiresAnamnesis ?? true);
  const [exigeAtestado, setExigeAtestado] = useState(terapia?.requiresMedicalClearance ?? false);
  const [aviso, setAviso] = useState(String(terapia?.minNoticeMinutes ?? 0));
  const [idadeMin, setIdadeMin] = useState(terapia?.minAge?.toString() ?? '');
  const [idadeMax, setIdadeMax] = useState(terapia?.maxAge?.toString() ?? '');
  const [ativa, setAtiva] = useState(terapia?.active ?? true);

  const salvar = useMutation({
    mutationFn: () => {
      const base = {
        name: nome,
        category: categoria,
        description: descricao,
        durationMinutes: paraNumero(duracao) ?? 0,
        bufferMinutes: paraNumero(intervalo) ?? 0,
        priceCents: paraCentavos(preco),
        requiresAnamnesis: exigeAnamnese,
        requiresMedicalClearance: exigeAtestado,
        minNoticeMinutes: paraNumero(aviso) ?? 0,
        minAge: paraNumero(idadeMin),
        maxAge: paraNumero(idadeMax),
        position: terapia?.position ?? 0,
        active: ativa,
      } satisfies Omit<TherapyCreate, 'color'>;

      if (terapia) {
        return atualizarTerapia(terapia.id, { ...base, color: corAtiva ? cor : '' });
      }
      return criarTerapia(corAtiva ? { ...base, color: cor } : base);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['terapias'] });
      onConcluir();
    },
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nome"
          required
          maxLength={120}
          value={nome}
          onChange={(evento) => setNome(evento.target.value)}
        />
        <TextField
          label="Categoria"
          maxLength={60}
          value={categoria}
          onChange={(evento) => setCategoria(evento.target.value)}
        />
      </div>

      <TextareaField
        label="Descricao"
        maxLength={1200}
        value={descricao}
        onChange={(evento) => setDescricao(evento.target.value)}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Duracao (min)"
          type="number"
          min={5}
          max={600}
          required
          value={duracao}
          onChange={(evento) => setDuracao(evento.target.value)}
        />
        <TextField
          label="Intervalo (min)"
          type="number"
          min={0}
          max={240}
          value={intervalo}
          onChange={(evento) => setIntervalo(evento.target.value)}
        />
        <TextField
          label="Preco (R$)"
          type="number"
          min={0}
          step="0.01"
          required
          value={preco}
          onChange={(evento) => setPreco(evento.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Aviso minimo (min)"
          type="number"
          min={0}
          value={aviso}
          onChange={(evento) => setAviso(evento.target.value)}
        />
        <TextField
          label="Idade minima"
          type="number"
          min={0}
          max={120}
          value={idadeMin}
          onChange={(evento) => setIdadeMin(evento.target.value)}
        />
        <TextField
          label="Idade maxima"
          type="number"
          min={0}
          max={120}
          value={idadeMax}
          onChange={(evento) => setIdadeMax(evento.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <CheckboxField
          label="Cor no calendario"
          checked={corAtiva}
          onChange={(evento) => setCorAtiva(evento.target.checked)}
        />
        {corAtiva ? (
          <input
            type="color"
            aria-label="Cor da terapia"
            value={cor}
            onChange={(evento) => setCor(evento.target.value)}
            className="h-8 w-12 rounded border border-slate-300"
          />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4">
        <CheckboxField
          label="Exige anamnese"
          checked={exigeAnamnese}
          onChange={(evento) => setExigeAnamnese(evento.target.checked)}
        />
        <CheckboxField
          label="Exige atestado medico"
          checked={exigeAtestado}
          onChange={(evento) => setExigeAtestado(evento.target.checked)}
        />
        <CheckboxField
          label="Ativa"
          checked={ativa}
          onChange={(evento) => setAtiva(evento.target.checked)}
        />
      </div>

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
