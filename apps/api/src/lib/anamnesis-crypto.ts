import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifragem do conteudo da anamnese (AES-256-GCM).
 *
 * Por que cifrar em vez de guardar em texto:
 *  - dado de saude e dado pessoal sensivel (LGPD, art. 5 II e XI). Um
 *    dump do banco que vaza e um prontuario de centenas de pessoas na
 *    mão de quem nao tem por que ver.
 *  - SELECT de metadados continua possivel: status, versao, quem
 *    revisou, quando. So a resposta some.
 *
 * Por que GCM e nao CBC: GCM traz autenticacao embutida. Alterar um
 * byte do texto cifrado faz a decifragem falhar em vez de devolver
 * lixo -- e a assinatura da chave nao pode ser reaproveitada.
 *
 * Por que o `templateId` entra dentro da cifra: o JSON Schema do
 * formulario pode mudar depois. Com o template amarrado a versao da
 * resposta, da para descifrar um registro antigo e saber com qual
 * formulario ele foi respondido.
 */

/** 96 bits. Padrao do NIST para GCM; 12 bytes, nao 16. */
const IV_BYTES = 12;
/** Prefixo do valor persistido, para o algoritmo poder mudar no futuro. */
const PAYLOAD_PREFIX = 'v1';

export interface AnamnesisAnswers {
  templateId: string;
  answers: Record<string, unknown>;
}

export interface EncryptedPayload {
  /** `v1:<iv base64>:<tag base64>:<ciphertext base64>` */
  ciphertext: string;
  /** SHA-256 do texto cifrado, hex. Detecta alteracao sem decifrar. */
  contentHash: string;
}

function keyFromHex(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error(`Chave de cifragem invalida: esperado 32 bytes, recebido ${key.length}`);
  }
  return key;
}

/**
 * Cifra as respostas e devolve o `contentHash` junto.
 *
 * O IV e sorteado a cada chamada. Reusar IV em GCM com a mesma chave
 * expoe a relacao entre dois textos e quebra a autenticacao -- nao e
 * detalhe, e o erro classico de criptografia em banco.
 */
export function generateAnamnesisAnswers(
  input: AnamnesisAnswers,
  keyHex: string,
): EncryptedPayload {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFromHex(keyHex), iv);

  const plaintext = JSON.stringify(input);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  const payload = [
    PAYLOAD_PREFIX,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join(':');

  return {
    ciphertext: payload,
    contentHash: createHash('sha256').update(payload).digest('hex'),
  };
}

/**
 * Decifra e valida a autenticacao.
 *
 * Lanca em qualquer adulteracao. Quem chama decide o que fazer -- para o
 * fluxo normal, erro de integridade precisa virar 500 e alerta, nunca
 * um formulario parcialmente preenchido com dado manipulado.
 */
export function readAnamnesisAnswers(
  payload: string,
  keyHex: string,
): { version: string; data: AnamnesisAnswers } {
  const parts = payload.split(':');
  if (parts.length !== 4) {
    throw new Error('Payload de anamnese malformado');
  }

  const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  if (version !== PAYLOAD_PREFIX) {
    throw new Error(`Versao de payload de anamnese nao suportada: ${version}`);
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFromHex(keyHex),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);

  const parsed: unknown = JSON.parse(decrypted.toString('utf8'));

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('templateId' in parsed) ||
    !('answers' in parsed)
  ) {
    throw new Error('Conteudo de anamnese invalido apos decifragem');
  }

  return { version, data: parsed as AnamnesisAnswers };
}

/** Confere o hash guardado contra o payload, sem decifrar. */
export function verifyAnamnesisHash(payload: string, expectedHash: string): boolean {
  return createHash('sha256').update(payload).digest('hex') === expectedHash;
}
