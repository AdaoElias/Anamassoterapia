import type { Algorithm } from '@node-rs/argon2';
import { hash, verify } from '@node-rs/argon2';

import { env } from '../config/env.js';

/**
 * Hash de senha com Argon2id.
 *
 * Argon2id em vez de bcrypt ou PBKDF2 porque e resistente a GPU e a ASIC:
 * bcrypt tem custo fixo de 72 bytes e PBKDF2 depende de milhao de iteracoes
 * -- os dois sao fracos em hardware dedicado, que e exatamente o hardware de
 * quem ataca um banco vazado.
 *
 * Os parametros vem do `.env` (`ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`) para
 * poder subir o custo sem mexer em codigo quando o hardware melhora. O hash
 * aqui e o mesmo que o seed usa: um hash de senha gerado em dois lugares, com
 * parametros diferentes, e um bug que so apareceria no login -- e o seed era o
 * unico lugar que gerava hash antes deste arquivo existir.
 */

/**
 * `Algorithm` e `const enum` no pacote e `const enum` nao sobrevive a
 * `isolatedModules`, entao escrever `Algorithm.Argon2id` quebra a
 * compilacao com TS2748. O valor numerico e o mesmo (2 = Argon2id) e
 * continua checado contra o tipo `Algorithm`: se um upgrade do pacote mudar
 * o numero, a atribuicao deixa de compilar em vez de gerar hash com o
 * algoritmo errado em producao. Mesma abordagem do `prisma/seed.ts`.
 */
const ARGON2_ID: Algorithm = 2;

/**
 * Parametros identicos em `hashPassword` e em `verifyPassword`.
 *
 * `parallelism: 1` esta explicito porque o seed usava 1 e o default da
 * biblioteca tambem e 1: deixar a cargo do default seria torcer para que
 * ninguem mude o default da lib. Os parametros entram no texto do hash, e
 * verificar com parametros diferentes do que foi usado para gerar devolve
 * falso para senha correta -- o pior tipo de bug de autenticacao, porque o
 * sintoma e "todo mundo perdeu a senha".
 */
function options() {
  return {
    algorithm: ARGON2_ID,
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: 1,
  };
}

export async function hashPassword(senha: string): Promise<string> {
  return hash(senha, options());
}

/**
 * Confere a senha contra o hash guardado.
 *
 * Devolve `false` em vez de lancar quando o hash esta corrompido ou usa
 * outro algoritmo: um login precisa falhar do mesmo jeito para "senha
 * errada" e para "usuario nao existe", e um erro aqui viraria 500 -- que
 * diz ao atacante que a conta existe.
 */
export async function verifyPassword(hashGuardado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, senha, options());
  } catch {
    return false;
  }
}
