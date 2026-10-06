import {
  type AnamnesisForm,
  type AnamnesisProperty,
  type AnamnesisTemplate,
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
import { formatarData } from '@/lib/format';
import {
  atualizarTemplate,
  chavesProntuario,
  criarTemplate,
  listarTemplates,
  novaVersaoTemplate,
} from '@/lib/prontuario';

/**
 * Formularios de anamnese (templates).
 *
 * ADMIN monta o formulario; profissional e cliente apenas o respondem. A tela
 * monta o JSON Schema campo a campo em vez de pedir JSON puro: o formulario e
 * dado de leitura do cliente e da revisao, e ninguem escreve JSON a mao para
 * dizer "campo obrigatorio" -- mas o `order` e o `required` continuam saindo
 * de uma fonte unica porque e isso que a API valida.
 */

/** `textarea` e `date` sao `format` do tipo `string`, mas para quem monta o formulario sao tipos. */
type TipoDeCampo = AnamnesisProperty['type'] | 'textarea' | 'date';

const TIPOS: Array<{ valor: TipoDeCampo; rotulo: string }> = [
  { valor: 'string', rotulo: 'Texto' },
  { valor: 'textarea', rotulo: 'Texto longo' },
  { valor: 'boolean', rotulo: 'Sim ou nao' },
  { valor: 'number', rotulo: 'Numero' },
  { valor: 'integer', rotulo: 'Numero inteiro' },
  { valor: 'date', rotulo: 'Data' },
  { valor: 'array', rotulo: 'Lista de opcoes' },
];

interface CampoEditor {
  chave: string;
  titulo: string;
  tipo: TipoDeCampo;
  obrigatorio: boolean;
  /** Uma opcao por linha; so faz sentido em `enum` e `array`. */
  opcoes: string;
}

function campoVazio(): CampoEditor {
  return { chave: '', titulo: '', tipo: 'string', obrigatorio: false, opcoes: '' };
}

/** `false` enquanto o campo nao tem chave nem titulo: campo incompleto nao entra no formulario. */
function editorCompleto(campo: CampoEditor): boolean {
  return campo.chave.trim() !== '' && campo.titulo.trim() !== '';
}

function tipoParaSchema(tipo: TipoDeCampo): {
  type: AnamnesisProperty['type'];
  format: NonNullable<AnamnesisProperty['format']> | undefined;
} {
  if (tipo === 'textarea') return { type: 'string', format: 'textarea' };
  if (tipo === 'date') return { type: 'string', format: 'date' };
  return { type: tipo, format: undefined };
}

/* `format: 'text'` e o mesmo que `type: 'string'` na tela: so `textarea` e `date`
   viram tipos proprios porque mudam o controle que o cliente ve. */
function tipoDaDefinicao(definicao: AnamnesisProperty | undefined): TipoDeCampo {
  const tipo = definicao?.format ?? definicao?.type ?? 'string';
  return tipo === 'text' ? 'string' : tipo;
}

function opcoesDe(texto: string): string[] {
  return texto
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha !== '');
}

/**
 * Converte os campos editados no contrato que a API valida.
 *
 * A ordem vem da ordem das linhas da tela e nao de `Object.keys`: o `jsonb`
 * do Postgres nao preserva a ordem das chaves, e sem `order` explicito o
 * formulario sairia ordenado alfabeticamente para o cliente responder.
 */
function montarFormulario(campos: CampoEditor[]): AnamnesisForm {
  const order: string[] = [];
  const required: string[] = [];
  const properties: AnamnesisForm['properties'] = {};

  for (const campo of campos) {
    if (!editorCompleto(campo)) continue;

    const chave = campo.chave.trim();
    if (order.includes(chave)) continue;

    const { type, format } = tipoParaSchema(campo.tipo);
    const opcoes = opcoesDe(campo.opcoes);

    order.push(chave);
    if (campo.obrigatorio) required.push(chave);

    properties[chave] = {
      type,
      title: campo.titulo.trim(),
      ...(format === undefined ? {} : { format }),
      // `enum` para texto e `enum` para lista: o mesmo conjunto de opcoes, e o
      // `type` decide se o portal abre um select ou um grupo de caixas.
      ...(opcoes.length > 0 ? { enum: opcoes } : {}),
    };
  }

  return { type: 'object', order, required, properties };
}

function semCamposCompletos(campos: CampoEditor[]): boolean {
  return campos.some(editorCompleto) === false;
}

export function FormulariosPage() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [incluirInativos, setIncluirInativos] = useState(false);
  const [editando, setEditando] = useState<AnamnesisTemplate | null>(null);
  const [criando, setCriando] = useState(false);
  const [novoFormulario, setNovoFormulario] = useState<AnamnesisTemplate | null>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: [...chavesProntuario.templates, incluirInativos],
    queryFn: () => listarTemplates(incluirInativos),
  });

  const alternarAtivo = useMutation({
    mutationFn: (template: AnamnesisTemplate) =>
      atualizarTemplate(template.id, { isActive: !template.isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.templates });
    },
  });

  const templates = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Formularios de anamnese"
        descricao="O que o cliente responde antes da primeira sessao. Alterar o formulario cria uma versao nova."
        acoes={
          podeEscrever ? <Button onClick={() => setCriando(true)}>Novo formulario</Button> : null
        }
      />

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <CheckboxField
            label="Mostrar inativos"
            checked={incluirInativos}
            onChange={(evento) => setIncluirInativos(evento.target.checked)}
          />
        </div>

        {isPending ? (
          <Carregando />
        ) : isError ? (
          <CaixaErro mensagem="Nao foi possivel carregar os formularios." />
        ) : templates.length === 0 ? (
          <EstadoVazio mensagem="Nenhum formulario cadastrado ainda." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="py-2">Formulario</th>
                  <th className="py-2">Versao</th>
                  <th className="py-2">Campos</th>
                  <th className="py-2">Terapias</th>
                  <th className="py-2">Situacao</th>
                  <th className="py-2 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id} className="border-t border-slate-100 align-top">
                    <td className="py-2">
                      <span className="font-medium text-slate-800">{template.name}</span>
                      {template.isDefault ? (
                        <Badge tone="brand" className="ml-2">
                          Padrao
                        </Badge>
                      ) : null}
                      {template.description !== null ? (
                        <span className="mt-1 block max-w-md text-xs text-slate-500">
                          {template.description}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-slate-600">
                      v{template.version}
                      <span className="mt-1 block text-xs text-slate-400">
                        {formatarData(template.createdAt.slice(0, 10))}
                      </span>
                    </td>
                    <td className="py-2 text-slate-600">{template.schema.order.length}</td>
                    <td className="py-2 text-slate-600">
                      {template.therapyIds.length === 0
                        ? 'Todas'
                        : `${template.therapyIds.length} vinculada(s)`}
                    </td>
                    <td className="py-2">
                      <Badge tone={template.isActive ? 'success' : 'neutral'}>
                        {template.isActive ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {podeEscrever ? (
                        <>
                          <Button
                            variante="fantasma"
                            tamanho="sm"
                            onClick={() => setNovoFormulario(template)}
                          >
                            Nova versao
                          </Button>
                          <Button
                            variante="fantasma"
                            tamanho="sm"
                            onClick={() => setEditando(template)}
                          >
                            Editar
                          </Button>
                          <Button
                            variante="fantasma"
                            tamanho="sm"
                            disabled={alternarAtivo.isPending}
                            onClick={() => alternarAtivo.mutate(template)}
                          >
                            {template.isActive ? 'Desativar' : 'Ativar'}
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

      <Modal aberto={criando} titulo="Novo formulario" onFechar={() => setCriando(false)}>
        <EditorFormulario
          onConcluir={() => setCriando(false)}
          inicial={{ nome: '', descricao: '', campos: [campoVazio()], padrao: false, terapias: [] }}
        />
      </Modal>

      <Modal
        aberto={novoFormulario !== null}
        titulo="Nova versao do formulario"
        onFechar={() => setNovoFormulario(null)}
      >
        {novoFormulario !== null ? (
          <EditorFormulario
            template={novoFormulario}
            onConcluir={() => setNovoFormulario(null)}
            inicial={{
              nome: novoFormulario.name,
              descricao: novoFormulario.description ?? '',
              // Vinculos e marca de padrao sao copiados pelo backend na versao
              // nova; a tela so carrega para mostrar o que ja estava valendo.
              padrao: novoFormulario.isDefault,
              terapias: novoFormulario.therapyIds,
              campos: novoFormulario.schema.order.map((chave) => {
                const definicao = novoFormulario.schema.properties[chave];
                const tipo = tipoDaDefinicao(definicao);
                return {
                  chave,
                  titulo: definicao?.title ?? chave,
                  tipo: TIPOS.some((item) => item.valor === tipo) ? tipo : 'string',
                  obrigatorio: novoFormulario.schema.required.includes(chave),
                  opcoes: (definicao?.enum ?? []).join('\n'),
                };
              }),
            }}
          />
        ) : null}
      </Modal>

      <Modal
        aberto={editando !== null}
        titulo="Editar formulario"
        onFechar={() => setEditando(null)}
      >
        <EditorFormulario
          template={editando ?? undefined}
          soMetadados
          onConcluir={() => setEditando(null)}
          inicial={{
            nome: editando?.name ?? '',
            descricao: editando?.description ?? '',
            padrao: editando?.isDefault ?? false,
            terapias: editando?.therapyIds ?? [],
            campos: [],
          }}
        />
      </Modal>
    </div>
  );
}

interface Inicial {
  nome: string;
  descricao: string;
  campos: CampoEditor[];
  padrao: boolean;
  terapias: string[];
}

/**
 * Criar formulario (com campos) e criar nova versao (com campos) compartilham
 * este editor. `soMetadados` cobre o PATCH, que nao aceita `schema`: mexer no
 * formulario por PATCH quebraria as anamneses ja respondidas.
 */
function EditorFormulario({
  template,
  inicial,
  soMetadados = false,
  onConcluir,
}: {
  template?: AnamnesisTemplate;
  inicial: Inicial;
  soMetadados?: boolean;
  onConcluir: () => void;
}) {
  const queryClient = useQueryClient();

  const [nome, setNome] = useState(inicial.nome);
  const [descricao, setDescricao] = useState(inicial.descricao);
  const [campos, setCampos] = useState<CampoEditor[]>(inicial.campos);
  const [padrao, setPadrao] = useState(inicial.padrao);
  const [terapias, setTerapias] = useState<string[]>(inicial.terapias);

  // So a criacao aceita vinculo e marca de padrao; na versao nova o backend
  // copia os dois da versao atual, e o PATCH so mexe em nome e descricao.
  const podeVincular = !soMetadados && template === undefined;

  const catalogoTerapias = useQuery({
    queryKey: ['terapias', 'formularios'],
    queryFn: () => listarTerapias({}),
    enabled: podeVincular,
  });

  const salvar = useMutation({
    mutationFn: () => {
      if (soMetadados) {
        return atualizarTemplate(template?.id ?? '', {
          name: nome,
          description: descricao,
        });
      }

      const schema = montarFormulario(campos);
      if (template === undefined) {
        return criarTemplate({
          name: nome,
          description: descricao,
          schema,
          isDefault: padrao,
          therapyIds: terapias,
        });
      }

      return novaVersaoTemplate(template.id, { schema, name: nome });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chavesProntuario.templates });
      onConcluir();
    },
  });

  function alternarTerapia(therapyId: string): void {
    setTerapias((atuais) =>
      atuais.includes(therapyId) ? atuais.filter((id) => id !== therapyId) : [...atuais, therapyId],
    );
  }

  function alterar(indice: number, mudanca: Partial<CampoEditor>): void {
    setCampos((atuais) =>
      atuais.map((campo, posicao) => (posicao === indice ? { ...campo, ...mudanca } : campo)),
    );
  }

  const faltandoChave = !soMetadados && semCamposCompletos(campos);
  const erro = salvar.isError ? mensagemDeErro(salvar.error) : null;

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
          label="Nome"
          required
          maxLength={120}
          value={nome}
          onChange={(evento) => setNome(evento.target.value)}
        />
        <TextField
          label="Descricao"
          maxLength={600}
          value={descricao}
          onChange={(evento) => setDescricao(evento.target.value)}
        />
      </div>

      {soMetadados ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Nome e descricao nao quebram anamneses ja respondidas. Para mudar os campos use &quot;Nova
          versao&quot;.
        </p>
      ) : null}

      {podeVincular ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-slate-800">Onde se aplica</legend>
          <p className="text-xs text-slate-500">
            Sem marcar terapia, o formulario vale para todas. Marcando, ele e o que o cliente
            responde ao agendar aquela terapia.
          </p>
          <CheckboxField
            label="Usar como formulario padrao da clinica"
            checked={padrao}
            onChange={(evento) => setPadrao(evento.target.checked)}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {(catalogoTerapias.data?.items ?? []).map((terapia) => (
              <CheckboxField
                key={terapia.id}
                label={terapia.name}
                checked={terapias.includes(terapia.id)}
                onChange={() => alternarTerapia(terapia.id)}
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      {soMetadados ? null : (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-800">Campos</legend>

          {campos.map((campo, indice) => (
            <div key={indice} className="rounded-md border border-slate-200 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Pergunta"
                  maxLength={160}
                  placeholder="Onde dói?"
                  value={campo.titulo}
                  onChange={(evento) => alterar(indice, { titulo: evento.target.value })}
                />
                <TextField
                  label="Chave"
                  hint="snake_case em minusculas, sem acento"
                  placeholder="dor_principal"
                  value={campo.chave}
                  onChange={(evento) => alterar(indice, { chave: evento.target.value })}
                />
                <SelectField
                  label="Tipo"
                  value={campo.tipo}
                  onChange={(evento) =>
                    alterar(indice, { tipo: evento.target.value as TipoDeCampo })
                  }
                >
                  {TIPOS.map((item) => (
                    <option key={item.valor} value={item.valor}>
                      {item.rotulo}
                    </option>
                  ))}
                </SelectField>
                <CheckboxField
                  label="Obrigatorio"
                  checked={campo.obrigatorio}
                  onChange={(evento) => alterar(indice, { obrigatorio: evento.target.checked })}
                />
              </div>

              {campo.tipo === 'string' || campo.tipo === 'array' || campo.tipo === 'textarea' ? (
                <TextareaField
                  label="Opcoes"
                  hint="Uma por linha. Vazio deixa o campo livre."
                  className="mt-3"
                  value={campo.opcoes}
                  onChange={(evento) => alterar(indice, { opcoes: evento.target.value })}
                />
              ) : null}

              {campos.length > 1 ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variante="perigo"
                    tamanho="sm"
                    onClick={() =>
                      setCampos((atuais) => atuais.filter((_, posicao) => posicao !== indice))
                    }
                  >
                    Remover campo
                  </Button>
                </div>
              ) : null}
            </div>
          ))}

          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variante="secundaria"
              onClick={() => setCampos((atuais) => [...atuais, campoVazio()])}
            >
              Adicionar campo
            </Button>
            {semCamposCompletos(campos) ? (
              <p className="self-center text-xs text-slate-400">Preencha pergunta e chave.</p>
            ) : null}
          </div>
        </fieldset>
      )}

      {faltandoChave ? <CaixaErro mensagem="Cada campo precisa de pergunta e chave." /> : null}
      {erro !== null ? <CaixaErro mensagem={erro} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvar.isPending || faltandoChave}>
          {salvar.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}
