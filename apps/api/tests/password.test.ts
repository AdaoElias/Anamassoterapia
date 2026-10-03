import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../src/lib/password.js';

/**
 * Argon2id.
 *
 * Sao poucos casos de proposito: o que se verifica aqui e o contrato entre
 * `hashPassword` e `verifyPassword`, nao a resistencia do Argon2 (que e da
 * biblioteca). O teste que importa de verdade e o do hash corrompido, porque
 * um `verify` que lanca vira 500 no login e entrega ao atacante a informacao
 * de que a conta existe.
 */

describe('hashPassword', () => {
  it('nunca devolve a senha em claro', async () => {
    const senha = 'Wave@2026';
    const hash = await hashPassword(senha);

    expect(hash).not.toContain(senha);
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('gera hash diferente a cada chamada, com salt novo', async () => {
    const hash1 = await hashPassword('mesma-senha');
    const hash2 = await hashPassword('mesma-senha');

    // Salts iguais transformariam todo usuario com a mesma senha num hash
    // identico: um dump do banco revelaria quem usa a mesma senha.
    expect(hash1).not.toBe(hash2);
  });
});

describe('verifyPassword', () => {
  it('aceita a senha correta', async () => {
    const hash = await hashPassword('Wave@2026');
    await expect(verifyPassword(hash, 'Wave@2026')).resolves.toBe(true);
  });

  it('recusa senha errada', async () => {
    const hash = await hashPassword('Wave@2026');
    await expect(verifyPassword(hash, 'Wave@2025')).resolves.toBe(false);
    await expect(verifyPassword(hash, 'wave@2026')).resolves.toBe(false);
    await expect(verifyPassword(hash, '')).resolves.toBe(false);
  });

  it('devolve false, e nao lanca, para hash corrompido', async () => {
    // Um throw aqui viraria 500 no login. Alem de quebrar o usuario, o 500
    // distingue "conta existe com hash quebrado" de "senha errada" -- que e
    // exatamente o que o login precisa esconder.
    await expect(verifyPassword('nao-e-um-hash', 'Wave@2026')).resolves.toBe(false);
    await expect(verifyPassword('', 'Wave@2026')).resolves.toBe(false);
    await expect(
      verifyPassword('$argon2id$v=19$m=1,t=1,p=1$c2FsdA$abc', 'Wave@2026'),
    ).resolves.toBe(false);
  });

  it('recusa hash de outro algoritmo sem lancar', async () => {
    // bcrypt em um banco migrado para argon2: precisa falhar, nao estourar.
    const bcryptFake = '$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV';
    await expect(verifyPassword(bcryptFake, 'Wave@2026')).resolves.toBe(false);
  });
});
