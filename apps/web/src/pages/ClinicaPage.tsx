import type { Clinic, ClinicUpdate, Room } from '@massoterapia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField, TextareaField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { CaixaErro, Carregando, EstadoVazio, PageHeader, Panel } from '@/components/ui/panel';
import {
  atualizarClinica,
  atualizarSala,
  criarSala,
  desativarSala,
  listarSalas,
  mensagemDeErro,
  obterClinica,
} from '@/lib/cadastros';

export function ClinicaPage() {
  const { estado } = useAuth();
  const podeEscrever = estado.status === 'autenticado' && estado.perfil.role === 'ADMIN';

  const {
    data: clinica,
    isPending,
    isError,
  } = useQuery({
    queryKey: ['clinica'],
    queryFn: obterClinica,
  });

  return (
    <div className="space-y-6">
      <PageHeader titulo="Clinica" descricao="Perfil da unidade e salas de atendimento." />

      {isPending ? (
        <Panel>
          <Carregando />
        </Panel>
      ) : isError || !clinica ? (
        <Panel>
          <CaixaErro mensagem="Nao foi possivel carregar os dados da clinica." />
        </Panel>
      ) : (
        <FormularioClinica clinica={clinica} podeEscrever={podeEscrever} />
      )}

      <PainelSalas podeEscrever={podeEscrever} />
    </div>
  );
}

function FormularioClinica({ clinica, podeEscrever }: { clinica: Clinic; podeEscrever: boolean }) {
  const queryClient = useQueryClient();

  const [nome, setNome] = useState(clinica.name);
  const [razao, setRazao] = useState(clinica.legalName ?? '');
  const [cnpj, setCnpj] = useState(clinica.cnpj ?? '');
  const [email, setEmail] = useState(clinica.email ?? '');
  const [telefone, setTelefone] = useState(clinica.phone ?? '');
  const [fuso, setFuso] = useState(clinica.timezone);
  const [endereco1, setEndereco1] = useState(clinica.addressLine1 ?? '');
  const [endereco2, setEndereco2] = useState(clinica.addressLine2 ?? '');
  const [cidade, setCidade] = useState(clinica.addressCity ?? '');
  const [uf, setUf] = useState(clinica.addressState ?? '');
  const [cep, setCep] = useState(clinica.addressZip ?? '');
  const [termos, setTermos] = useState(clinica.bookingTerms ?? '');

  const salvar = useMutation({
    mutationFn: () => {
      const base = {
        name: nome,
        legalName: razao,
        cnpj,
        email,
        phone: telefone,
        addressLine1: endereco1,
        addressLine2: endereco2,
        addressCity: cidade,
        addressState: uf,
        addressZip: cep,
        bookingTerms: termos,
      } satisfies Omit<ClinicUpdate, 'timezone'>;

      return atualizarClinica(fuso.trim() === '' ? base : { ...base, timezone: fuso });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clinica'] });
    },
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    salvar.mutate();
  }

  const disabled = !podeEscrever;

  return (
    <Panel>
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
        Perfil da clinica
      </h2>
      <form onSubmit={enviar} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Nome"
            required
            maxLength={120}
            disabled={disabled}
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
          />
          <TextField
            label="Razao social"
            maxLength={160}
            disabled={disabled}
            value={razao}
            onChange={(evento) => setRazao(evento.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="CNPJ"
            maxLength={14}
            disabled={disabled}
            value={cnpj}
            onChange={(evento) => setCnpj(evento.target.value)}
          />
          <TextField
            label="E-mail"
            type="email"
            disabled={disabled}
            value={email}
            onChange={(evento) => setEmail(evento.target.value)}
          />
          <TextField
            label="Telefone"
            disabled={disabled}
            value={telefone}
            onChange={(evento) => setTelefone(evento.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Endereco"
            maxLength={160}
            disabled={disabled}
            value={endereco1}
            onChange={(evento) => setEndereco1(evento.target.value)}
          />
          <TextField
            label="Complemento"
            maxLength={160}
            disabled={disabled}
            value={endereco2}
            onChange={(evento) => setEndereco2(evento.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <TextField
            label="Cidade"
            maxLength={80}
            disabled={disabled}
            value={cidade}
            onChange={(evento) => setCidade(evento.target.value)}
          />
          <TextField
            label="UF"
            maxLength={2}
            disabled={disabled}
            value={uf}
            onChange={(evento) => setUf(evento.target.value.toUpperCase())}
          />
          <TextField
            label="CEP"
            disabled={disabled}
            value={cep}
            onChange={(evento) => setCep(evento.target.value)}
          />
          <TextField
            label="Fuso horario"
            hint="Ex.: America/Sao_Paulo"
            maxLength={64}
            disabled={disabled}
            value={fuso}
            onChange={(evento) => setFuso(evento.target.value)}
          />
        </div>

        <TextareaField
          label="Termos de agendamento"
          maxLength={5000}
          disabled={disabled}
          value={termos}
          onChange={(evento) => setTermos(evento.target.value)}
        />

        {salvar.isError ? <CaixaErro mensagem={mensagemDeErro(salvar.error)} /> : null}
        {salvar.isSuccess ? <p className="text-sm text-emerald-700">Dados salvos.</p> : null}

        {podeEscrever ? (
          <div className="flex justify-end border-t border-slate-100 pt-4">
            <Button type="submit" disabled={salvar.isPending}>
              {salvar.isPending ? 'Salvando...' : 'Salvar perfil'}
            </Button>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

function PainelSalas({ podeEscrever }: { podeEscrever: boolean }) {
  const queryClient = useQueryClient();

  const [incluirInativas, setIncluirInativas] = useState(false);
  const [editando, setEditando] = useState<Room | null>(null);
  const [criando, setCriando] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ['salas', incluirInativas],
    queryFn: () => listarSalas({ includeInactive: incluirInativas }),
  });

  const desativar = useMutation({
    mutationFn: (id: string) => desativarSala(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['salas'] });
    },
  });

  function fechar(): void {
    setEditando(null);
    setCriando(false);
  }

  function confirmarDesativar(sala: Room): void {
    if (window.confirm(`Desativar a sala "${sala.name}"?`)) {
      desativar.mutate(sala.id);
    }
  }

  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Salas</h2>
        <div className="flex items-center gap-3">
          <CheckboxField
            label="Mostrar inativas"
            checked={incluirInativas}
            onChange={(evento) => setIncluirInativas(evento.target.checked)}
          />
          {podeEscrever ? <Button onClick={() => setCriando(true)}>Nova sala</Button> : null}
        </div>
      </div>

      {isPending ? (
        <Carregando />
      ) : isError ? (
        <CaixaErro mensagem="Nao foi possivel carregar as salas." />
      ) : data.items.length === 0 ? (
        <EstadoVazio mensagem="Nenhuma sala cadastrada." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.items.map((sala) => (
            <li key={sala.id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-800">{sala.name}</span>
                <Badge tone={sala.active ? 'success' : 'neutral'}>
                  {sala.active ? 'Ativa' : 'Inativa'}
                </Badge>
              </div>
              {podeEscrever ? (
                <div className="whitespace-nowrap">
                  <Button variante="fantasma" tamanho="sm" onClick={() => setEditando(sala)}>
                    Editar
                  </Button>
                  {sala.active ? (
                    <Button
                      variante="fantasma"
                      tamanho="sm"
                      onClick={() => confirmarDesativar(sala)}
                    >
                      Desativar
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Modal
        aberto={criando || editando !== null}
        titulo={editando ? 'Editar sala' : 'Nova sala'}
        onFechar={fechar}
      >
        <FormularioSala sala={editando ?? undefined} onConcluir={fechar} />
      </Modal>
    </Panel>
  );
}

function FormularioSala({ sala, onConcluir }: { sala?: Room; onConcluir: () => void }) {
  const queryClient = useQueryClient();

  const [nome, setNome] = useState(sala?.name ?? '');
  const [ativa, setAtiva] = useState(sala?.active ?? true);

  const salvar = useMutation({
    mutationFn: () => {
      if (sala) return atualizarSala(sala.id, { name: nome, active: ativa });
      return criarSala({ name: nome });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['salas'] });
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
        label="Nome da sala"
        required
        maxLength={80}
        value={nome}
        onChange={(evento) => setNome(evento.target.value)}
      />

      {sala ? (
        <CheckboxField
          label="Ativa"
          checked={ativa}
          onChange={(evento) => setAtiva(evento.target.checked)}
        />
      ) : null}

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
