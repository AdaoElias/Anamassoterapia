import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { env } from '../src/config/env.js';

/**
 * Roda `prisma/verify/constraints.sql` e derruba o processo se alguma
 * verificacao falhar.
 *
 * Existe porque o script imprime o resultado em `RAISE NOTICE`, e NOTICE
 * nao afeta exit code. Rodado num pipeline, o CI passaria com "FALHOU"
 * scrollsando no meio do log. Aqui o DO block continua sendo quem conta
 * as falhas e lanca excecao no fim; o runner so precisa transformar essa
 * excecao em codigo de saida != 0 e devolver as linhas do NOTICE para o
 * terminal.
 *
 * Sem `psql` na maquina, o driver `pg` e o executor. As mensagens sao
 * capturadas pelo evento `notice` do Client, que o node-postgres emite
 * para cada NOTICE/RAISE do servidor.
 */

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO = resolve(RAIZ, 'prisma/verify/constraints.sql');

/**
 * Verificar no banco de dev seria perigoso se o arquivo parasse de fazer
 * rollback, e inutil para o fluxo normal: quem verifica constraint quer
 * saber do schema recem-migrado, que e o de teste. `DATABASE_URL` fica
 * como reserva para quem roda isso no CI, onde nao ha banco de dev.
 */
function urlAlvo(): string {
  return process.env['TEST_DATABASE_URL'] ?? env.DATABASE_URL;
}

function nomeDoBanco(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

async function main(): Promise<void> {
  const url = urlAlvo();
  const banco = nomeDoBanco(url);
  const sql = await readFile(ARQUIVO, 'utf8');

  const client = new Client({ connectionString: url, application_name: 'massoterapia_verify' });
  const linhas: string[] = [];

  client.on('notice', (notice) => {
    // `message` e opcional no tipo do driver: um NOTICE sem corpo nao tem
    // o que ser impresso.
    if (notice.message !== undefined && notice.message !== '') {
      linhas.push(notice.message);
    }
  });

  await client.connect();
  console.log(`Verificando constraints em "${banco}"...`);
  console.log('');

  try {
    await client.query(sql);
  } catch (erro) {
    for (const linha of linhas) {
      console.log(linha);
    }
    console.error('');
    console.error(`FALHOU em "${banco}": ${(erro as Error).message}`);
    process.exitCode = 1;
    return;
  } finally {
    await client.end();
  }

  for (const linha of linhas) {
    console.log(linha);
  }

  const passaram = linhas.filter((linha) => linha.startsWith('OK ')).length;
  console.error('');
  console.error(`${passaram} verificacoes passaram em "${banco}".`);
}

await main();
