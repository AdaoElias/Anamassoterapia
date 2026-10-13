import {
  type Membership,
  type MembershipInvite,
  type Role,
  ROLE_LABELS,
} from '@massoterapia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { CaixaErro, Carregando, EstadoVazio, PageHeader, Panel } from '@/components/ui/panel';
import { mensagemDeErro } from '@/lib/cadastros';
import { formatarTelefone } from '@/lib/format';
import {
  atualizarUsuario,
  convidarUsuario,
  desativarUsuario,
  listarUsuarios,
} from '@/lib/usuarios';

/** Papeis que podem ser concedidos pela tela: o cliente do portal nao faz login. */
const PAPEIS_DE_EQUIPE: Role[] = ['ADMIN', 'PROFISSIONAL'];

export function UsuariosPage() {
  const queryClient = useQueryClient();

  const [busca, setBusca] = useState('');
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [convidando, setConvidando] = useState(false);
  const [editando, setEditando] = useState<Membership | null>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: ['usuarios', busca, incluirInativos],
    queryFn: () => listarUsuarios({ search: busca, includeInactive: incluirInativos }),
  });

  const desativar = useMutation({
    mutationFn: (id: string) => desativarUsuario(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['usuarios'] });
    },
  });

  function fechar(): void {
    setConvidando(false);
    setEditando(null);
  }

  function confirmarDesativar(membro: Membership): void {
    if (window.confirm(`Desativar o acesso de "${membro.name}"?`)) {
      desativar.mutate(membro.id);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Usuarios"
        descricao="Quem tem acesso a clinica e com qual papel. Convide a equipe e ajuste permissoes."
        acoes={<Button onClick={() => setConvidando(true)}>Convidar usuario</Button>}
      />

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full max-w-xs">
            <TextField
              label="Buscar"
              placeholder="Nome ou e-mail"
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
          <CaixaErro mensagem="Nao foi possivel carregar os usuarios." />
        ) : data.items.length === 0 ? (
          <EstadoVazio mensagem="Nenhum usuario nesta clinica ainda." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="py-2">Nome</th>
                  <th className="py-2">Contato</th>
                  <th className="py-2">Papel</th>
                  <th className="py-2">Funcao</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((membro) => (
                  <tr key={membro.id} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-800">{membro.name}</td>
                    <td className="py-2 text-slate-600">
                      <span className="block">{membro.email}</span>
                      {membro.phone !== null ? (
                        <span className="block text-xs text-slate-400">
                          {formatarTelefone(membro.phone)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-slate-600">{ROLE_LABELS[membro.role]}</td>
                    <td className="py-2 text-slate-600">{membro.jobTitle ?? '-'}</td>
                    <td className="py-2">
                      {!membro.active ? (
                        <Badge tone="neutral">Inativo</Badge>
                      ) : membro.lastLoginAt === null ? (
                        <Badge tone="warning">Convite pendente</Badge>
                      ) : (
                        <Badge tone="success">Ativo</Badge>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button variante="fantasma" tamanho="sm" onClick={() => setEditando(membro)}>
                        Editar
                      </Button>
                      {membro.active ? (
                        <Button
                          variante="fantasma"
                          tamanho="sm"
                          onClick={() => confirmarDesativar(membro)}
                        >
                          Desativar
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal aberto={convidando} titulo="Convidar usuario" onFechar={fechar}>
        <FormularioConvite onConcluir={fechar} />
      </Modal>

      <Modal aberto={editando !== null} titulo="Editar usuario" onFechar={fechar}>
        {editando !== null ? <FormularioEdicao membro={editando} onConcluir={fechar} /> : null}
      </Modal>
    </div>
  );
}

function FormularioConvite({ onConcluir }: { onConcluir: () => void }) {
  const queryClient = useQueryClient();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<MembershipInvite['role']>('PROFISSIONAL');
  const [funcao, setFuncao] = useState('');
  const [linkDoConvite, setLinkDoConvite] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const convidar = useMutation({
    mutationFn: (): Promise<{ inviteLink: string | null }> =>
      convidarUsuario({
        name: nome,
        email,
        role: papel,
        ...(funcao.trim() === '' ? {} : { jobTitle: funcao }),
      } satisfies MembershipInvite),
    onSuccess: (resultado) => {
      void queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      setLinkDoConvite(resultado.inviteLink);
    },
  });

  async function copiarLink(): Promise<void> {
    if (linkDoConvite === null) return;
    await navigator.clipboard.writeText(linkDoConvite);
    setCopiado(true);
  }

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    convidar.mutate();
  }

  if (convidar.isSuccess) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Convite criado. <strong className="font-semibold">{nome}</strong> ja pode entrar na
          clinica.
        </p>

        {linkDoConvite !== null ? (
          <div className="space-y-2 rounded-xl border border-brand-500/30 bg-brand-500/10 p-4">
            <p className="text-sm font-semibold text-brand-900">
              Envie este link para a pessoa definir a senha:
            </p>
            <p className="truncate rounded-lg bg-surface px-3 py-2 font-mono text-xs text-slate-600">
              {linkDoConvite}
            </p>
            <Button
              type="button"
              variante="secundaria"
              tamanho="sm"
              onClick={() => void copiarLink()}
            >
              {copiado ? 'Copiado' : 'Copiar link'}
            </Button>
            <p className="text-xs text-slate-500">
              O envio automatico de e-mail ainda nao esta configurado; por isso o link aparece aqui.
              Ele vale por 7 dias.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            Enviamos um e-mail com o link para definir a senha. O convite vale por 7 dias.
          </p>
        )}

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <Button type="button" onClick={onConcluir}>
            Concluir
          </Button>
        </div>
      </div>
    );
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
          label="E-mail"
          type="email"
          required
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Papel"
          value={papel}
          onChange={(evento) => setPapel(evento.target.value as MembershipInvite['role'])}
        >
          {PAPEIS_DE_EQUIPE.map((opcao) => (
            <option key={opcao} value={opcao}>
              {ROLE_LABELS[opcao]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Funcao (opcional)"
          maxLength={80}
          placeholder="Ex.: Massoterapeuta"
          value={funcao}
          onChange={(evento) => setFuncao(evento.target.value)}
        />
      </div>

      {convidar.isError ? <CaixaErro mensagem={mensagemDeErro(convidar.error)} /> : null}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variante="secundaria" onClick={onConcluir}>
          Cancelar
        </Button>
        <Button type="submit" disabled={convidar.isPending}>
          {convidar.isPending ? 'Convidando...' : 'Convidar'}
        </Button>
      </div>
    </form>
  );
}

function FormularioEdicao({ membro, onConcluir }: { membro: Membership; onConcluir: () => void }) {
  const queryClient = useQueryClient();

  const [papel, setPapel] = useState<Role>(membro.role);
  const [funcao, setFuncao] = useState(membro.jobTitle ?? '');
  const [ativo, setAtivo] = useState(membro.active);

  const salvar = useMutation({
    mutationFn: () =>
      atualizarUsuario(membro.id, {
        role: papel,
        active: ativo,
        jobTitle: funcao,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      onConcluir();
    },
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="space-y-1 rounded-xl bg-slate-50 px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">{membro.name}</p>
        <p className="text-xs text-slate-500">{membro.email}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Papel"
          value={papel}
          onChange={(evento) => setPapel(evento.target.value as Role)}
        >
          {PAPEIS_DE_EQUIPE.map((opcao) => (
            <option key={opcao} value={opcao}>
              {ROLE_LABELS[opcao]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Funcao (opcional)"
          maxLength={80}
          value={funcao}
          onChange={(evento) => setFuncao(evento.target.value)}
        />
      </div>

      <CheckboxField
        label="Acesso ativo"
        checked={ativo}
        onChange={(evento) => setAtivo(evento.target.checked)}
      />
      <p className="text-xs text-slate-400">
        Mudar o papel ou desativar derruba as sessoes abertas desta pessoa.
      </p>

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
