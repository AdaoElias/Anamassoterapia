import type { Professional, ProfessionalCreate } from '@massoterapia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField, TextareaField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { CaixaErro, Carregando, EstadoVazio, PageHeader, Panel } from '@/components/ui/panel';
import {
  atualizarProfissional,
  criarProfissional,
  desativarProfissional,
  listarProfissionais,
  listarTerapias,
  mensagemDeErro,
} from '@/lib/cadastros';
import { formatarPercentual, formatarTelefone, paraNumero } from '@/lib/format';

export function ProfissionaisPage() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [busca, setBusca] = useState('');
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [editando, setEditando] = useState<Professional | null>(null);
  const [criando, setCriando] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ['profissionais', busca, incluirInativos],
    queryFn: () => listarProfissionais({ search: busca, includeInactive: incluirInativos }),
  });

  const desativar = useMutation({
    mutationFn: (id: string) => desativarProfissional(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profissionais'] });
    },
  });

  function fechar(): void {
    setEditando(null);
    setCriando(false);
  }

  function confirmarDesativar(profissional: Professional): void {
    if (window.confirm(`Desativar "${profissional.name}"?`)) {
      desativar.mutate(profissional.id);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Profissionais"
        descricao="Equipe da clinica e as terapias que cada um realiza."
        acoes={
          podeEscrever ? (
            <Button onClick={() => setCriando(true)}>Novo profissional</Button>
          ) : undefined
        }
      />

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full max-w-xs">
            <TextField
              label="Buscar"
              placeholder="Nome do profissional"
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
            />
          </div>
          <CheckboxField
            label="Mostrar inativos"
            checked={incluirInativos}
            onChange={(evento) => setIncluirInativos(evento.target.checked)}
          />
        </div>

        {isPending ? (
          <Carregando />
        ) : isError ? (
          <CaixaErro mensagem="Nao foi possivel carregar os profissionais." />
        ) : data.items.length === 0 ? (
          <EstadoVazio mensagem="Nenhum profissional cadastrado." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="py-2">Nome</th>
                  <th className="py-2">Contato</th>
                  <th className="py-2">Registro</th>
                  <th className="py-2">Comissao</th>
                  <th className="py-2">Terapias</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((profissional) => (
                  <tr key={profissional.id} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-800">{profissional.name}</td>
                    <td className="py-2 text-slate-600">
                      {profissional.phone !== null ? (
                        <span className="block">{formatarTelefone(profissional.phone)}</span>
                      ) : null}
                      {profissional.email !== null ? (
                        <span className="block text-xs text-slate-400">{profissional.email}</span>
                      ) : null}
                    </td>
                    <td className="py-2 text-slate-600">
                      {profissional.registrationNumber ?? '-'}
                      {profissional.registrationType !== null
                        ? ` / ${profissional.registrationType}`
                        : ''}
                    </td>
                    <td className="py-2 text-slate-600">
                      {formatarPercentual(profissional.defaultCommissionBasisPoints)}
                    </td>
                    <td className="py-2 text-slate-600">{profissional.therapyIds.length}</td>
                    <td className="py-2">
                      <Badge tone={profissional.active ? 'success' : 'neutral'}>
                        {profissional.active ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {podeEscrever ? (
                        <>
                          <Button
                            variante="fantasma"
                            tamanho="sm"
                            onClick={() => setEditando(profissional)}
                          >
                            Editar
                          </Button>
                          {profissional.active ? (
                            <Button
                              variante="fantasma"
                              tamanho="sm"
                              onClick={() => confirmarDesativar(profissional)}
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
        titulo={editando ? 'Editar profissional' : 'Novo profissional'}
        onFechar={fechar}
      >
        <FormularioProfissional profissional={editando ?? undefined} onConcluir={fechar} />
      </Modal>
    </div>
  );
}

function FormularioProfissional({
  profissional,
  onConcluir,
}: {
  profissional?: Professional;
  onConcluir: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: terapias } = useQuery({
    queryKey: ['terapias', 'form', false],
    queryFn: () => listarTerapias(),
  });

  const [nome, setNome] = useState(profissional?.name ?? '');
  const [email, setEmail] = useState(profissional?.email ?? '');
  const [telefone, setTelefone] = useState(profissional?.phone ?? '');
  const [registro, setRegistro] = useState(profissional?.registrationNumber ?? '');
  const [tipoRegistro, setTipoRegistro] = useState(profissional?.registrationType ?? '');
  const [bio, setBio] = useState(profissional?.bio ?? '');
  const [corAtiva, setCorAtiva] = useState(
    profissional?.color !== null && profissional?.color !== undefined,
  );
  const [cor, setCor] = useState(profissional?.color ?? '#14b8a6');
  const [comissao, setComissao] = useState(
    String((profissional?.defaultCommissionBasisPoints ?? 0) / 100),
  );
  const [ativo, setAtivo] = useState(profissional?.active ?? true);
  const [selecionadas, setSelecionadas] = useState<string[]>(profissional?.therapyIds ?? []);

  function alternarTerapia(id: string): void {
    setSelecionadas((atual) =>
      atual.includes(id) ? atual.filter((item) => item !== id) : [...atual, id],
    );
  }

  const salvar = useMutation({
    mutationFn: () => {
      const base = {
        name: nome,
        email,
        phone: telefone,
        registrationNumber: registro,
        registrationType: tipoRegistro,
        bio,
        defaultCommissionBasisPoints: Math.round((paraNumero(comissao) ?? 0) * 100),
        active: ativo,
        therapyIds: selecionadas,
      } satisfies Omit<ProfessionalCreate, 'color'>;

      if (profissional) {
        return atualizarProfissional(profissional.id, { ...base, color: corAtiva ? cor : '' });
      }
      return criarProfissional(corAtiva ? { ...base, color: cor } : base);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profissionais'] });
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
          label="Telefone"
          value={telefone}
          onChange={(evento) => setTelefone(evento.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="E-mail"
          type="email"
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
        />
        <TextField
          label="Comissao (%)"
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={comissao}
          onChange={(evento) => setComissao(evento.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Registro (CREFITO, etc.)"
          maxLength={40}
          value={registro}
          onChange={(evento) => setRegistro(evento.target.value)}
        />
        <TextField
          label="Tipo de registro"
          maxLength={20}
          value={tipoRegistro}
          onChange={(evento) => setTipoRegistro(evento.target.value)}
        />
      </div>

      <TextareaField
        label="Bio"
        maxLength={600}
        value={bio}
        onChange={(evento) => setBio(evento.target.value)}
      />

      <div className="flex flex-wrap items-center gap-4">
        <CheckboxField
          label="Cor no calendario"
          checked={corAtiva}
          onChange={(evento) => setCorAtiva(evento.target.checked)}
        />
        {corAtiva ? (
          <input
            type="color"
            aria-label="Cor do profissional"
            value={cor}
            onChange={(evento) => setCor(evento.target.value)}
            className="h-8 w-12 rounded border border-slate-300"
          />
        ) : null}
      </div>

      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Terapias habilitadas</legend>
        {terapias && terapias.items.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {terapias.items.map((terapia) => (
              <CheckboxField
                key={terapia.id}
                label={terapia.name}
                checked={selecionadas.includes(terapia.id)}
                onChange={() => alternarTerapia(terapia.id)}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Cadastre terapias para vincula-las aqui.</p>
        )}
      </fieldset>

      <CheckboxField
        label="Ativo"
        checked={ativo}
        onChange={(evento) => setAtivo(evento.target.checked)}
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
