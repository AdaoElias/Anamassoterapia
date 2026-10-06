import { createHash, randomBytes } from 'node:crypto';

import {
  type AnamnesisAnswers,
  type AnamnesisForm,
  anamnesisFormSchema,
  validarRespostasAnamnesis,
} from '@massoterapia/shared';

import { env } from '../../config/env.js';
import { generateAnamnesisAnswers, readAnamnesisAnswers } from '../anamnesis-crypto.js';
import { ErroDominio } from '../dominio-erros.js';
import { prisma } from '../prisma.js';
import { proximaVersao } from './servico.js';

/**
 * Convite de anamnese por link.
 *
 * A clinica gera um link, o cliente responde sem login. Duas portas e um unico
 * dado:
 *
 * - `criarConvite` (rota autenticada) grava o convite e devolve o token **uma
 *   vez**. O banco guarda so o SHA-256, entao quem nao copiou o link na hora
 *   precisa gerar outro -- e `listarConvites` devolve os expirados sem token
 *   justamente para nao prometer o que nao pode entregar.
 * - `abrirConvite`, `salvarRascunho` e `enviarConvite` (rotas publicas) sao a
 *   contraparte sem sessao. Quem tem o link tem o acesso, e por isso elas so
 *   aceitam token: nunca `clientId`, nunca `clinicId`.
 *
 * A resposta do rascunho mora na propria `Anamnesis` em RASCUNHO, criada na
 * primeira abertura. Tabela separada de respostas seria uma segunda fonte para
 * o mesmo dado, e as duas divergiriam.
 */

/** 43 caracteres em base64url, o mesmo formato do refresh token. */
function gerarToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Erro unico para token invalido, expirado e consumido.
 *
 * Uma mensagem so: dizer "este link expirou" para um token que nao existe
 * entrega que ele existiu, e quem recebe a informacao pode estar sondando.
 */
export function linkInvalido(): ErroDominio {
  return new ErroDominio(
    'ANAMNESIS_INVITE_INVALID',
    404,
    'Link de anamnese invalido ou expirado. Peca um novo link a clinica.',
  );
}

const inviteSelect = {
  id: true,
  clientId: true,
  templateId: true,
  expiresAt: true,
  usedAt: true,
  createdAt: true,
  client: { select: { name: true } },
  template: { select: { name: true } },
} as const;

export type LinhaInvite = {
  id: string;
  clientId: string;
  templateId: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  client: { name: string };
  template: { name: string };
};

/** Listagem: sem token. O hash no banco nao permite devolver o link antigo. */
export function respostaConvite(linha: LinhaInvite) {
  return {
    id: linha.id,
    clientId: linha.clientId,
    templateId: linha.templateId,
    templateName: linha.template.name,
    clientName: linha.client.name,
    expiresAt: linha.expiresAt.toISOString(),
    usedAt: linha.usedAt?.toISOString() ?? null,
    createdAt: linha.createdAt.toISOString(),
  };
}

export async function listarConvites(clientId: string, clinicId: string) {
  const linhas = await prisma.anamnesisInvite.findMany({
    where: { clientId, clinicId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: inviteSelect,
  });

  return linhas.map(respostaConvite);
}

/**
 * Gera o convite. O template e obrigatorio porque o link aponta para uma
 * versao concreta do formulario: a clinica decide o que sera perguntado antes
 * de o cliente responder.
 */
export async function criarConvite(
  clinicId: string,
  clientId: string,
  templateId: string,
  userId: string,
  expiresInDays: number,
) {
  const [template, cliente] = await Promise.all([
    prisma.anamnesisTemplate.findFirst({
      where: { id: templateId, clinicId, isActive: true },
      select: { id: true, name: true },
    }),
    prisma.client.findFirst({
      where: { id: clientId, clinicId },
      select: { id: true, name: true },
    }),
  ]);

  if (template === null) {
    throw new ErroDominio(
      'ANAMNESIS_TEMPLATE_NOT_FOUND',
      404,
      'Formulario de anamnese nao encontrado nesta clinica.',
    );
  }

  if (cliente === null) {
    throw new ErroDominio('CLIENT_NOT_FOUND', 404, 'Cliente nao encontrado.');
  }

  const token = gerarToken();

  const linha = await prisma.anamnesisInvite.create({
    data: {
      clinicId,
      clientId: cliente.id,
      templateId: template.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      createdByUserId: userId,
    },
    select: inviteSelect,
  });

  return { ...respostaConvite(linha), token };
}

type ConviteAberto = {
  id: string;
  clinicId: string;
  clientId: string;
  templateId: string;
  anamnesisId: string | null;
  usedAt: Date | null;
  expiresAt: Date;
  client: { name: string };
  clinic: { name: string };
  template: { name: string; description: string | null; isActive: boolean; schema: unknown };
  anamnesis: {
    id: string;
    status: string;
    answersEncrypted: string | null;
    contentHash: string | null;
  } | null;
};

/** Convite pelo hash do token, ou `null` para invalido, expirado e consumido. */
export async function acharConvite(token: string): Promise<ConviteAberto | null> {
  const convite = await prisma.anamnesisInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      clinicId: true,
      clientId: true,
      templateId: true,
      anamnesisId: true,
      usedAt: true,
      expiresAt: true,
      client: { select: { name: true } },
      clinic: { select: { name: true } },
      template: { select: { name: true, description: true, isActive: true, schema: true } },
      anamnesis: {
        select: { id: true, status: true, answersEncrypted: true, contentHash: true },
      },
    },
  });

  if (convite === null || convite.usedAt !== null) return null;
  if (convite.expiresAt.getTime() <= Date.now()) return null;

  return convite;
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/**
 * Formulario do link, com o rascunho ja salvo.
 *
 * A primeira abertura cria a `Anamnesis` em RASCUNHO, antes de qualquer
 * resposta. E o que faz o link valer enquanto o cliente preenche: a linha ja
 * existe, com a versao correta, quando ele vier enviar.
 */
export async function abrirConvite(token: string) {
  const convite = await acharConvite(token);
  if (convite === null) throw linkInvalido();

  if (convite.template.isActive === false) {
    throw new ErroDominio(
      'ANAMNESIS_TEMPLATE_INACTIVE',
      409,
      'Este formulario de anamnese nao esta mais disponivel. Fale com a clinica.',
    );
  }

  const rascunho = await garantirRascunho(convite);

  return {
    clinicName: convite.clinic.name,
    // Primeiro nome: quem abre o link pode ser o proprio cliente ou alguem da
    // familia, e o formulario e de saude.
    clientFirstName: primeiroNome(convite.client.name),
    templateName: convite.template.name,
    templateDescription: convite.template.description,
    schema: anamnesisFormSchema.parse(convite.template.schema),
    answers: rascunho === null ? {} : revelarRascunho(rascunho),
    expiresAt: convite.expiresAt.toISOString(),
  };
}

/** Cria a Anamnesis RASCUNHO do convite, se ainda nao existir. */
async function garantirRascunho(convite: ConviteAberto) {
  if (convite.anamnesisId !== null) {
    if (convite.anamnesis === null) {
      throw new ErroDominio(
        'ANAMNESIS_INTEGRITY',
        500,
        'Nao foi possivel abrir este formulario de anamnese.',
      );
    }
    return convite.anamnesis;
  }

  return prisma.$transaction(async (tx) => {
    const version = await proximaVersao(tx, convite.clinicId, convite.clientId);

    const criada = await tx.anamnesis.create({
      data: {
        clinicId: convite.clinicId,
        clientId: convite.clientId,
        templateId: convite.templateId,
        version,
        status: 'RASCUNHO',
      },
      select: { id: true, status: true, answersEncrypted: true, contentHash: true },
    });

    // `updateMany` e nao `update`: dois "abrir" simultaneos (o mesmo cliente em
    // dois dispositivos) criariam dois rascunhos, e o segundo `update` nao
    // encontraria mais a linha do convite.
    const { count } = await tx.anamnesisInvite.updateMany({
      where: { id: convite.id, anamnesisId: null },
      data: { anamnesisId: criada.id },
    });

    if (count === 0) {
      throw new ErroDominio(
        'ANAMNESIS_INVITE_RACE',
        409,
        'Este formulario ja foi aberto em outro navegador. Recarregue a pagina.',
      );
    }

    return criada;
  });
}

/** Decifra o rascunho. Rascunho sem conteudo e objeto vazio, sem erro. */
function revelarRascunho(linha: {
  answersEncrypted: string | null;
  contentHash: string | null;
}): AnamnesisAnswers {
  if (linha.answersEncrypted === null) return {};

  try {
    const { data } = readAnamnesisAnswers(linha.answersEncrypted, env.ANAMNESIS_ENCRYPTION_KEY);
    return (data.answers ?? {}) as AnamnesisAnswers;
  } catch {
    throw new ErroDominio(
      'ANAMNESIS_INTEGRITY',
      500,
      'Nao foi possivel ler o rascunho deste formulario. Peca um novo link a clinica.',
    );
  }
}

/**
 * Salva o rascunho. Aceita resposta parcial de proposito: e o "salvar e sair"
 * do formulario publico, e exigir o formulario inteiro transformaria o rascunho
 * em envio. A validacao completa fica no `enviarConvite`.
 */
export async function salvarRascunho(token: string, respostas: AnamnesisAnswers) {
  const convite = await acharConvite(token);
  if (convite === null) throw linkInvalido();

  const form: AnamnesisForm = anamnesisFormSchema.parse(convite.template.schema);
  const rascunho = await garantirRascunho(convite);

  // Chave que nao existe no formulario e tentativa de gravar dado onde a
  // clinica nao perguntou. Aceitar em silencio faria o campo fantasma voltar no
  // payload cifrado e aparecer na revisao como se fosse resposta do cliente.
  for (const chave of Object.keys(respostas)) {
    if (form.properties[chave] === undefined) {
      throw new ErroDominio(
        'ANAMNESIS_ANSWERS_INVALID',
        422,
        `O formulario nao tem o campo "${chave}".`,
      );
    }
  }

  if (Object.keys(respostas).length === 0) {
    await prisma.anamnesis.updateMany({
      where: { id: rascunho.id, status: 'RASCUNHO' },
      data: { answersEncrypted: null, contentHash: null },
    });
    return;
  }

  const { ciphertext, contentHash } = generateAnamnesisAnswers(
    { templateId: convite.templateId, answers: respostas },
    env.ANAMNESIS_ENCRYPTION_KEY,
  );

  await prisma.anamnesis.updateMany({
    where: { id: rascunho.id, status: 'RASCUNHO' },
    data: { answersEncrypted: ciphertext, contentHash },
  });
}

/**
 * Envia a anamnese do link. A partir daqui o conteudo nao volta atras: o
 * `where status: RASCUNHO` faz o segundo envio perder a corrida, e o convite e
 * consumido na mesma transacao -- nao ha janela em que a anamnese foi enviada e
 * o link continua valendo.
 */
export async function enviarConvite(
  token: string,
  respostas: AnamnesisAnswers | undefined,
  signed: boolean,
) {
  const convite = await acharConvite(token);
  if (convite === null) throw linkInvalido();

  const rascunho = await garantirRascunho(convite);

  const form: AnamnesisForm = anamnesisFormSchema.parse(convite.template.schema);
  const finais = respostas ?? revelarRascunho(rascunho);

  const problemas = validarRespostasAnamnesis(form, finais);
  if (problemas.length > 0) {
    throw new ErroDominio('ANAMNESIS_ANSWERS_INVALID', 422, problemas.join(' '));
  }

  if (Object.keys(finais).length === 0) {
    throw new ErroDominio(
      'ANAMNESIS_EMPTY',
      422,
      'Preencha a anamnese antes de enviar para revisao.',
    );
  }

  const { ciphertext, contentHash } = generateAnamnesisAnswers(
    { templateId: convite.templateId, answers: finais },
    env.ANAMNESIS_ENCRYPTION_KEY,
  );

  const agora = new Date();

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.anamnesis.updateMany({
      where: { id: rascunho.id, clinicId: convite.clinicId, status: 'RASCUNHO' },
      data: {
        status: 'ENVIADA',
        answersEncrypted: ciphertext,
        contentHash,
        submittedAt: agora,
        ...(signed ? { signedAt: agora } : {}),
      },
    });

    if (count === 0) {
      throw new ErroDominio('ANAMNESIS_ALREADY_SENT', 409, 'Esta anamnese ja foi enviada.');
    }

    await tx.anamnesisInvite.update({
      where: { id: convite.id },
      data: { usedAt: agora },
    });
  });

  return { submittedAt: agora.toISOString() };
}
