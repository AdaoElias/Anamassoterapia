import { createCipheriv, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  generateAnamnesisAnswers,
  readAnamnesisAnswers,
  verifyAnamnesisHash,
} from '../src/lib/anamnesis-crypto.js';

/** 64 caracteres hexadecimais = 32 bytes, o tamanho que o AES-256 exige. */
const KEY = '4f1d2c3b'.repeat(8);
const OUTRA_KEY = 'a1b2c3d4'.repeat(8);

const RESPOSTAS = {
  templateId: '88888888-0000-0000-0000-000000000001',
  answers: {
    dorPrincipal: 'lombar',
    pressao: { sistolica: 128, diastolica: 82 },
    alergias: ['latex', 'iodo'],
    gestante: false,
    observacoes: 'Prefere sombra. Alergia a ãndalas e café — e o medidor marca 12 kg.',
  },
};

interface Partes {
  version: string;
  iv: string;
  tag: string;
  data: string;
}

function separar(payload: string): Partes {
  const [version, iv, tag, data] = payload.split(':');
  return { version: version ?? '', iv: iv ?? '', tag: tag ?? '', data: data ?? '' };
}

function juntar(partes: Partes): string {
  return [partes.version, partes.iv, partes.tag, partes.data].join(':');
}

/**
 * Altera um byte no meio do segmento.
 *
 * Trocar um caractere da base64 seria enganoso: os ultimos bits de um
 * segmento podem ser so preenchimento, e o texto decodificado sairia
 * identico -- a adulteracao passaria sem a GCM reclamar. Mexer no byte
 * garante que a assinatura realmente diverge.
 */
function corromper(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  const copia = Buffer.from(bytes);
  const meio = Math.floor(copia.length / 2);
  copia[meio] = (copia[meio] ?? 0) ^ 0xff;
  return copia.toString('base64');
}

/** Monta um payload valido com um texto livre, para testar o conteudo. */
function montar(plaintext: string, keyHex: string = KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return juntar({
    version: 'v1',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}

describe('anamnesis-crypto', () => {
  it('cifra e decifra devolvendo exatamente o que entrou', () => {
    const { ciphertext } = generateAnamnesisAnswers(RESPOSTAS, KEY);
    const { data, version } = readAnamnesisAnswers(ciphertext, KEY);

    expect(version).toBe('v1');
    expect(data).toEqual(RESPOSTAS);
  });

  it('grava o payload no formato v1:iv:tag:ciphertext', () => {
    const { ciphertext } = generateAnamnesisAnswers(RESPOSTAS, KEY);
    const partes = separar(ciphertext);

    expect(ciphertext.split(':')).toHaveLength(4);
    expect(partes.version).toBe('v1');
    // 96 bits de IV e 128 de tag: e o padrao do NIST para GCM.
    expect(Buffer.from(partes.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(partes.tag, 'base64')).toHaveLength(16);
  });

  it('o plaintext nao aparece no payload', () => {
    const { ciphertext } = generateAnamnesisAnswers(RESPOSTAS, KEY);
    const decodificado = Buffer.from(separar(ciphertext).data, 'base64').toString('utf8');

    expect(decodificado).not.toContain('lombar');
    expect(decodificado).not.toContain(RESPOSTAS.templateId);
  });

  it('o contentHash confere com o payload gerado', () => {
    const { ciphertext, contentHash } = generateAnamnesisAnswers(RESPOSTAS, KEY);

    expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAnamnesisHash(ciphertext, contentHash)).toBe(true);
  });

  it('o contentHash barra assim que o payload muda', () => {
    const { ciphertext, contentHash } = generateAnamnesisAnswers(RESPOSTAS, KEY);
    const partes = separar(ciphertext);

    expect(
      verifyAnamnesisHash(juntar({ ...partes, data: corromper(partes.data) }), contentHash),
    ).toBe(false);
  });

  it('sorteia um IV novo a cada cifragem', () => {
    // Reusar IV com a mesma chave expoe a relacao entre dois textos e
    // quebra a autenticacao. E o erro classico de criptografia em banco.
    const primeiro = generateAnamnesisAnswers(RESPOSTAS, KEY);
    const segundo = generateAnamnesisAnswers(RESPOSTAS, KEY);

    expect(primeiro.ciphertext).not.toBe(segundo.ciphertext);
    expect(primeiro.contentHash).not.toBe(segundo.contentHash);
  });

  it('recusa quando um byte do texto cifrado muda', () => {
    const { ciphertext } = generateAnamnesisAnswers(RESPOSTAS, KEY);
    const partes = separar(ciphertext);

    expect(() =>
      readAnamnesisAnswers(juntar({ ...partes, data: corromper(partes.data) }), KEY),
    ).toThrow();
  });

  it('recusa quando a tag de autenticacao muda', () => {
    const { ciphertext } = generateAnamnesisAnswers(RESPOSTAS, KEY);
    const partes = separar(ciphertext);

    expect(() =>
      readAnamnesisAnswers(juntar({ ...partes, tag: corromper(partes.tag) }), KEY),
    ).toThrow();
  });

  it('recusa chave diferente da que cifrou', () => {
    const { ciphertext } = generateAnamnesisAnswers(RESPOSTAS, KEY);

    expect(() => readAnamnesisAnswers(ciphertext, OUTRA_KEY)).toThrow();
  });

  it('recusa chave de tamanho errado', () => {
    const { ciphertext } = generateAnamnesisAnswers(RESPOSTAS, KEY);

    expect(() => generateAnamnesisAnswers(RESPOSTAS, 'abcd')).toThrow(/32 bytes/);
    expect(() => readAnamnesisAnswers(ciphertext, 'abcd')).toThrow(/32 bytes/);
  });

  it('recusa payload malformado', () => {
    expect(() => readAnamnesisAnswers('v1:somente:duas', KEY)).toThrow(/malformado/);
    expect(() => readAnamnesisAnswers('so-um-segmento', KEY)).toThrow(/malformado/);
    expect(() => readAnamnesisAnswers('', KEY)).toThrow(/malformado/);
  });

  it('recusa versao de payload desconhecida', () => {
    const { ciphertext } = generateAnamnesisAnswers(RESPOSTAS, KEY);
    const partes = separar(ciphertext);

    expect(() => readAnamnesisAnswers(juntar({ ...partes, version: 'v2' }), KEY)).toThrow(
      /nao suportada: v2/,
    );
  });

  it('recusa conteudo que nao e JSON', () => {
    expect(() => readAnamnesisAnswers(montar('isto nao e json'), KEY)).toThrow();
  });

  it('recusa JSON sem templateId', () => {
    expect(() => readAnamnesisAnswers(montar('{"answers":{}}'), KEY)).toThrow(
      /invalido apos decifragem/,
    );
  });

  it('recusa JSON sem answers', () => {
    expect(() => readAnamnesisAnswers(montar('{"templateId":"x"}'), KEY)).toThrow(
      /invalido apos decifragem/,
    );
  });
});
