/**
 * Validades e normalizadores de dados brasileiros.
 *
 * Regra: normalizar ANTES de persistir (uppercase, sem pontuacao) e
 * validar DEPOIS. Assim o banco nunca guarda "123.456.789-09" e "12345678909"
 * como duas pessoas diferentes.
 */

/** Remove tudo que nao for digito. */
export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

function isRepeatedDigit(value: string): boolean {
  return /^(\d)\1+$/.test(value);
}

/** Valida CPF pelos digitos verificadores. Retorna os 11 digitos normalizados. */
export function normalizeCpf(value: string): string | null {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || isRepeatedDigit(cpf)) return null;

  for (const [length, position] of [
    [9, 9],
    [10, 10],
  ] as const) {
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += Number(cpf[i]) * (length + 1 - i);
    }
    const rest = (sum * 10) % 11;
    const checkDigit = rest === 10 ? 0 : rest;
    if (checkDigit !== Number(cpf[position])) return null;
  }

  return cpf;
}

export function isValidCpf(value: string): boolean {
  return normalizeCpf(value) !== null;
}

/** Valida CNPJ pelos digitos verificadores. Retorna os 14 digitos normalizados. */
export function normalizeCnpj(value: string): string | null {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || isRepeatedDigit(cnpj)) return null;

  const weightsFirst = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weightsSecond = [6, ...weightsFirst];

  const digitAt = (weights: number[]): number => {
    const sum = weights.reduce((acc, weight, index) => acc + Number(cnpj[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  if (digitAt(weightsFirst) !== Number(cnpj[12])) return null;
  if (digitAt(weightsSecond) !== Number(cnpj[13])) return null;

  return cnpj;
}

export function isValidCnpj(value: string): boolean {
  return normalizeCnpj(value) !== null;
}

/** Aceita CPF (11) ou CNPJ (14) e devolve o documento normalizado. */
export function normalizeBrazilianDocument(value: string): string | null {
  const digits = onlyDigits(value);
  if (digits.length === 11) return normalizeCpf(digits);
  if (digits.length === 14) return normalizeCnpj(digits);
  return null;
}

/**
 * Telefone brasileiro em E.164 sem '+': 5511987654321.
 *
 * Dois formatos aceitos, sem adivinhacao:
 *   - 11 digitos = DDD + 9 + 8 (celular, regra vigente desde 2016)
 *   - 10 digitos = DDD + 8      (fixo)
 *
 * Nao tentamos inserir o nono digito num numero de 10 digitos: essa
 * posicao era ambigua antes de 2016 e inferir errado grava telefone
 * incorreto no cadastro -- custo de suporte e ligacao perdida.
 */
export function normalizeBrazilianPhone(value: string): string | null {
  let digits = onlyDigits(value);
  if (digits.length === 0) return null;

  // DDI 55. So remove quando sobra um numero brasileiro valido de
  // 10 ou 11 digitos, para nao comer o DDD de um numero invalido.
  if (digits.startsWith('55') && digits.length > 11) {
    const withoutCountryCode = digits.slice(2);
    if (withoutCountryCode.length === 10 || withoutCountryCode.length === 11) {
      digits = withoutCountryCode;
    }
  }

  // DDD valido: 11-19 ou 20-99. Nunca comeca com zero.
  if (!/^(?:1[1-9]|[2-9]\d)$/.test(digits.slice(0, 2))) return null;

  // Celular precisa ter o nono digito na posicao 3.
  if (digits.length === 11 && digits[2] !== '9') return null;

  if (digits.length !== 10 && digits.length !== 11) return null;

  return `55${digits}`;
}

export function isValidBrazilianPhone(value: string): boolean {
  return normalizeBrazilianPhone(value) !== null;
}

/** CEP para 8 digitos, apenas quando numerico. */
export function normalizeCep(value: string): string | null {
  const cep = onlyDigits(value);
  return cep.length === 8 ? cep : null;
}

/**
 * Remove acentos, caixa e espacos redundantes: " João  Ábaco " -> "JOAO ABACO".
 * Usado em busca, onde "Joao" e "joão" precisam colidir no mesmo resultado.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
