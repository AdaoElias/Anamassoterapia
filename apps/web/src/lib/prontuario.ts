import type {
  AlertDecision,
  AlertDecisionInput,
  Anamnesis,
  AnamnesisCreate,
  AnamnesisDetail,
  AnamnesisDraft,
  AnamnesisInvite,
  AnamnesisInviteCreate,
  AnamnesisInviteListItem,
  AnamnesisReview,
  AnamnesisSubmit,
  AnamnesisTemplate,
  AnamnesisTemplateCreate,
  AnamnesisTemplateUpdate,
  AnamnesisTemplateVersion,
  ClientContraindication,
  ClientContraindicationCreate,
  ClientContraindicationResolve,
  Contraindication,
  ContraindicationAlert,
  ContraindicationCreate,
  ContraindicationUpdate,
  Prontuario,
  TherapyContraindicationLink,
  VinculoContraindication,
} from '@massoterapia/shared';

import { apiFetch } from './api';

/**
 * Prontuario, anamnese e contraindicacoes.
 *
 * Mesmo contrato de `notificacoes.ts`: os tipos vem do schema que a API
 * valida e a leitura e sempre da clinica do usuario logado. O `clientId` e o
 * `therapyId` que o usuario escolheu na tela entram na URL; a clinica nunca
 * entra -- se entrasse, o navegador poderia pedir o prontuario de outra
 * clinica trocando um parametro.
 */

export interface ListaDe<T> {
  items: T[];
}

export interface ListaDeAlertas {
  items: ContraindicationAlert[];
  total: number;
}

function querystring(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === undefined || valor === '') continue;
    search.set(chave, String(valor));
  }
  const texto = search.toString();
  return texto === '' ? '' : `?${texto}`;
}

/**
 * Raiz de todas as queries de prontuario. O prefixo casa com as sub-chaves
 * (`['prontuario', clientId]`, `['prontuario', clientId, 'condicoes']`), e
 * por isso `invalidateQueries({ queryKey: ['prontuario', clientId] })`
 * recarrega a tela inteira depois de salvar, sem listar cada query.
 */
export const chavesProntuario = {
  templates: ['prontuario', 'templates'] as const,
  contraindicacoes: ['prontuario', 'contraindicacoes'] as const,
  cliente: (clientId: string) => ['prontuario', clientId] as const,
  anamnese: (id: string) => ['prontuario', 'anamnese', id] as const,
  alertas: (decisao: AlertDecision) => ['prontuario', 'alertas', decisao] as const,
  convites: (clientId: string) => ['prontuario', clientId, 'convites'] as const,
};

// --- Formularios (templates de anamnese) ------------------------------

export function listarTemplates(includeInactive = false): Promise<ListaDe<AnamnesisTemplate>> {
  return apiFetch<ListaDe<AnamnesisTemplate>>(
    `/anamnesis/templates${querystring({ includeInactive })}`,
  );
}

export function criarTemplate(body: AnamnesisTemplateCreate): Promise<AnamnesisTemplate> {
  return apiFetch<AnamnesisTemplate>('/anamnesis/templates', { method: 'POST', body });
}

export function atualizarTemplate(
  id: string,
  body: AnamnesisTemplateUpdate,
): Promise<AnamnesisTemplate> {
  return apiFetch<AnamnesisTemplate>(`/anamnesis/templates/${id}`, { method: 'PATCH', body });
}

/** Mudar o formulario cria uma versao nova: as anamneses antigas seguem apontando. */
export function novaVersaoTemplate(
  id: string,
  body: AnamnesisTemplateVersion,
): Promise<AnamnesisTemplate> {
  return apiFetch<AnamnesisTemplate>(`/anamnesis/templates/${id}/versao`, { method: 'POST', body });
}

// --- Anamnese do cliente -----------------------------------------------

export function listarAnamnesesDoCliente(clientId: string): Promise<ListaDe<Anamnesis>> {
  return apiFetch<ListaDe<Anamnesis>>(`/anamnesis/clientes/${clientId}`);
}

/** Detalhe vem com as respostas ja decifradas: a API e quem guarda a chave. */
export function obterAnamnese(id: string): Promise<AnamnesisDetail> {
  return apiFetch<AnamnesisDetail>(`/anamnesis/${id}`);
}

export function registrarAnamnese(
  clientId: string,
  body: AnamnesisCreate,
): Promise<AnamnesisDetail> {
  return apiFetch<AnamnesisDetail>(`/anamnesis/clientes/${clientId}`, { method: 'POST', body });
}

export function salvarRascunho(id: string, body: AnamnesisDraft): Promise<AnamnesisDetail> {
  return apiFetch<AnamnesisDetail>(`/anamnesis/${id}/rascunho`, { method: 'PUT', body });
}

export function enviarAnamnese(id: string, body: AnamnesisSubmit): Promise<AnamnesisDetail> {
  return apiFetch<AnamnesisDetail>(`/anamnesis/${id}/enviar`, { method: 'POST', body });
}

export function revisarAnamnese(id: string, body: AnamnesisReview): Promise<AnamnesisDetail> {
  return apiFetch<AnamnesisDetail>(`/anamnesis/${id}/revisar`, { method: 'POST', body });
}

export function listarAnamnesesPendentes(limit = 25, offset = 0): Promise<ListaDe<Anamnesis>> {
  return apiFetch<ListaDe<Anamnesis>>(`/anamnesis/pendentes${querystring({ limit, offset })}`);
}

// --- Prontuario --------------------------------------------------------

export function obterProntuario(clientId: string): Promise<Prontuario> {
  return apiFetch<Prontuario>(`/prontuarios/${clientId}`);
}

// --- Condicoes de saude do cliente --------------------------------------

export function listarCondicoesDoCliente(
  clientId: string,
): Promise<ListaDe<ClientContraindication>> {
  return apiFetch<ListaDe<ClientContraindication>>(`/contraindications/clientes/${clientId}`);
}

export function registrarCondicao(
  clientId: string,
  body: ClientContraindicationCreate,
): Promise<ClientContraindication> {
  return apiFetch<ClientContraindication>(`/contraindications/clientes/${clientId}`, {
    method: 'POST',
    body,
  });
}

export function resolverCondicao(
  conditionId: string,
  body: ClientContraindicationResolve,
): Promise<ClientContraindication> {
  return apiFetch<ClientContraindication>(`/contraindications/condicoes/${conditionId}/resolver`, {
    method: 'POST',
    body,
  });
}

// --- Alertas de contraindicacao -----------------------------------------

export interface FiltroAlertas {
  decision?: AlertDecision | undefined;
  appointmentId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function listarAlertas(params: FiltroAlertas): Promise<ListaDeAlertas> {
  return apiFetch<ListaDeAlertas>(
    `/contraindications/alertas${querystring({
      decision: params.decision,
      appointmentId: params.appointmentId,
      limit: params.limit,
      offset: params.offset,
    })}`,
  );
}

export function decidirAlerta(
  id: string,
  body: AlertDecisionInput,
): Promise<ContraindicationAlert> {
  return apiFetch<{ alert: ContraindicationAlert }>(`/contraindications/alertas/${id}/decisao`, {
    method: 'POST',
    body,
  }).then((resposta) => resposta.alert);
}

// --- Catalogo de contraindicacoes ---------------------------------------

export function listarContraindicacoes(
  includeInactive = false,
): Promise<ListaDe<Contraindication>> {
  return apiFetch<ListaDe<Contraindication>>(
    `/contraindications${querystring({ includeInactive })}`,
  );
}

export function criarContraindicacao(body: ContraindicationCreate): Promise<Contraindication> {
  return apiFetch<Contraindication>('/contraindications', { method: 'POST', body });
}

export function atualizarContraindication(
  id: string,
  body: ContraindicationUpdate,
): Promise<Contraindication> {
  return apiFetch<Contraindication>(`/contraindications/${id}`, { method: 'PATCH', body });
}

/** Vincula ao catalogo. `severity` nulo herda a do catalogo. */
export function vincularContraindicacao(
  therapyId: string,
  body: TherapyContraindicationLink,
): Promise<VinculoContraindication> {
  return apiFetch<VinculoContraindication>(`/contraindications/terapias/${therapyId}`, {
    method: 'POST',
    body,
  });
}

export function desvincularContraindicacao(
  therapyId: string,
  contraindicationId: string,
): Promise<void> {
  return apiFetch<void>(`/contraindications/terapias/${therapyId}/${contraindicationId}`, {
    method: 'DELETE',
  });
}

// --- Convites para anamnese ---------------------------------------------

export function listarConvites(clientId: string): Promise<ListaDe<AnamnesisInviteListItem>> {
  return apiFetch<ListaDe<AnamnesisInviteListItem>>(`/anamnesis/clientes/${clientId}/convites`);
}

export function criarConvite(
  clientId: string,
  body: AnamnesisInviteCreate,
): Promise<AnamnesisInvite> {
  return apiFetch<AnamnesisInvite>(`/anamnesis/clientes/${clientId}/convites`, {
    method: 'POST',
    body,
  });
}
