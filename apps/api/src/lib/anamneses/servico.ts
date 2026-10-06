import {
  type AnamnesisAnswers,
  type AnamnesisForm,
  validarRespostasAnamnesis,
} from '@massoterapia/shared';

import { env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  generateAnamnesisAnswers,
  readAnamnesisAnswers,
  verifyAnamnesisHash,
} from '../anamnesis-crypto.js';
import { ErroDominio } from '../dominio-erros.js';
import { prisma } from '../prisma.js';

/**
 * Regras de negocio da anamnese, fora das rotas.
 *
 * Tres garantias moram aqui:
 *
 * 1. **Versao nova, nunca sobrescrita.** `proximaVersao` le o maior `version`
 *    do cliente e soma um. Duas respostas simultaneas podem ler o mesmo
 *    maior valor -- e o `@@unique([clinicId, clientId, version])` do banco
 *    faz a segunda falhar, em vez de duas respostas com o mesmo numero.
 * 2. **Conteudo cifrado no momento em que sai do rascunho.** Nada de guardar
 *    resposta em claro para cifrar depois: o espaco entre as duas coisas e
 *    tempo de dado de saude em claro no banco.
 * 3. **Resposta validada contra o formulario que a pediu.** O formulario e
 *    dado escrito pela clinica; o Zod da API so garante que ele e bem
 *    formado, nao que o cliente preencheu o que era obrigatorio.
 */

type ClienteTx = Prisma.TransactionClient | typeof prisma;

/**
 * Template que responde a uma anamnese: o da terapia quando existe, o
 * padrao da clinica quando nao. Template inativo nao serve: uma versao
 * antiga do formulario nao pode mais receber resposta nova.
 */
export async function resolverTemplate(
  clinicId: string,
  referencia: { therapyId?: string; templateId?: string },
): Promise<{ id: string; schema: unknown }> {
  if (referencia.templateId !== undefined) {
    const template = await prisma.anamnesisTemplate.findFirst({
      where: { id: referencia.templateId, clinicId, isActive: true },
      select: { id: true, schema: true },
    });
    if (template === null) {
      throw new ErroDominio(
        'ANAMNESIS_TEMPLATE_NOT_FOUND',
        404,
        'Formulario de anamnese nao encontrado nesta clinica.',
      );
    }
    return template;
  }

  if (referencia.therapyId !== undefined) {
    const daTerapia = await prisma.therapyAnamnesisTemplate.findFirst({
      where: {
        clinicId,
        therapyId: referencia.therapyId,
        template: { isActive: true },
      },
      select: { template: { select: { id: true, schema: true } } },
    });
    if (daTerapia !== null) return daTerapia.template;
  }

  const padrao = await prisma.anamnesisTemplate.findFirst({
    where: { clinicId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, schema: true },
  });

  if (padrao === null) {
    throw new ErroDominio(
      'ANAMNESIS_TEMPLATE_MISSING',
      422,
      'A clinica ainda nao cadastrou um formulario de anamnese.',
    );
  }

  return padrao;
}

/** `version` seguinte para o cliente. Le fora de transacao quando nao ha uma. */
export async function proximaVersao(
  cliente: ClienteTx,
  clinicId: string,
  clientId: string,
): Promise<number> {
  const ultima = await cliente.anamnesis.findFirst({
    where: { clinicId, clientId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  return (ultima?.version ?? 0) + 1;
}

/**
 * Valida e cifra. Devolve `null` para respostas vazias: um rascunho sem
 * resposta nao vira cifra de "{}" -- a coluna fica nula e `hasAnswers`
 * responde falso.
 */
export function prepararConteudo(
  form: AnamnesisForm,
  templateId: string,
  respostas: AnamnesisAnswers,
): { answersEncrypted: string; contentHash: string } | null {
  const problemas = validarRespostasAnamnesis(form, respostas);

  if (Object.keys(respostas).length > 0 && problemas.length > 0) {
    throw new ErroDominio('ANAMNESIS_ANSWERS_INVALID', 422, problemas.join(' '));
  }

  if (Object.keys(respostas).length === 0) return null;

  const { ciphertext, contentHash } = generateAnamnesisAnswers(
    { templateId, answers: respostas },
    env.ANAMNESIS_ENCRYPTION_KEY,
  );

  return { answersEncrypted: ciphertext, contentHash };
}

/**
 * Decifra conferindo o `contentHash`. `answersEncrypted` nulo (rascunho
 * vazio) devolve objeto vazio, sem erro.
 */
export function revelar(linha: { answersEncrypted: string | null; contentHash: string | null }): {
  templateId: string | null;
  answers: AnamnesisAnswers;
} {
  if (linha.answersEncrypted === null) return { templateId: null, answers: {} };

  try {
    if (
      linha.contentHash !== null &&
      !verifyAnamnesisHash(linha.answersEncrypted, linha.contentHash)
    ) {
      throw new Error('Anamnese adulterada: o hash do conteudo nao confere');
    }

    const { data } = readAnamnesisAnswers(linha.answersEncrypted, env.ANAMNESIS_ENCRYPTION_KEY);
    return {
      templateId: data.templateId,
      answers: (data.answers ?? {}) as AnamnesisAnswers,
    };
  } catch {
    // Prontuario ilegivel e incidente de integridade, nao erro de digitacao
    // do profissional. A mensagem nao carrega dado de saude para o log.
    throw new ErroDominio(
      'ANAMNESIS_INTEGRITY',
      500,
      'Nao foi possivel ler esta anamnese. O registro pode estar corrompido.',
    );
  }
}

/** Versao aprovada mais recente do cliente, a que vale para a proxima sessao. */
export async function anamneseVigente(
  clinicId: string,
  clientId: string,
): Promise<{ id: string; version: number } | null> {
  const linha = await prisma.anamnesis.findFirst({
    where: { clinicId, clientId, status: 'APROVADA' },
    orderBy: { version: 'desc' },
    select: { id: true, version: true },
  });

  return linha;
}
