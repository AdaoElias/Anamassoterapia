import type { Client, ClientCreate } from '@massoterapia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField, TextareaField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { CaixaErro, Carregando, EstadoVazio, PageHeader, Panel } from '@/components/ui/panel';
import {
  atualizarCliente,
  criarCliente,
  desativarCliente,
  listarClientes,
  mensagemDeErro,
} from '@/lib/cadastros';
import { formatarCpf, formatarData, formatarTelefone } from '@/lib/format';

export function ClientesPage() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [busca, setBusca] = useState('');
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [editando, setEditando] = useState<Client | null>(null);
  const [criando, setCriando] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ['clientes', busca, incluirInativos],
    queryFn: () => listarClientes({ search: busca, includeInactive: incluirInativos }),
  });

  const desativar = useMutation({
    mutationFn: (id: string) => desativarCliente(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clientes'] });
    },
  });

  function fechar(): void {
    setEditando(null);
    setCriando(false);
  }

  function confirmarDesativar(cliente: Client): void {
    if (window.confirm(`Desativar o cliente "${cliente.name}"?`)) {
      desativar.mutate(cliente.id);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Clientes"
        descricao="Cadastro, contato e dados de atendimento."
        acoes={
          podeEscrever ? <Button onClick={() => setCriando(true)}>Novo cliente</Button> : undefined
        }
      />

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full max-w-xs">
            <TextField
              label="Buscar"
              placeholder="Nome do cliente"
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
          <CaixaErro mensagem="Nao foi possivel carregar os clientes." />
        ) : data.items.length === 0 ? (
          <EstadoVazio mensagem="Nenhum cliente cadastrado." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="py-2">Nome</th>
                  <th className="py-2">Contato</th>
                  <th className="py-2">CPF</th>
                  <th className="py-2">Nascimento</th>
                  <th className="py-2">Cidade</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((cliente) => (
                  <tr key={cliente.id} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-800">
                      {cliente.name}
                      {cliente.marketingOptIn ? (
                        <Badge tone="brand" className="ml-2">
                          Marketing
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-2 text-slate-600">
                      {cliente.phone !== null ? (
                        <span className="block">{formatarTelefone(cliente.phone)}</span>
                      ) : null}
                      {cliente.email !== null ? (
                        <span className="block text-xs text-slate-400">{cliente.email}</span>
                      ) : null}
                    </td>
                    <td className="py-2 text-slate-600">{formatarCpf(cliente.cpf)}</td>
                    <td className="py-2 text-slate-600">{formatarData(cliente.birthDate)}</td>
                    <td className="py-2 text-slate-600">
                      {cliente.addressCity ?? '-'}
                      {cliente.addressState !== null ? `/${cliente.addressState}` : ''}
                    </td>
                    <td className="py-2">
                      <Badge tone={cliente.active ? 'success' : 'neutral'}>
                        {cliente.active ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {/* Ler o prontuario nao e privilegegio de ADMIN: e o que o
                          profissional faz antes de atender. */}
                      <Button
                        variante="fantasma"
                        tamanho="sm"
                        onClick={() => {
                          void navigate(`/clientes/${cliente.id}/prontuario`);
                        }}
                      >
                        Prontuario
                      </Button>
                      {podeEscrever ? (
                        <>
                          <Button
                            variante="fantasma"
                            tamanho="sm"
                            onClick={() => setEditando(cliente)}
                          >
                            Editar
                          </Button>
                          {cliente.active ? (
                            <Button
                              variante="fantasma"
                              tamanho="sm"
                              onClick={() => confirmarDesativar(cliente)}
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
        titulo={editando ? 'Editar cliente' : 'Novo cliente'}
        onFechar={fechar}
      >
        <FormularioCliente cliente={editando ?? undefined} onConcluir={fechar} />
      </Modal>
    </div>
  );
}

function FormularioCliente({ cliente, onConcluir }: { cliente?: Client; onConcluir: () => void }) {
  const queryClient = useQueryClient();

  const [nome, setNome] = useState(cliente?.name ?? '');
  const [email, setEmail] = useState(cliente?.email ?? '');
  const [telefone, setTelefone] = useState(cliente?.phone ?? '');
  const [cpf, setCpf] = useState(cliente?.cpf ?? '');
  const [nascimento, setNascimento] = useState(cliente?.birthDate ?? '');
  const [genero, setGenero] = useState(cliente?.gender ?? '');
  const [endereco, setEndereco] = useState(cliente?.addressLine1 ?? '');
  const [cidade, setCidade] = useState(cliente?.addressCity ?? '');
  const [uf, setUf] = useState(cliente?.addressState ?? '');
  const [cep, setCep] = useState(cliente?.addressZip ?? '');
  const [notas, setNotas] = useState(cliente?.notes ?? '');
  const [marketing, setMarketing] = useState(cliente?.marketingOptIn ?? false);
  const [ativo, setAtivo] = useState(cliente?.active ?? true);

  const salvar = useMutation({
    mutationFn: () => {
      const base = {
        name: nome,
        email,
        phone: telefone,
        cpf,
        birthDate: nascimento,
        gender: genero,
        addressLine1: endereco,
        addressCity: cidade,
        addressZip: cep,
        notes: notas,
        marketingOptIn: marketing,
        active: ativo,
      } satisfies Omit<ClientCreate, 'addressState'>;

      if (cliente) {
        return atualizarCliente(cliente.id, { ...base, addressState: uf });
      }
      return criarCliente(uf === '' ? base : { ...base, addressState: uf });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clientes'] });
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

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="E-mail"
          type="email"
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
        />
        <TextField label="CPF" value={cpf} onChange={(evento) => setCpf(evento.target.value)} />
        <TextField
          label="Nascimento"
          type="date"
          value={nascimento}
          onChange={(evento) => setNascimento(evento.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Genero"
          maxLength={40}
          value={genero}
          onChange={(evento) => setGenero(evento.target.value)}
        />
        <TextField label="CEP" value={cep} onChange={(evento) => setCep(evento.target.value)} />
      </div>

      <TextField
        label="Endereco"
        maxLength={160}
        value={endereco}
        onChange={(evento) => setEndereco(evento.target.value)}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Cidade"
          maxLength={80}
          value={cidade}
          onChange={(evento) => setCidade(evento.target.value)}
        />
        <TextField
          label="UF"
          maxLength={2}
          value={uf}
          onChange={(evento) => setUf(evento.target.value.toUpperCase())}
        />
      </div>

      <TextareaField
        label="Observacoes"
        maxLength={1000}
        value={notas}
        onChange={(evento) => setNotas(evento.target.value)}
      />

      <div className="flex flex-wrap gap-4">
        <CheckboxField
          label="Aceita receber comunicacoes"
          checked={marketing}
          onChange={(evento) => setMarketing(evento.target.checked)}
        />
        <CheckboxField
          label="Ativo"
          checked={ativo}
          onChange={(evento) => setAtivo(evento.target.checked)}
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
