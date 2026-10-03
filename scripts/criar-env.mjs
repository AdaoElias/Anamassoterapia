import { randomBytes } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Cria o `.env` a partir do `.env.example` com segredos aleatorios.
 *
 * Existe por dois motivos, ambos práticos:
 *
 * 1. O `.env.example` precisa ser válido o suficiente para documentar, e
 *    nenhum segredo real serve para isso. Mas copiar o arquivo e rodar a
 *    aplicacao direto **nao funciona**: `ANAMNESIS_ENCRYPTION_KEY` no
 *    exemplo nao e hexadecimal, e o `env.ts` rejeita no bootstrap. Sem
 *    esta etapa, o primeiro "pnpm dev" morre com um erro de configuracao
 *    que parece自己没有 nada a ver com o duplo clique.
 *
 * 2. Segredo em arquivo de exemplo e segredo conhecido. Se o `.env` de
 *    desenvolvimento fosse para o GitHub -- e `.env` e gitignored, mas
 *    gitignored nao e backup -- qualquer pessoa com o repositorio assinaria
 *    token em nome de qualquer cliente. A chave da anamnese e o pior caso:
 *    sem ela, o conteudo cifrado das respostas nunca mais e legivel.
 *
 * Os valores sao hex, sem `!`, `%` ou aspas, porque o resultado e
 * consumido por `dotenv` e por shells diferentes.
 */

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEM = resolve(RAIZ, '.env.example');
const DESTINO = resolve(RAIZ, '.env');

/** Segredos gerados: chave -> tamanho em bytes. */
const SEGREDOS = {
  // 32 bytes = 64 hex, o tamanho que o AES-256 exige.
  ANAMNESIS_ENCRYPTION_KEY: 32,
  // O `env.ts` exige no minimo 32 caracteres e que as duas sejam diferentes.
  JWT_ACCESS_SECRET: 32,
  JWT_REFRESH_SECRET: 32,
};

/**
 * @param {number} bytes
 * @returns {string}
 */
function hex(bytes) {
  return randomBytes(bytes).toString('hex');
}

async function main() {
  await copyFile(ORIGEM, DESTINO);
  const original = await readFile(DESTINO, 'utf8');

  const substituicoes = Object.entries(SEGREDOS).map(([chave, bytes]) => [
    chave,
    `"${hex(bytes)}"`,
  ]);

  const resultado = substituicoes.reduce((texto, [chave, valor]) => {
    // ^...$ com flag m: troca a linha inteira, mantendo o comentario e a
    // ordem do arquivo. Fazer replace solto no valor deixaria o placeholder
    // visivel ao lado do segredo.
    const padrao = new RegExp(`^${chave}=.*$`, 'm');
    if (!padrao.test(texto)) {
      throw new Error(`Chave ${chave} nao encontrada no .env.example`);
    }
    return texto.replace(padrao, `${chave}=${valor}`);
  }, original);

  await writeFile(DESTINO, resultado, 'utf8');

  console.log('   .env criado a partir do .env.example');
  for (const [chave] of substituicoes) {
    console.log(`     ${chave} = <${SEGREDOS[chave] * 2} caracteres hex aleatorios>`);
  }
  console.log('   O arquivo e gitignored: estes segredos nao vao para o repositorio.');
}

try {
  await main();
} catch (erro) {
  // `instanceof` e o unico jeito de estreitar aqui: sem tsconfig na raiz o
  // TS nao liga `useUnknownInCatchVariables`, e `catch (erro)` fica `any`.
  const detalhe = erro instanceof Error ? erro.message : String(erro);
  console.error(`   Falha ao criar o .env: ${detalhe}`);
  process.exit(1);
}
