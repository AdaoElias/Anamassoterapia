/**
 * Seed de desenvolvimento.
 *
 * Cria uma clinica completa e coerente: pessoas, cardapio, disponibilidade,
 * agenda com historico, financeiro e um caso de contraindicacao para
 * exercitar o alerta. O objetivo e que `pnpm dev` ja suba com algo
 * navegavel e que os relatorios tenham o que somar.
 *
 * Idempotencia: toda escrita passa por `upsert` numa chave natural ou por
 * uma `idempotencyKey` estavel. Rodar duas vezes nao duplica linha nem
 * briga com a constraint de exclusao da agenda. As datas sao ancoradas na
 * segunda-feira da semana corrente, entao a semana gerada e sempre a mesma.
 *
 * Nunca roda em producao: `assertNotProduction`, no fim do arquivo.
 */

import {
  normalizeBrazilianPhone,
  normalizeCnpj,
  normalizeCpf,
  normalizeSearchText,
} from '@massoterapia/shared';

import { env } from '../src/config/env.js';
import type {
  Appointment,
  Client,
  Prisma,
  Professional,
  Therapy,
} from '../src/generated/prisma/client.js';
import { generateAnamnesisAnswers } from '../src/lib/anamnesis-crypto.js';
import { hashPassword } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';

// -------------------------------------------------------------------
// Configuracao
// -------------------------------------------------------------------

/** Senha unica de todos os usuarios de demonstracao. */
const DEMO_PASSWORD = 'Wave@2026';

const CLINIC_TIMEZONE = 'America/Sao_Paulo';

/**
 * Sao Paulo e UTC-3 fixo: o Brasil aboliu o horario de verao em 2019.
 * Fixo significa que a aritmetica de data do seed e correta sem
 * biblioteca de fuso -- e o seed nao precisa tratar um caso historico
 * que nao importa para um banco de demonstracao.
 */
const CLINIC_UTC_OFFSET_MINUTES = -180;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** Seg a sex. Os agendamentos abaixo usam apenas esses dias. */
const WEEKDAYS = [0, 1, 2, 3, 4] as const;

const NOW = new Date();
const THIS_YEAR = NOW.getUTCFullYear();
const THIS_MONTH = NOW.getUTCMonth();

/** Meia-noite local da proxima segunda-feira, em UTC. */
const ANCHOR = ((): Date => {
  const daysUntilMonday = (8 - NOW.getUTCDay()) % 7 || 7;
  const localMidnight = Date.UTC(THIS_YEAR, THIS_MONTH, NOW.getUTCDate() + daysUntilMonday);
  return new Date(localMidnight - CLINIC_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
})();

/**
 * "segunda 09:30 no fuso da clinica" -> instante UTC.
 *
 * `ANCHOR` ja e um instante: ele carrega o offset. Somar `10h` a ele
 * da 10:00 local, entao o offset nao entra de novo aqui -- se entrasse,
 * a sessao nasceria 3h depois e a agenda impressa nao bateria com a
 * disponibilidade declarada.
 */
function clinicLocalInstant(daysFromAnchor: number, hour: number, minute = 0): Date {
  return new Date(
    ANCHOR.getTime() + daysFromAnchor * MS_PER_DAY + (hour * 60 + minute) * MS_PER_MINUTE,
  );
}

/**
 * Coluna `@db.Date` guarda uma data, nao um instante. O meio-dia UTC
 * evita o off-by-one: `2026-01-01T00:00Z` em um servidor com fuso
 * negativo vira 31/12 no INSERT.
 */
function dateColumn(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0, 0));
}

function dateColumnOf(instant: Date): Date {
  return new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate(), 12),
  );
}

const brl = (cents: number): string => (cents / 100).toFixed(2);

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// -------------------------------------------------------------------
// Helpers de falha alta
//
// `noUncheckedIndexedAccess` esta ligado, e negacao silenciosa (`!`)
// transformaria um erro de seed em dado errado gravado no banco. Estas
// funcoes convertem "chave faltando" em erro nomeado, que e mais facil de
// depurar do que um undefined explodindo tres linhas depois.
// -------------------------------------------------------------------

function must<T>(map: ReadonlyMap<string, T>, key: string, what: string): T {
  const found = map.get(key);
  if (found === undefined) {
    throw new Error(`Seed: ${what} "${key}" nao foi criado.`);
  }
  return found;
}

function mustAt<T>(list: readonly T[], index: number, what: string): T {
  const found = list[index];
  if (found === undefined) {
    throw new Error(`Seed: ${what} na posicao ${index} nao existe (tamanho ${list.length}).`);
  }
  return found;
}

function requireCpf(value: string): string {
  const cpf = normalizeCpf(value);
  if (cpf === null) throw new Error(`Seed: CPF invalido "${value}".`);
  return cpf;
}

function requireCnpj(value: string): string {
  const cnpj = normalizeCnpj(value);
  if (cnpj === null) throw new Error(`Seed: CNPJ invalido "${value}".`);
  return cnpj;
}

function requirePhone(value: string): string {
  const phone = normalizeBrazilianPhone(value);
  if (phone === null) throw new Error(`Seed: telefone invalido "${value}".`);
  return phone;
}

function indexBy<T>(items: readonly T[], key: (item: T) => string, what: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    if (map.has(id)) throw new Error(`Seed: ${what} duplicado para a chave "${id}".`);
    map.set(id, item);
  }
  return map;
}

// -------------------------------------------------------------------
// Formularios de anamnese
//
// Um template padrao da clinica e dois especificos por terapia.
// Especifico por terapia e o padrao adotado: a pergunta "esta gestante?"
// muda a conduta na drenagem e nao muda no shiatsu. Um formulario unico
// com secoes condicionais trataria todo mundo igual e, pior, esconderia
// a pergunta que importa na hora certa.
// -------------------------------------------------------------------

const SCHEMA_GERAL: Prisma.InputJsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['objetivo', 'condicoes_saude', 'tratamentos_medicamentos', 'anticoagulantes'],
  properties: {
    objetivo: { type: 'string', title: 'O que voce busca com a sessao?', maxLength: 400 },
    condicoes_saude: {
      type: 'array',
      title: 'Condicoes de saude conhecidas',
      items: {
        type: 'string',
        enum: [
          'nenhuma',
          'gestacao',
          'hipertensao',
          'hipotensao',
          'diabetes',
          'trombose',
          'osteoporose',
          'epilepsia',
          'outra',
        ],
      },
    },
    tratamentos_medicamentos: {
      type: 'string',
      title: 'Usa medicamento ou tratamento continuo?',
      maxLength: 400,
    },
    anticoagulantes: { type: 'boolean', title: 'Usa anticoagulante (AAS, warfarin, heparina)?' },
    febre_ou_infeccao: {
      type: 'boolean',
      title: 'Tem febre, gripe ou lesao de pele na area a ser trabalhada?',
    },
    alergia: {
      type: 'string',
      title: 'Alergias conhecidas, incluindo a oleos e perfumes',
      maxLength: 200,
    },
    pressao_arterial: {
      type: 'string',
      title: 'Ultima medicao de pressao, se lembrar',
      maxLength: 60,
    },
    lesao_na_area: { type: 'boolean', title: 'Ha lesao, cicatriz ou cirurgia recente na area?' },
    preference_pressao: {
      type: 'string',
      enum: ['leve', 'moderada', 'firme', 'nao_sei'],
      title: 'Preferencia de pressao',
    },
    aceite_termo: { type: 'boolean', title: 'Aceita uso de calor na sessao?' },
  },
};

const SCHEMA_DRENAGEM: Prisma.InputJsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['gestacao', 'semanas_gestacao', 'inchaoco', 'cirurgias_recentes'],
  properties: {
    gestacao: { type: 'boolean', title: 'Esta gestante?' },
    semanas_gestacao: {
      type: 'integer',
      title: 'Quantas semanas de gestacao?',
      minimum: 0,
      maximum: 42,
    },
    em_amnias: { type: 'boolean', title: 'Primeira semana pos-operatorio?' },
    inchaoco: {
      type: 'array',
      title: 'Inchaço (edema) em que regioes?',
      items: {
        type: 'string',
        enum: ['membros_inferiores', 'membros_superiores', 'face', 'abdomem', 'geral'],
      },
    },
    cirugias_recentes: { type: 'boolean', title: 'Cirurgia ou procedimento no ultimo ano?' },
    historico_cancer: { type: 'boolean', title: 'Historia de cancer ou tratamento oncologico?' },
    alteracoes_sensibilidade: { type: 'boolean', title: 'Reducao de sensibilidade na pele?' },
    observacoes: { type: 'string', title: 'Observacoes', maxLength: 400 },
  },
};

const SCHEMA_QUIROPRAXIA: Prisma.InputJsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['dor_atual', 'atestado', 'cirurgia_coluna'],
  properties: {
    dor_atual: { type: 'string', title: 'Descreva a dor atual', maxLength: 400 },
    irradiacao: { type: 'boolean', title: 'A dor irradia para braco ou perna?' },
    areas: { type: 'string', title: 'Regioes do corpo envolvidas', maxLength: 200 },
    atestado: { type: 'boolean', title: 'Possui atestado medico liberando o atendimento?' },
    atestado_medico: { type: 'string', title: 'Nome do medico e CRM do atestado', maxLength: 160 },
    cirurgia_coluna: { type: 'boolean', title: 'Cirurgia na coluna?' },
    osteoporose: { type: 'boolean', title: 'Osteoporose diagnosticada?' },
    mareo: { type: 'boolean', title: 'Sente mareo com manipulacao cervical?' },
    observacoes: { type: 'string', title: 'Observacoes', maxLength: 400 },
  },
};

// -------------------------------------------------------------------
// Dados fixos
// -------------------------------------------------------------------

const PESSOAS = [
  {
    key: 'admin',
    email: 'admin@clinicawave.com.br',
    name: 'Ana Beatriz Rocha',
    role: 'ADMIN',
    jobTitle: 'Administradora',
  },
  {
    key: 'elaine',
    email: 'elaine@clinicawave.com.br',
    name: 'Elaine Cristina Menezes',
    role: 'PROFISSIONAL',
    jobTitle: 'Massoterapeuta',
  },
  {
    key: 'gustavo',
    email: 'gustavo@clinicawave.com.br',
    name: 'Gustavo Prado Lima',
    role: 'PROFISSIONAL',
    jobTitle: 'Fisioterapeuta',
  },
  {
    key: 'maria',
    email: 'maria.aparecida@email.com.br',
    name: 'Maria Aparecida Souza',
    role: 'CLIENTE',
    jobTitle: null,
  },
  {
    key: 'carlos',
    email: 'carlos.dias@email.com.br',
    name: 'Carlos Eduardo Dias',
    role: 'CLIENTE',
    jobTitle: null,
  },
  {
    key: 'juliana',
    email: 'juliana.ferreira@email.com.br',
    name: 'Juliana Ferreira Rocha',
    role: 'CLIENTE',
    jobTitle: null,
  },
] as const satisfies readonly {
  key: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'PROFISSIONAL' | 'CLIENTE';
  jobTitle: string | null;
}[];

type PessoaKey = (typeof PESSOAS)[number]['key'];
type ChaveProfissional = Extract<PessoaKey, 'elaine' | 'gustavo'>;
type StatusAnamnese = 'ENVIADA' | 'APROVADA';
/** Estados que um agendamento pode ter na trilha. */
type StatusAgendamento =
  'AGENDADO_PENDENTE' | 'CONFIRMADO' | 'EM_ATENDIMENTO' | 'CONCLUIDO' | 'CANCELADO' | 'NO_SHOW';
/** Estados finais: os que o seed atribui. `EM_ATENDIMENTO` so aparece como passo intermediario. */
type StatusFinal = Exclude<StatusAgendamento, 'EM_ATENDIMENTO'>;

type TerapiaSlug =
  | 'massagem-relaxante'
  | 'massagem-terapeutica'
  | 'drenagem-linfatica'
  | 'shiatsu'
  | 'quiropraxia'
  | 'auriculoterapia';

type TemplateKey = 'geral' | 'drenagem' | 'quiropraxia';

interface TerapiaSeed {
  readonly slug: TerapiaSlug;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly durationMinutes: number;
  readonly bufferMinutes: number;
  readonly priceCents: number;
  readonly color: string;
  readonly position: number;
  readonly requiresMedicalClearance?: boolean;
  /** Ausente = usa o template padrao da clinica. */
  readonly templateKey?: Exclude<TemplateKey, 'geral'>;
}

const TERAPIAS: readonly TerapiaSeed[] = [
  {
    slug: 'massagem-relaxante',
    name: 'Massagem Relaxante',
    category: 'Relaxamento',
    description: 'Movimentos longos e ritmo constante para reduzir tensao muscular.',
    durationMinutes: 60,
    bufferMinutes: 15,
    priceCents: 12_000,
    color: '#0e7490',
    position: 1,
  },
  {
    slug: 'massagem-terapeutica',
    name: 'Massagem Terapeutica',
    category: 'Terapia',
    description: 'Foco em dor muscular, postura e recuperacao de lesao.',
    durationMinutes: 60,
    bufferMinutes: 15,
    priceCents: 15_000,
    color: '#15803d',
    position: 2,
  },
  {
    slug: 'drenagem-linfatica',
    name: 'Drenagem Linfatica',
    category: 'Terapia',
    description: 'Mapeamento de vasos linfaticos e tecnicas de drenagem.',
    durationMinutes: 75,
    bufferMinutes: 15,
    priceCents: 18_000,
    color: '#7c3aed',
    position: 3,
    templateKey: 'drenagem',
  },
  {
    slug: 'shiatsu',
    name: 'Shiatsu',
    category: 'Terapeutica oriental',
    description: 'Pressao com dedos e palmas em pontos ao longo dos meridianos.',
    durationMinutes: 50,
    bufferMinutes: 10,
    priceCents: 13_000,
    color: '#b45309',
    position: 4,
  },
  {
    slug: 'quiropraxia',
    name: 'Quiropraxia',
    category: 'Manipulacao',
    description: 'Ajuste de coluna com indicacao e atestado medico.',
    durationMinutes: 45,
    bufferMinutes: 15,
    priceCents: 16_000,
    color: '#b91c1c',
    position: 5,
    requiresMedicalClearance: true,
    templateKey: 'quiropraxia',
  },
  {
    slug: 'auriculoterapia',
    name: 'Auriculoterapia',
    category: 'Terapeutica oriental',
    description: 'Estimulacao de pontos da orelha para dor cronica.',
    durationMinutes: 30,
    bufferMinutes: 10,
    priceCents: 8_000,
    color: '#0891b2',
    position: 6,
  },
];

const TEMPLATES = [
  {
    key: 'geral',
    name: 'Anamnese Geral',
    description: 'Aplicada quando a terapia nao tem formulario especifico.',
    schema: SCHEMA_GERAL,
    isDefault: true,
  },
  {
    key: 'drenagem',
    name: 'Anamnese Drenagem Linfatica',
    description: 'Foco em gestacao, edema e pos-operatorio.',
    schema: SCHEMA_DRENAGEM,
    isDefault: false,
  },
  {
    key: 'quiropraxia',
    name: 'Anamnese Quiropraxia',
    description: 'Exige atestado medico e investiga coluna e mareo.',
    schema: SCHEMA_QUIROPRAXIA,
    isDefault: false,
  },
] as const satisfies readonly {
  key: TemplateKey;
  name: string;
  description: string;
  schema: Prisma.InputJsonObject;
  isDefault: boolean;
}[];

const CONTRAINDICACOES = [
  {
    code: 'GESTACAO',
    title: 'Gestacao',
    severity: 'ALTA',
    requiresMedicalClearance: true,
    description: 'Drenagem profunda e contraindicada. Avaliar tecnica e pressao caso a caso.',
  },
  {
    code: 'TROMBOSE',
    title: 'Trombose ou trombose venosa profunda',
    severity: 'ALTA',
    requiresMedicalClearance: true,
    description: 'Risco de deslocamento de trombo.',
  },
  {
    code: 'OSTEOPOROSE',
    title: 'Osteoporose severa',
    severity: 'ALTA',
    requiresMedicalClearance: true,
    description: 'Pressao alta e manipulacao sao risco de fratura.',
  },
  {
    code: 'HIPOFRESSAO',
    title: 'Hipotensao arterial',
    severity: 'MEDIA',
    requiresMedicalClearance: false,
    description: null,
  },
  {
    code: 'FEBRE',
    title: 'Febre ou infeccao em curso',
    severity: 'MEDIA',
    requiresMedicalClearance: false,
    description: null,
  },
  {
    code: 'LESAO_CUTANEA',
    title: 'Lesao cutanea na area trabalhada',
    severity: 'BAIXA',
    requiresMedicalClearance: false,
    description: null,
  },
] as const satisfies readonly {
  code: string;
  title: string;
  severity: 'BAIXA' | 'MEDIA' | 'ALTA';
  requiresMedicalClearance: boolean;
  description: string | null;
}[];

interface ClienteSeed {
  readonly key: Extract<PessoaKey, 'maria' | 'carlos' | 'juliana'>;
  readonly phone: string;
  readonly cpf: string;
  readonly birthDate: Date;
  readonly notes: string | null;
}

const CLIENTES: readonly ClienteSeed[] = [
  {
    key: 'maria',
    phone: requirePhone('11991230001'),
    cpf: requireCpf('111.444.777-35'),
    birthDate: dateColumn(1985, 4, 12),
    notes: 'Prefere atendimento pela manha. Alergica a oleo de fragrancia.',
  },
  {
    key: 'carlos',
    phone: requirePhone('11991230002'),
    cpf: requireCpf('529.982.247-25'),
    birthDate: dateColumn(1978, 10, 3),
    notes: null,
  },
  {
    key: 'juliana',
    phone: requirePhone('11991230003'),
    cpf: requireCpf('390.533.447-05'),
    birthDate: dateColumn(1994, 6, 28),
    notes: 'Gestante. Acompanhada de perto em cada sessao.',
  },
];

interface AgendamentoSeed {
  /** Tambem e a idempotencyKey: estavel entre execucoes. */
  readonly key: string;
  readonly clientKey: ClienteSeed['key'];
  readonly professionalKey: ChaveProfissional;
  readonly therapySlug: TerapiaSlug;
  readonly roomIndex: number;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: StatusFinal;
  readonly source: 'PORTAL_CLIENTE' | 'ADMIN';
  readonly notes?: string;
  readonly sessionNotes?: string;
  readonly confirmedAt?: Date;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
  readonly cancellationReason?: 'CLIENTE_DESISTIU';
}

const AGENDAMENTOS: readonly AgendamentoSeed[] = [
  {
    key: 'seed:concluido',
    clientKey: 'maria',
    professionalKey: 'elaine',
    therapySlug: 'massagem-relaxante',
    roomIndex: 0,
    startAt: clinicLocalInstant(-7, 9, 30),
    endAt: clinicLocalInstant(-7, 10, 30),
    status: 'CONCLUIDO',
    source: 'ADMIN',
    sessionNotes: 'Tensao cervical liberada. Cliente relata melhora apos 3 sessoes.',
    confirmedAt: clinicLocalInstant(-7, 9),
    startedAt: clinicLocalInstant(-7, 9, 30),
    finishedAt: clinicLocalInstant(-7, 10, 30),
  },
  {
    key: 'seed:no-show',
    clientKey: 'carlos',
    professionalKey: 'gustavo',
    therapySlug: 'shiatsu',
    roomIndex: 1,
    startAt: clinicLocalInstant(-1, 14),
    endAt: clinicLocalInstant(-1, 14, 50),
    status: 'NO_SHOW',
    source: 'PORTAL_CLIENTE',
    notes: 'Avisou que talvez atrasasse. Nao chegou.',
  },
  {
    key: 'seed:cancelado',
    clientKey: 'carlos',
    professionalKey: 'elaine',
    therapySlug: 'massagem-relaxante',
    roomIndex: 0,
    startAt: clinicLocalInstant(-3, 11),
    endAt: clinicLocalInstant(-3, 12),
    status: 'CANCELADO',
    source: 'PORTAL_CLIENTE',
    notes: 'Desistiu por motivo de trabalho.',
    cancellationReason: 'CLIENTE_DESISTIU',
  },
  {
    key: 'seed:pendente',
    clientKey: 'carlos',
    professionalKey: 'elaine',
    therapySlug: 'shiatsu',
    roomIndex: 0,
    startAt: clinicLocalInstant(0, 10),
    endAt: clinicLocalInstant(0, 10, 50),
    status: 'AGENDADO_PENDENTE',
    source: 'PORTAL_CLIENTE',
    notes: 'Primeira vez na clinica. Quer shiatsu para dor no ombro.',
  },
  {
    key: 'seed:confirmado-terapeutica',
    clientKey: 'maria',
    professionalKey: 'elaine',
    therapySlug: 'massagem-terapeutica',
    roomIndex: 0,
    startAt: clinicLocalInstant(1, 15),
    endAt: clinicLocalInstant(1, 16),
    status: 'CONFIRMADO',
    source: 'PORTAL_CLIENTE',
    confirmedAt: clinicLocalInstant(0, 12),
  },
  {
    key: 'seed:confirmado-drenagem',
    clientKey: 'juliana',
    professionalKey: 'elaine',
    therapySlug: 'drenagem-linfatica',
    roomIndex: 0,
    startAt: clinicLocalInstant(3, 9),
    endAt: clinicLocalInstant(3, 10, 15),
    status: 'CONFIRMADO',
    source: 'PORTAL_CLIENTE',
    notes: 'Cliente ciente do alerta de contraindicacao; aguarda avaliacao.',
    confirmedAt: clinicLocalInstant(0, 12),
  },
];

/** Caminho de status ate cada estado final, para a trilha append-only. */
const TRILHA: Record<StatusFinal, readonly StatusAgendamento[]> = {
  AGENDADO_PENDENTE: ['AGENDADO_PENDENTE'],
  CONFIRMADO: ['AGENDADO_PENDENTE', 'CONFIRMADO'],
  CONCLUIDO: ['AGENDADO_PENDENTE', 'CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO'],
  CANCELADO: ['AGENDADO_PENDENTE', 'CANCELADO'],
  NO_SHOW: ['AGENDADO_PENDENTE', 'CONFIRMADO', 'NO_SHOW'],
};

/**
 * Quem faz o que. Uma terapia sem profissional nao aparece no link
 * publico, e o portal precisa de conteudo para o seed valer como
 * demonstracao.
 */
const HABILIDADES: Readonly<Record<ChaveProfissional, readonly TerapiaSlug[]>> = {
  elaine: [
    'massagem-relaxante',
    'massagem-terapeutica',
    'drenagem-linfatica',
    'shiatsu',
    'auriculoterapia',
  ],
  gustavo: ['quiropraxia', 'massagem-terapeutica', 'shiatsu'],
};

// -------------------------------------------------------------------
// Seed
// -------------------------------------------------------------------

async function seed(): Promise<void> {
  // `hashPassword` e o mesmo caminho de codigo que o login usa. O seed
  // gerar o hash por conta propria ja foi o jeito de o parametro de
  // Argon2 divergir entre os dois sem ninguem perceber.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  console.log('Semeando clinica de demonstracao...\n');

  // -----------------------------------------------------------------
  // 1. Clinica
  // -----------------------------------------------------------------
  const clinic = await prisma.clinic.upsert({
    where: { slug: 'clinica-wave' },
    update: { name: 'Clinica Wave' },
    create: {
      slug: 'clinica-wave',
      name: 'Clinica Wave',
      legalName: 'Clinica Wave Servicos de Massoterapia LTDA',
      cnpj: requireCnpj('11.222.333/0001-81'),
      email: 'contato@clinicawave.com.br',
      phone: requirePhone('11987650000'),
      timezone: CLINIC_TIMEZONE,
      addressLine1: 'Rua Harmonia, 123',
      addressLine2: 'Conj. 42',
      addressCity: 'Sao Paulo',
      addressState: 'SP',
      addressZip: '05435000',
      bookingTerms:
        'Chegue 10 minutos antes. Cancelamento sem 2 horas de antecedencia pode gerar cobranca. ' +
        'Avise sobre gestacao, hipertensao, trombose, febre, lesoes na pele e uso de anticoagulantes.',
    },
  });
  console.log(`  clinica          ${clinic.name} (/${clinic.slug})`);

  // -----------------------------------------------------------------
  // 2. Usuarios e papeis
  // -----------------------------------------------------------------
  const usuarios = new Map<PessoaKey, { id: string; email: string; name: string }>();
  for (const pessoa of PESSOAS) {
    const user = await prisma.user.upsert({
      where: { email: pessoa.email },
      update: { name: pessoa.name, passwordHash },
      create: { email: pessoa.email, name: pessoa.name, passwordHash },
    });
    usuarios.set(pessoa.key, user);
  }

  const admin = must(usuarios, 'admin', 'usuario');
  const mariaUser = must(usuarios, 'maria', 'usuario');

  for (const pessoa of PESSOAS) {
    const user = must(usuarios, pessoa.key, 'usuario');
    await prisma.clinicMembership.upsert({
      where: { clinicId_userId_role: { clinicId: clinic.id, userId: user.id, role: pessoa.role } },
      update: { jobTitle: pessoa.jobTitle },
      create: {
        clinicId: clinic.id,
        userId: user.id,
        role: pessoa.role,
        jobTitle: pessoa.jobTitle,
      },
    });
  }
  console.log(`  usuarios         ${usuarios.size} (senha unica: ${DEMO_PASSWORD})`);

  // -----------------------------------------------------------------
  // 3. Templates de anamnese
  // -----------------------------------------------------------------
  const templates = new Map<TemplateKey, { id: string }>();
  for (const template of TEMPLATES) {
    const created = await prisma.anamnesisTemplate.upsert({
      where: { clinicId_name_version: { clinicId: clinic.id, name: template.name, version: 1 } },
      update: {
        description: template.description,
        schema: template.schema,
        isDefault: template.isDefault,
      },
      create: {
        clinicId: clinic.id,
        name: template.name,
        description: template.description,
        version: 1,
        schema: template.schema,
        isDefault: template.isDefault,
      },
    });
    templates.set(template.key, created);
  }
  console.log(`  anamneses        ${templates.size} templates (1 padrao, 2 por terapia)`);

  // -----------------------------------------------------------------
  // 4. Cardapio de terapias
  // -----------------------------------------------------------------
  const therapies = new Map<TerapiaSlug, Therapy>();
  for (const terapia of TERAPIAS) {
    const created = await prisma.therapy.upsert({
      where: { clinicId_slug: { clinicId: clinic.id, slug: terapia.slug } },
      update: {
        name: terapia.name,
        priceCents: terapia.priceCents,
        position: terapia.position,
        requiresMedicalClearance: terapia.requiresMedicalClearance ?? false,
      },
      create: {
        clinicId: clinic.id,
        name: terapia.name,
        slug: terapia.slug,
        category: terapia.category,
        description: terapia.description,
        durationMinutes: terapia.durationMinutes,
        bufferMinutes: terapia.bufferMinutes,
        priceCents: terapia.priceCents,
        color: terapia.color,
        position: terapia.position,
        requiresMedicalClearance: terapia.requiresMedicalClearance ?? false,
      },
    });
    therapies.set(terapia.slug, created);

    // Vinculo com o template especifico, quando a terapia tem um.
    if (terapia.templateKey !== undefined) {
      const template = must(templates, terapia.templateKey, 'template de anamnese');
      await prisma.therapyAnamnesisTemplate.upsert({
        where: { therapyId_templateId: { therapyId: created.id, templateId: template.id } },
        update: {},
        create: { clinicId: clinic.id, therapyId: created.id, templateId: template.id },
      });
    }
  }
  console.log(`  cardapio         ${therapies.size} terapias`);

  // -----------------------------------------------------------------
  // 5. Salas
  // -----------------------------------------------------------------
  const salas: { id: string }[] = [];
  for (const nome of ['Sala 1', 'Sala 2']) {
    salas.push(
      await prisma.room.upsert({
        where: { clinicId_name: { clinicId: clinic.id, name: nome } },
        update: { active: true },
        create: { clinicId: clinic.id, name: nome },
      }),
    );
  }

  // -----------------------------------------------------------------
  // 6. Profissionais
  // -----------------------------------------------------------------
  const elaineUser = must(usuarios, 'elaine', 'usuario');
  const gustavoUser = must(usuarios, 'gustavo', 'usuario');

  const elaine = await prisma.professional.upsert({
    where: { clinicId_userId: { clinicId: clinic.id, userId: elaineUser.id } },
    update: { name: elaineUser.name },
    create: {
      clinicId: clinic.id,
      userId: elaineUser.id,
      name: elaineUser.name,
      email: elaineUser.email,
      phone: requirePhone('11988770001'),
      registrationNumber: '123456-F',
      registrationType: 'CREFITO',
      bio: 'Massoterapeuta ha 12 anos, especializada em relaxamento e dor cronica.',
      color: '#0e7490',
      searchText: normalizeSearchText(elaineUser.name),
      // 40%
      defaultCommissionBasisPoints: 4_000,
    },
  });

  const gustavo = await prisma.professional.upsert({
    where: { clinicId_userId: { clinicId: clinic.id, userId: gustavoUser.id } },
    update: { name: gustavoUser.name },
    create: {
      clinicId: clinic.id,
      userId: gustavoUser.id,
      name: gustavoUser.name,
      email: gustavoUser.email,
      phone: requirePhone('11988770002'),
      registrationNumber: '654321-F',
      registrationType: 'CREFON',
      bio: 'Fisioterapeuta com foco em manipulacao vertebral e reabilitacao.',
      color: '#15803d',
      searchText: normalizeSearchText(gustavoUser.name),
      // 50%
      defaultCommissionBasisPoints: 5_000,
    },
  });

  const profissionais = new Map<ChaveProfissional, Professional>([
    ['elaine', elaine],
    ['gustavo', gustavo],
  ]);

  let vinculos = 0;
  for (const [chave, slugs] of Object.entries(HABILIDADES)) {
    const professional = must(profissionais, chave, 'profissional');
    for (const slug of slugs) {
      const therapy = must(therapies, slug, 'terapia');
      await prisma.therapyProfessional.upsert({
        where: {
          therapyId_professionalId: { therapyId: therapy.id, professionalId: professional.id },
        },
        update: { active: true },
        create: { clinicId: clinic.id, therapyId: therapy.id, professionalId: professional.id },
      });
      vinculos += 1;
    }
  }
  console.log(`  profissionais    2 (${elaine.name}, ${gustavo.name}), ${vinculos} vinculos`);

  // -----------------------------------------------------------------
  // 7. Disponibilidade
  // -----------------------------------------------------------------
  const yearStart = dateColumn(THIS_YEAR, 0, 1);
  const regras: {
    professionalId: string;
    weekday: number;
    startMinute: number;
    endMinute: number;
  }[] = [];

  for (const weekday of WEEKDAYS) {
    // Elaine: manha e tarde
    regras.push({ professionalId: elaine.id, weekday, startMinute: 9 * 60, endMinute: 13 * 60 });
    regras.push({ professionalId: elaine.id, weekday, startMinute: 14 * 60, endMinute: 19 * 60 });
    // Gustavo: so a tarde
    regras.push({ professionalId: gustavo.id, weekday, startMinute: 13 * 60, endMinute: 19 * 60 });
  }

  const existingRules = await prisma.availabilityRule.findMany({
    where: { clinicId: clinic.id, professionalId: { in: [elaine.id, gustavo.id] } },
    select: { professionalId: true, weekday: true, startMinute: true, endMinute: true },
  });
  const chavesExistentes = new Set(
    existingRules.map((r) => `${r.professionalId}|${r.weekday}|${r.startMinute}|${r.endMinute}`),
  );

  let criadas = 0;
  for (const regra of regras) {
    const chave = `${regra.professionalId}|${regra.weekday}|${regra.startMinute}|${regra.endMinute}`;
    if (chavesExistentes.has(chave)) continue;
    await prisma.availabilityRule.create({
      data: { ...regra, clinicId: clinic.id, slotGranularityMinutes: 15, effectiveFrom: yearStart },
    });
    criadas += 1;
  }

  // Elaine faz curso na quarta seguinte: dia inteiro bloqueado.
  //
  // Nao da para usar `upsert` aqui. O dia inteiro e gravado com
  // `start_minute IS NULL`, e o `where` composto do Prisma geraria
  // `start_minute = NULL`, que nunca casa. A unicidade desse caso vem
  // do indice unico parcial `availability_exceptions_all_day_key`, e o
  // seed procura antes de criar.
  const dataDoCurso = dateColumnOf(clinicLocalInstant(2, 0));
  await upsertBloqueioDeDiaInteiro({
    clinicId: clinic.id,
    professionalId: elaine.id,
    date: dataDoCurso,
    reason: 'Curso de atualizacao',
  });

  const feriados: { date: Date; description: string }[] = [
    { date: dateColumn(THIS_YEAR, 0, 1), description: 'Confraternizacao Universal' },
    { date: dateColumn(THIS_YEAR, 11, 25), description: 'Natal' },
  ];
  for (const feriado of feriados) {
    await prisma.clinicHoliday.upsert({
      where: { clinicId_date: { clinicId: clinic.id, date: feriado.date } },
      update: { description: feriado.description },
      create: { clinicId: clinic.id, date: feriado.date, description: feriado.description },
    });
  }
  console.log(
    `  disponibilidade   ${criadas} criadas de ${regras.length} regras + 1 bloqueio + ${feriados.length} feriados`,
  );

  // -----------------------------------------------------------------
  // 8. Clientes
  // -----------------------------------------------------------------
  const clientes = new Map<ClienteSeed['key'], Client>();
  for (const dados of CLIENTES) {
    const user = must(usuarios, dados.key, 'usuario');
    const created = await prisma.client.upsert({
      where: { clinicId_cpf: { clinicId: clinic.id, cpf: dados.cpf } },
      update: { phone: dados.phone, notes: dados.notes, marketingOptIn: true },
      create: {
        clinicId: clinic.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        phone: dados.phone,
        cpf: dados.cpf,
        birthDate: dados.birthDate,
        notes: dados.notes,
        searchText: normalizeSearchText(user.name),
        marketingOptIn: true,
      },
    });
    clientes.set(dados.key, created);
  }
  console.log(`  clientes         ${clientes.size}`);

  // -----------------------------------------------------------------
  // 9. Catalogo de contraindicacoes
  // -----------------------------------------------------------------
  const catalogo = indexBy(
    await Promise.all(
      CONTRAINDICACOES.map((dados) =>
        prisma.contraindication.upsert({
          where: { clinicId_code: { clinicId: clinic.id, code: dados.code } },
          update: {
            title: dados.title,
            description: dados.description,
            severity: dados.severity,
            requiresMedicalClearance: dados.requiresMedicalClearance,
          },
          create: {
            clinicId: clinic.id,
            code: dados.code,
            title: dados.title,
            description: dados.description,
            severity: dados.severity,
            requiresMedicalClearance: dados.requiresMedicalClearance,
          },
        }),
      ),
    ),
    (c) => c.code,
    'contraindicacao',
  );
  console.log(`  contraindicacoes ${catalogo.size} no catalogo`);

  // -----------------------------------------------------------------
  // 10. Anamneses cifradas
  // -----------------------------------------------------------------
  // O seed passa pelo mesmo caminho de cifragem do runtime: se a chave
  // da .env estiver errada, o seed falha aqui, e nao no meio de uma
  // sessao real.
  const maria = must(clientes, 'maria', 'cliente');
  const carlos = must(clientes, 'carlos', 'cliente');
  const juliana = must(clientes, 'juliana', 'cliente');
  const templateGeral = must(templates, 'geral', 'template de anamnese');
  const templateDrenagem = must(templates, 'drenagem', 'template de anamnese');

  const mariaAnamnesis = await upsertAnamnesis({
    clinicId: clinic.id,
    clientId: maria.id,
    templateId: templateGeral.id,
    status: 'APROVADA',
    payload: generateAnamnesisAnswers(
      {
        templateId: templateGeral.id,
        answers: {
          objetivo: 'Aliviar tensao no pescoco e no ombro. Trabalho de escritorio.',
          condicoes_saude: ['nenhuma'],
          tratamentos_medicamentos: 'Nenhum continuo. AAS esporadico por dor de cabeca.',
          anticoagulantes: true,
          febre_ou_infeccao: false,
          alergia: 'Oleo de fragrancia. Oferecer oleo de girassol.',
          pressao_arterial: '120/80 ha dois meses',
          lesao_na_area: false,
          preference_pressao: 'moderada',
          aceite_termo: true,
        },
      },
      env.ANAMNESIS_ENCRYPTION_KEY,
    ),
    // Quem revisou e o USUARIO, nao o Professional: `reviewedByUserId`
    // aponta para `users`, e a FK barra a troca silenciosa.
    reviewedByUserId: elaineUser.id,
  });

  const julianaAnamnesis = await upsertAnamnesis({
    clinicId: clinic.id,
    clientId: juliana.id,
    templateId: templateDrenagem.id,
    status: 'ENVIADA',
    payload: generateAnamnesisAnswers(
      {
        templateId: templateDrenagem.id,
        answers: {
          gestacao: true,
          semanas_gestacao: 28,
          em_amnias: false,
          inchaoco: ['membros_inferiores', 'face'],
          cirugias_recentes: false,
          historico_cancer: false,
          alteracoes_sensibilidade: false,
        },
      },
      env.ANAMNESIS_ENCRYPTION_KEY,
    ),
  });
  console.log('  respostas        2 (1 aprovada, 1 aguardando revisao)');

  // -----------------------------------------------------------------
  // 11. Condicao de saude e alerta
  // -----------------------------------------------------------------
  // Juliana esta gestante. E o que dispara o alerta na drenagem.
  const gestacao = must(catalogo, 'GESTACAO', 'contraindicacao');
  const condicaoJuliana = await upsertCondicaoCliente({
    clinicId: clinic.id,
    clientId: juliana.id,
    code: gestacao.code,
    title: gestacao.title,
    data: {
      contraindicationId: gestacao.id,
      description: 'Gestacao de 28 semanas, relatada na anamnese.',
      severity: 'ALTA',
      requiresMedicalClearance: true,
      source: 'Anamnese respondida pelo cliente',
      diagnosedAt: dateColumn(THIS_YEAR, THIS_MONTH, 1),
      resolvedAt: null,
      notes: 'Reavaliar a cada trimestre.',
      createdByUserId: admin.id,
    },
  });

  // Drenagem linfatica e contraindicacao de gestacao: o par que o
  // sistema precisa enxergar sozinho.
  const drenagem = must(therapies, 'drenagem-linfatica', 'terapia');
  await prisma.therapyContraindication.upsert({
    where: {
      therapyId_contraindicationId: { therapyId: drenagem.id, contraindicationId: gestacao.id },
    },
    update: { severity: 'ALTA', requiresMedicalClearance: true },
    create: {
      clinicId: clinic.id,
      therapyId: drenagem.id,
      contraindicationId: gestacao.id,
      severity: 'ALTA',
      requiresMedicalClearance: true,
    },
  });
  console.log('  condicao         1 (Juliana: gestacao) + 1 par terapia/contraindicacao');

  // -----------------------------------------------------------------
  // 12. Pacote de sessoes
  // -----------------------------------------------------------------
  const pacoteNome = 'Pacote 5 Sessoes - Relaxante';
  const pacote = await prisma.package.upsert({
    where: {
      clinicId_clientId_name: { clinicId: clinic.id, clientId: maria.id, name: pacoteNome },
    },
    update: { priceCents: 54_000, status: 'ATIVO' },
    create: {
      clinicId: clinic.id,
      clientId: maria.id,
      name: pacoteNome,
      totalSessions: 5,
      // 5 x 12000 com 10% de desconto
      priceCents: 54_000,
      validFrom: dateColumn(THIS_YEAR, THIS_MONTH, 1),
      validUntil: dateColumn(THIS_YEAR, THIS_MONTH + 3, 1),
      status: 'ATIVO',
      notes: 'Vendido no balcao. 5 sessoes de massagem relaxante.',
      createdByUserId: admin.id,
    },
  });

  // O saldo do pacote e o count das sessoes, nunca um contador guardado
  // no pacote: dois campos para o mesmo saldo divergem.
  const sessoesDoPacote = await prisma.packageSession.count({ where: { packageId: pacote.id } });
  if (sessoesDoPacote === 0) {
    await prisma.packageSession.createMany({
      data: Array.from({ length: pacote.totalSessions }, () => ({
        clinicId: clinic.id,
        packageId: pacote.id,
        expiresAt: pacote.validUntil,
      })),
    });
  }
  console.log(`  pacotes          1 (${pacote.name}, ${pacote.totalSessions} sessoes)`);

  // -----------------------------------------------------------------
  // 13. Agenda
  // -----------------------------------------------------------------
  const agendamentos: Appointment[] = [];

  for (const dados of AGENDAMENTOS) {
    const client = must(clientes, dados.clientKey, 'cliente');
    const professional = must(profissionais, dados.professionalKey, 'profissional');
    const therapy = must(therapies, dados.therapySlug, 'terapia');
    const room = mustAt(salas, dados.roomIndex, 'sala');

    const appointment = await prisma.appointment.upsert({
      where: { clinicId_idempotencyKey: { clinicId: clinic.id, idempotencyKey: dados.key } },
      // Nao mexe em status: reexecutar o seed nao pode desfazer uma
      // sessao que a equipe andou alterando no dia a dia.
      update: { startAt: dados.startAt, endAt: dados.endAt, priceCents: therapy.priceCents },
      create: {
        clinicId: clinic.id,
        clientId: client.id,
        professionalId: professional.id,
        therapyId: therapy.id,
        roomId: room.id,
        startAt: dados.startAt,
        endAt: dados.endAt,
        status: dados.status,
        source: dados.source,
        priceCents: therapy.priceCents,
        notes: dados.notes ?? null,
        sessionNotes: dados.sessionNotes ?? null,
        confirmedAt: dados.confirmedAt ?? null,
        startedAt: dados.startedAt ?? null,
        finishedAt: dados.finishedAt ?? null,
        cancellationReason: dados.cancellationReason ?? null,
        idempotencyKey: dados.key,
        createdByUserId: admin.id,
      },
    });
    agendamentos.push(appointment);
  }
  console.log(`  agendamentos     ${agendamentos.length}`);

  // Trilha de status: append-only, entao so insere o que falta.
  for (const [index, dados] of AGENDAMENTOS.entries()) {
    const appointment = mustAt(agendamentos, index, 'agendamento');
    const jaRegistradas = await prisma.appointmentStatusHistory.count({
      where: { appointmentId: appointment.id },
    });
    if (jaRegistradas > 0) continue;

    const chain = TRILHA[dados.status];
    await prisma.appointmentStatusHistory.createMany({
      data: chain.map((toStatus, step) => ({
        clinicId: clinic.id,
        appointmentId: appointment.id,
        fromStatus: step === 0 ? null : (chain[step - 1] ?? null),
        toStatus,
        changedByUserId: dados.source === 'PORTAL_CLIENTE' ? null : admin.id,
      })),
    });
  }

  // -----------------------------------------------------------------
  // 14. Anamnese vinculada a sessao
  // -----------------------------------------------------------------
  // Congela qual versao o profissional leu. A Maria tem a versao 1
  // usada na sessao de segunda passada; se ela responder de novo, a
  // sessao continua apontando para a 1.
  const sessaoConcluida = mustAt(agendamentos, 0, 'agendamento');
  const sessaoDrenagem = mustAt(agendamentos, 5, 'agendamento');

  for (const par of [
    { appointment: sessaoConcluida, anamnesis: mariaAnamnesis },
    { appointment: sessaoDrenagem, anamnesis: julianaAnamnesis },
  ]) {
    await prisma.appointmentAnamnesis.upsert({
      where: { appointmentId: par.appointment.id },
      update: {},
      create: {
        clinicId: clinic.id,
        appointmentId: par.appointment.id,
        anamnesisId: par.anamnesis.id,
      },
    });
  }

  // -----------------------------------------------------------------
  // 15. Alerta de contraindicacao
  // -----------------------------------------------------------------
  // O caso que justifica o modelo: cliente gestante com drenagem
  // linfatica agendada. O sistema avisa e deixa a decisao com quem pode
  // avaliar -- o profissional. Nao bloqueia sozinho.
  const alerta = await upsertAlerta({
    clinicId: clinic.id,
    appointmentId: sessaoDrenagem.id,
    clientContraindicationId: condicaoJuliana.id,
    data: {
      contraindicationId: gestacao.id,
      severity: 'ALTA',
      message:
        'Cliente gestante (28 semanas) com sessao de Drenagem Linfatica agendada. ' +
        'Drenagem profunda e contraindicada nesta fase. Avalie pressao e tecnica, ou ' +
        'remarque. Registre a decisao.',
      decision: 'PENDENTE',
    },
  });
  console.log(
    `  alerta           1 pendente (gestante + drenagem linfatica), severidade ${alerta}`,
  );

  // -----------------------------------------------------------------
  // 16. Financeiro
  // -----------------------------------------------------------------
  // Todo lancamento tem idempotencyKey estavel: reexecutar o seed nao
  // duplica dinheiro.
  const receitaConcluida = await prisma.financialEntry.upsert({
    where: {
      clinicId_idempotencyKey: { clinicId: clinic.id, idempotencyKey: 'seed:receita:concluida' },
    },
    update: {},
    create: {
      clinicId: clinic.id,
      clientId: maria.id,
      appointmentId: sessaoConcluida.id,
      kind: 'RECEITA',
      status: 'PAGO',
      method: 'PIX',
      amountCents: sessaoConcluida.priceCents,
      paidAt: sessaoConcluida.finishedAt,
      dueDate: dateColumnOf(sessaoConcluida.startAt),
      description: 'Sessao de massagem relaxante (recebida no Pix)',
      idempotencyKey: 'seed:receita:concluida',
    },
  });

  const aReceber: readonly {
    key: string;
    clientId: string;
    appointment: Appointment;
    description: string;
  }[] = [
    {
      key: 'seed:receita:confirmado-terapeutica',
      clientId: maria.id,
      appointment: mustAt(agendamentos, 4, 'agendamento'),
      description: 'Massagem terapeutica - sessao confirmada',
    },
    {
      key: 'seed:receita:confirmado-drenagem',
      clientId: juliana.id,
      appointment: sessaoDrenagem,
      description: 'Drenagem linfatica - sessao confirmada',
    },
    {
      key: 'seed:receita:pendente',
      clientId: carlos.id,
      appointment: mustAt(agendamentos, 3, 'agendamento'),
      description: 'Shiatsu - aguardando confirmacao',
    },
  ];

  for (const item of aReceber) {
    await prisma.financialEntry.upsert({
      where: { clinicId_idempotencyKey: { clinicId: clinic.id, idempotencyKey: item.key } },
      update: {},
      create: {
        clinicId: clinic.id,
        clientId: item.clientId,
        appointmentId: item.appointment.id,
        kind: 'RECEITA',
        status: 'PENDENTE',
        amountCents: item.appointment.priceCents,
        dueDate: dateColumnOf(item.appointment.startAt),
        description: item.description,
        idempotencyKey: item.key,
      },
    });
  }

  const pacoteVendaDate = dateColumnOf(new Date(NOW.getTime() - 20 * MS_PER_DAY));
  await prisma.financialEntry.upsert({
    where: {
      clinicId_idempotencyKey: { clinicId: clinic.id, idempotencyKey: 'seed:receita:pacote' },
    },
    update: {},
    create: {
      clinicId: clinic.id,
      clientId: maria.id,
      packageId: pacote.id,
      kind: 'RECEITA',
      status: 'PAGO',
      method: 'CARTAO_CREDITO',
      amountCents: 54_000,
      paidAt: pacoteVendaDate,
      dueDate: pacoteVendaDate,
      description: `${pacote.name} - 5 sessoes`,
      idempotencyKey: 'seed:receita:pacote',
    },
  });

  const aluguelDate = dateColumnOf(new Date(NOW.getTime() - 5 * MS_PER_DAY));
  await prisma.financialEntry.upsert({
    where: {
      clinicId_idempotencyKey: { clinicId: clinic.id, idempotencyKey: 'seed:despesa:aluguel' },
    },
    update: {},
    create: {
      clinicId: clinic.id,
      kind: 'DESPESA',
      status: 'PAGO',
      method: 'TRANSFERENCIA',
      amountCents: 2_800,
      paidAt: aluguelDate,
      dueDate: aluguelDate,
      description: 'Aluguel do mes',
      idempotencyKey: 'seed:despesa:aluguel',
    },
  });

  // 40% de 12000 = 4800.
  const comissao = await prisma.commission.upsert({
    where: {
      appointmentId_professionalId: {
        appointmentId: sessaoConcluida.id,
        professionalId: elaine.id,
      },
    },
    update: {},
    create: {
      clinicId: clinic.id,
      professionalId: elaine.id,
      appointmentId: sessaoConcluida.id,
      financialEntryId: receitaConcluida.id,
      baseAmountCents: sessaoConcluida.priceCents,
      percentBasisPoints: elaine.defaultCommissionBasisPoints,
      amountCents: Math.round(
        (sessaoConcluida.priceCents * elaine.defaultCommissionBasisPoints) / 10_000,
      ),
      status: 'APROVADA',
      periodStart: dateColumn(THIS_YEAR, THIS_MONTH, 1),
      periodEnd: dateColumn(THIS_YEAR, THIS_MONTH + 1, 0),
    },
  });
  console.log(
    `  financeiro       6 lancamentos + comissao de ${brl(comissao.amountCents)} (${elaine.defaultCommissionBasisPoints / 100}%)`,
  );

  // -----------------------------------------------------------------
  // 17. Outbox de notificacoes
  // -----------------------------------------------------------------
  const enviadaEm = sessaoConcluida.confirmedAt;
  const dedupeKey = `seed:confirmacao:${sessaoConcluida.id}`;
  await prisma.notification.upsert({
    where: { dedupeKey },
    update: {},
    create: {
      clinicId: clinic.id,
      clientId: maria.id,
      appointmentId: sessaoConcluida.id,
      channel: 'EMAIL',
      type: 'CONFIRMACAO_AGENDAMENTO',
      recipient: mariaUser.email,
      subject: 'Sua sessao esta confirmada',
      body:
        'Ola Maria! Sua sessao de Massagem Relaxante com Elaine esta confirmada. ' +
        'Chegue 10 minutos antes. Ate breve!',
      status: 'ENVIADO',
      attempts: 1,
      scheduledFor: enviadaEm ?? NOW,
      sentAt: enviadaEm,
      dedupeKey,
    },
  });

  // -----------------------------------------------------------------
  // 18. Auditoria
  // -----------------------------------------------------------------
  const logsExistentes = await prisma.auditLog.count({ where: { clinicId: clinic.id } });
  if (logsExistentes === 0) {
    await prisma.auditLog.createMany({
      data: [
        {
          clinicId: clinic.id,
          actorUserId: admin.id,
          action: 'seed.executed',
          entity: 'clinic',
          entityId: clinic.id,
          metadata: { version: 1 },
        },
        {
          clinicId: clinic.id,
          actorUserId: elaineUser.id,
          action: 'anamnesis.reviewed',
          entity: 'anamnesis',
          entityId: mariaAnamnesis.id,
          metadata: { result: 'APROVADA' },
        },
      ],
    });
  }

  await relatorio({ clinicId: clinic.id, slug: clinic.slug });
}

// -------------------------------------------------------------------
// Relatorio final
// -------------------------------------------------------------------

interface ResumoClinica {
  readonly clinicId: string;
  readonly slug: string;
}

async function relatorio(clinic: ResumoClinica): Promise<void> {
  const recebido = await prisma.financialEntry.aggregate({
    where: { clinicId: clinic.clinicId, status: 'PAGO', kind: 'RECEITA' },
    _sum: { amountCents: true },
  });
  const aberto = await prisma.financialEntry.aggregate({
    where: { clinicId: clinic.clinicId, status: 'PENDENTE', kind: 'RECEITA' },
    _sum: { amountCents: true },
  });

  const agenda = await prisma.appointment.findMany({
    where: {
      clinicId: clinic.clinicId,
      startAt: { gte: ANCHOR, lt: new Date(ANCHOR.getTime() + 7 * MS_PER_DAY) },
    },
    orderBy: { startAt: 'asc' },
    include: { therapy: { select: { name: true } } },
  });

  const linha = '='.repeat(62);
  console.log(`\n${linha}`);
  console.log(`  Link publico     /agendar/${clinic.slug}`);
  console.log(`  Administrador    admin@clinicawave.com.br`);
  console.log(`  Profissional     elaine@clinicawave.com.br`);
  console.log(`  Cliente          maria.aparecida@email.com.br`);
  console.log(`  Senha (todos)    ${DEMO_PASSWORD}`);
  console.log(linha);
  console.log(`  Recebido         R$ ${brl(recebido._sum.amountCents ?? 0)}`);
  console.log(`  A receber        R$ ${brl(aberto._sum.amountCents ?? 0)}`);
  console.log(`  Agenda da semana (${CLINIC_TIMEZONE}):`);
  for (const sessao of agenda) {
    // Instante UTC -> hora local da clinica: soma o offset (que e
    // negativo), e le com getUTC* para nao depender do fuso da maquina
    // que roda o seed.
    const local = new Date(sessao.startAt.getTime() + CLINIC_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
    const dia = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][local.getUTCDay()] ?? '???';
    const hora = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
    console.log(
      `    ${`${dia} ${hora}`.padEnd(11)}${sessao.status.padEnd(18)}${sessao.therapy.name}`,
    );
  }
  console.log(`${linha}\n`);
}

// -------------------------------------------------------------------
// Helpers de upsert
// -------------------------------------------------------------------

/**
 * Bloqueio de dia inteiro (`start_minute`/`end_minute` nulos).
 *
 * O `upsert` do Prisma nao serve: o `where` composto geraria
 * `start_minute = NULL`, que nunca e verdadeiro em SQL, entao cada
 * execucao do seed criaria uma linha nova. A unicidade e garantida pelo
 * indice unico parcial `availability_exceptions_all_day_key`.
 */
async function upsertBloqueioDeDiaInteiro(input: {
  readonly clinicId: string;
  readonly professionalId: string;
  readonly date: Date;
  readonly reason: string;
}): Promise<void> {
  const existing = await prisma.availabilityException.findFirst({
    where: {
      clinicId: input.clinicId,
      professionalId: input.professionalId,
      date: input.date,
      type: 'BLOQUEIO',
      startMinute: null,
    },
    select: { id: true },
  });

  if (existing !== null) {
    await prisma.availabilityException.update({
      where: { id: existing.id },
      data: { reason: input.reason, active: true },
    });
    return;
  }

  await prisma.availabilityException.create({
    data: { ...input, type: 'BLOQUEIO' },
  });
}

/**
 * `ClientContraindication` nao tem chave natural unica: a mesma cliente
 * pode ter a mesma condicao em momentos diferentes, e so a versao aberta
 * (sem `resolved_at`) interessa. Procurar antes de criar evita o
 * duplicado que o balcao criaria ao cadastrar a gestacao de novo.
 */
async function upsertCondicaoCliente(input: {
  readonly clinicId: string;
  readonly clientId: string;
  readonly code: string;
  readonly title: string;
  readonly data: Omit<
    Prisma.ClientContraindicationUncheckedCreateInput,
    'clinicId' | 'clientId' | 'code' | 'title'
  >;
}): Promise<{ id: string }> {
  const existing = await prisma.clientContraindication.findFirst({
    where: {
      clinicId: input.clinicId,
      clientId: input.clientId,
      code: input.code,
      resolvedAt: null,
    },
    select: { id: true },
  });

  if (existing !== null) {
    return prisma.clientContraindication.update({
      where: { id: existing.id },
      data: input.data,
      select: { id: true },
    });
  }

  return prisma.clientContraindication.create({
    data: {
      clinicId: input.clinicId,
      clientId: input.clientId,
      code: input.code,
      title: input.title,
      ...input.data,
    },
    select: { id: true },
  });
}

/**
 * Alertas tambem nao tem chave natural: o mesmo par sessao x condicao
 * pode gerar mais de um aviso quando a severidade muda, e o que importa
 * e nao repetir o aviso enquanto ele estiver pendente.
 */
async function upsertAlerta(input: {
  readonly clinicId: string;
  readonly appointmentId: string;
  readonly clientContraindicationId: string;
  readonly data: Omit<
    Prisma.ContraindicationAlertUncheckedCreateInput,
    'clinicId' | 'appointmentId' | 'clientContraindicationId'
  >;
}): Promise<string> {
  const existing = await prisma.contraindicationAlert.findFirst({
    where: {
      clinicId: input.clinicId,
      appointmentId: input.appointmentId,
      clientContraindicationId: input.clientContraindicationId,
      decision: 'PENDENTE',
    },
    select: { id: true, severity: true },
  });

  if (existing !== null) {
    return prisma.contraindicationAlert
      .update({ where: { id: existing.id }, data: input.data, select: { severity: true } })
      .then((row) => row.severity);
  }

  const created = await prisma.contraindicationAlert.create({
    data: {
      clinicId: input.clinicId,
      appointmentId: input.appointmentId,
      clientContraindicationId: input.clientContraindicationId,
      ...input.data,
    },
    select: { severity: true },
  });
  return created.severity;
}

interface AnamnesisSeed {
  readonly clinicId: string;
  readonly clientId: string;
  readonly templateId: string;
  readonly status: StatusAnamnese;
  readonly payload: { readonly ciphertext: string; readonly contentHash: string };
  readonly reviewedByUserId?: string;
}

/**
 * A resposta da anamnese e imutavel depois de enviada: o trigger do banco
 * bloqueia UPDATE do conteudo. Por isso o `update` aqui mexe so em status
 * e revisao. Reexecutar o seed nao pode reescrever dado clinico -- e o
 * trigger existe justamente para isso.
 */
async function upsertAnamnesis(input: AnamnesisSeed): Promise<{ id: string }> {
  const chave = {
    clinicId_clientId_version: {
      clinicId: input.clinicId,
      clientId: input.clientId,
      version: 1,
    },
  };
  const existing = await prisma.anamnesis.findUnique({ where: chave, select: { id: true } });

  if (existing === null) {
    return prisma.anamnesis.create({
      data: {
        clinicId: input.clinicId,
        clientId: input.clientId,
        templateId: input.templateId,
        version: 1,
        status: input.status,
        answersEncrypted: input.payload.ciphertext,
        contentHash: input.payload.contentHash,
        submittedAt: NOW,
        signedAt: NOW,
        ...(input.reviewedByUserId === undefined
          ? {}
          : { reviewedByUserId: input.reviewedByUserId, reviewedAt: NOW }),
      },
      select: { id: true },
    });
  }

  return prisma.anamnesis.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      ...(input.reviewedByUserId === undefined
        ? {}
        : { reviewedByUserId: input.reviewedByUserId, reviewedAt: NOW }),
    },
    select: { id: true },
  });
}

// -------------------------------------------------------------------
// Execucao
// -------------------------------------------------------------------

/**
 * Cinto e suspensorio do seed: um banco de producao nao pode ser
 * populado com cliente de teste, senha unica e agendamento inventado.
 * O teste do sufixo do banco cobre o caso em que NODE_ENV ficou
 * `development` num ambiente que aponta para o servidor.
 */
function assertNotProduction(): void {
  const databaseName = decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, ''));
  if (env.isProduction) {
    throw new Error('O seed nao pode rodar com NODE_ENV=production.');
  }
  if (!/_(dev|test)$/.test(databaseName)) {
    throw new Error(
      `O seed so roda em banco de desenvolvimento ou teste. O DATABASE_URL aponta para "${databaseName}".`,
    );
  }
}

async function main(): Promise<void> {
  assertNotProduction();
  try {
    await seed();
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error('\nSeed falhou:');
  console.error(error);
  process.exitCode = 1;
});
