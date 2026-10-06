import {
  type AnamnesisAnswers,
  type AnamnesisProperty,
  validarRespostasAnamnesis,
} from '@massoterapia/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField, TextareaField, TextField } from '@/components/ui/field';
import { CaixaErro, PageHeader, Panel } from '@/components/ui/panel';
import {
  abrirAnamnesePublica,
  chavesAnamnesePublica,
  enviarAnamnesePublica,
  salvarRascunhoPublico,
} from '@/lib/anamnesePublica';
import { ApiError } from '@/lib/api';

/**
 * Anamnese respondida pelo cliente a partir do link, sem login.
 *
 * Rota publica: fica fora de `RotaProtegida` porque o cliente nao tem sessao --
 * o token do link e a credencial. Por isso a tela nunca pede `clientId` e nunca
 * diz qual erro ocorreu no servidor: link inexistente, expirado e consumido
 * recebem a mesma mensagem, senao o link viraria um oraculo sobre o cadastro.
 */
export function AnamnesePublicaPage() {
  const { token } = useParams<{ token: string }>();

  const [respostas, setRespostas] = useState<AnamnesisAnswers>({});
  const [problemas, setProblemas] = useState<string[]>([]);
  const [assinado, setAssinado] = useState(false);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [enviadoEm, setEnviadoEm] = useState<string | null>(null);

  const formulario = useQuery({
    queryKey: chavesAnamnesePublica.formulario(token ?? ''),
    queryFn: () => abrirAnamnesePublica(token ?? ''),
    enabled: token !== undefined,
  });

  // O rascunho volta do servidor: quem fechou o link no celular continua de onde
  // parou. Sem isso, salvar e sair seria perder o preenchimento.
  useEffect(() => {
    const salvas = formulario.data?.answers;
    if (salvas !== undefined) setRespostas(salvas);
  }, [formulario.data]);

  const salvar = useMutation({
    mutationFn: () => salvarRascunhoPublico(token ?? '', respostas),
    onSuccess: () => setSalvoEm(new Date().toISOString()),
  });

  const enviar = useMutation({
    mutationFn: () => enviarAnamnesePublica(token ?? '', respostas, assinado),
    onSuccess: (resultado) => setEnviadoEm(resultado.submittedAt),
  });

  function alterar(chave: string, valor: AnamnesisAnswers[string]) {
    setRespostas((atuais) => ({ ...atuais, [chave]: valor }));
  }

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    if (formulario.data === undefined) return;

    // Mesma funcao que a API usa: a mensagem que o cliente ve antes do envio e
    // a que o profissional ve depois nao podem divergir.
    const achados = validarRespostasAnamnesis(formulario.data.schema, respostas);
    if (!assinado) achados.push('Confirme a declaracao de que as respostas sao verdadeiras.');
    setProblemas(achados);
    if (achados.length > 0) return;

    enviar.mutate();
  }

  if (enviadoEm !== null) {
    return (
      <Moldura>
        <PageHeader titulo="Anamnese enviada" descricao={formulario.data?.clinicName} />
        <Panel className="space-y-2 text-center">
          <p className="text-sm text-slate-600">
            {formulario.data?.clientFirstName}, sua anamnese foi enviada para revisao da clinica. Se
            faltar alguma informacao, a equipe entra em contato.
          </p>
          <p className="text-xs text-slate-400">Enviada em {rotuloInstante(enviadoEm)}</p>
        </Panel>
      </Moldura>
    );
  }

  if (token === undefined) return <LinkInvalido />;

  if (formulario.isPending) {
    return (
      <Moldura>
        <Panel>
          <p className="py-8 text-center text-sm text-slate-500">Carregando...</p>
        </Panel>
      </Moldura>
    );
  }

  if (formulario.isError) return <FalhaAoAbrir erro={formulario.error} />;

  const dados = formulario.data;
  if (dados === undefined) return null;

  return (
    <Moldura>
      <PageHeader
        titulo="Anamnese"
        descricao={[dados.clinicName, dados.templateName].filter(Boolean).join(' - ')}
      />
      <Panel className="space-y-5">
        <div className="space-y-1 border-b border-slate-100 pb-4">
          <h2 className="text-lg font-semibold text-slate-900">Ola, {dados.clientFirstName}</h2>
          {dados.templateDescription !== null ? (
            <p className="text-sm text-slate-600">{dados.templateDescription}</p>
          ) : null}
          <p className="text-xs text-slate-500">
            Leva alguns minutos. Voce pode salvar e voltar depois pelo mesmo link. Este link vale
            ate {rotuloInstante(dados.expiresAt)}.
          </p>
        </div>

        <form className="space-y-5" onSubmit={aoEnviar} noValidate>
          {dados.schema.order.map((chave) => {
            const definicao = dados.schema.properties[chave];
            if (definicao === undefined) return null;
            return (
              <Campo
                key={chave}
                definicao={definicao}
                obrigatorio={dados.schema.required.includes(chave)}
                valor={respostas[chave]}
                aoAlterar={(valor) => alterar(chave, valor)}
              />
            );
          })}

          <div className="space-y-2 border-t border-slate-100 pt-4">
            <CheckboxField
              label="Declaro que as informacoes acima sao verdadeiras."
              checked={assinado}
              onChange={(e) => setAssinado(e.target.checked)}
            />
            <p className="text-xs text-slate-400">
              A clinica usa esta anamnese para avaliar o atendimento. Em caso de duvida, a equipe
              entra em contato antes da sessao.
            </p>
          </div>

          {problemas.length > 0 ? <CaixaErro mensagem={problemas.join(' ')} /> : null}
          {enviar.isError ? <CaixaErro mensagem={mensagemDoEnvio(enviar.error)} /> : null}
          {salvar.isError ? (
            <CaixaErro mensagem="Nao foi possivel salvar o rascunho. O link continua valendo: tente de novo." />
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="text-xs text-slate-500">
              {salvar.isPending
                ? 'Salvando...'
                : salvoEm === null
                  ? 'Nada salvo ainda.'
                  : `Rascunho salvo em ${rotuloInstante(salvoEm)}`}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variante="secundaria"
                onClick={() => salvar.mutate()}
                disabled={salvar.isPending || enviar.isPending}
              >
                Salvar rascunho
              </Button>
              <Button type="submit" disabled={enviar.isPending || salvar.isPending}>
                {enviar.isPending ? 'Enviando...' : 'Enviar para a clinica'}
              </Button>
            </div>
          </div>
        </form>
      </Panel>
    </Moldura>
  );
}

/**
 * Um campo do formulario JSON Schema.
 *
 * `array` com `enum` e multi-escolha (checkbox por opcao); `string` com `enum` e
 * lista suspensa. `format` decide o controle: `date` e `textarea` mudam, o resto
 * e texto. `boolean` e o unico que nao e controlado por `TextField`.
 */
function Campo({
  definicao,
  obrigatorio,
  valor,
  aoAlterar,
}: {
  definicao: AnamnesisProperty;
  obrigatorio: boolean;
  valor: AnamnesisAnswers[string] | undefined;
  aoAlterar: (valor: AnamnesisAnswers[string]) => void;
}) {
  // O asterisco so informa; a obrigatoriedade real e validada por
  // `validarRespostasAnamnesis` no envio, com o mesmo texto da API.
  const rotulo = obrigatorio ? `${definicao.title} *` : definicao.title;
  const dica = definicao.description;

  if (definicao.type === 'boolean') {
    return (
      <CheckboxField
        label={rotulo}
        checked={valor === true}
        onChange={(e) => aoAlterar(e.target.checked)}
      />
    );
  }

  if (definicao.type === 'array' && definicao.enum !== undefined) {
    const selecionadas = Array.isArray(valor) ? valor : [];
    return (
      <fieldset className="space-y-2">
        <legend className="block text-sm font-medium text-slate-700">{rotulo}</legend>
        {dica !== undefined ? <p className="text-xs text-slate-400">{dica}</p> : null}
        <div className="space-y-1.5">
          {definicao.enum.map((opcao) => (
            <CheckboxField
              key={opcao}
              label={opcao}
              checked={selecionadas.includes(opcao)}
              onChange={(e) => aoAlterar(alternarLista(selecionadas, opcao, e.target.checked))}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  if (definicao.type === 'string' && definicao.enum !== undefined) {
    return (
      <SelectField
        label={rotulo}
        hint={dica}
        value={typeof valor === 'string' ? valor : ''}
        onChange={(e) => aoAlterar(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">Selecione...</option>
        {definicao.enum.map((opcao) => (
          <option key={opcao} value={opcao}>
            {opcao}
          </option>
        ))}
      </SelectField>
    );
  }

  if (definicao.type === 'number' || definicao.type === 'integer') {
    return (
      <TextField
        label={rotulo}
        hint={dica}
        type="number"
        inputMode="numeric"
        step={definicao.type === 'integer' ? 1 : 'any'}
        min={definicao.min}
        max={definicao.max}
        value={typeof valor === 'number' ? String(valor) : ''}
        onChange={(e) => aoAlterar(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  }

  if (definicao.format === 'textarea' || (definicao.maxLength ?? 0) > 200) {
    return (
      <TextareaField
        label={rotulo}
        hint={dica}
        maxLength={definicao.maxLength}
        value={typeof valor === 'string' ? valor : ''}
        onChange={(e) => aoAlterar(e.target.value)}
      />
    );
  }

  return (
    <TextField
      label={rotulo}
      hint={dica}
      type={definicao.format === 'date' ? 'date' : 'text'}
      maxLength={definicao.maxLength}
      value={typeof valor === 'string' ? valor : ''}
      onChange={(e) => aoAlterar(e.target.value)}
    />
  );
}

function alternarLista(atuais: string[], valor: string, marcado: boolean): string[] {
  return marcado ? [...atuais, valor] : atuais.filter((item) => item !== valor);
}

function LinkInvalido() {
  return (
    <Moldura>
      <PageHeader titulo="Anamnese" />
      <Panel className="space-y-2 text-center">
        <p className="text-sm text-slate-600">
          Este link de anamnese nao existe, expirou ou ja foi utilizado.
        </p>
        <p className="text-sm text-slate-600">
          Cada link vale para um unico envio. Peca um novo link a clinica para responder novamente.
        </p>
      </Panel>
    </Moldura>
  );
}

/**
 * Erro abrindo o link.
 *
 * So o status muda o texto: 404/409 e "link ruim" (nao adianta repetir), 429 e
 * limite de tentativas (demora um pouco), o resto e falha de rede ou servidor
 * (vale tentar de novo).
 */
function FalhaAoAbrir({ erro }: { erro: Error }) {
  const status = erro instanceof ApiError ? erro.status : 0;
  const linkRuim = status === 404 || status === 409;
  const limite = status === 429;

  return (
    <Moldura>
      <PageHeader titulo="Anamnese" />
      <Panel className="space-y-3 text-center">
        <p className="text-sm text-slate-600">
          {linkRuim
            ? 'Este link de anamnese nao existe, expirou ou ja foi utilizado. Peca um novo link a clinica.'
            : limite
              ? 'Muitas tentativas em pouco tempo. Aguarde um minuto e abra o link de novo.'
              : 'Nao foi possivel carregar o formulario. Verifique a conexao e tente novamente.'}
        </p>
        {linkRuim ? null : (
          <div className="flex justify-center">
            <Button type="button" variante="secundaria" onClick={() => window.location.reload()}>
              Tentar novamente
            </Button>
          </div>
        )}
      </Panel>
    </Moldura>
  );
}

/**
 * Erro no envio. 409 e a corrida de dois envios do mesmo link: o primeiro
 * venceu e o rascunho ja virou anamnese, entao a mensagem diz isso em vez de
 * sugerir "tente de novo" -- tentar de novo nao muda nada.
 */
function mensagemDoEnvio(erro: Error): string {
  if (erro instanceof ApiError && erro.status === 422) return erro.message;
  if (erro instanceof ApiError && erro.status === 409) {
    return 'Esta anamnese ja foi enviada. Voce pode fechar esta pagina.';
  }
  if (erro instanceof ApiError && erro.status === 429) {
    return 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.';
  }
  if (erro instanceof ApiError && (erro.status === 404 || erro.status === 0)) {
    return 'Este link de anamnese nao existe, expirou ou ja foi utilizado.';
  }
  return 'Nao foi possivel enviar agora. Salve o rascunho e tente novamente em alguns instantes.';
}

function Moldura({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">{children}</div>
    </main>
  );
}

/** Instante ISO no fuso do navegador, mesmo formato do portal de agendamento. */
function rotuloInstante(valor: string): string {
  return new Date(valor).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
