/**
 * Consentimento de comunicacao, como bitmap.
 *
 * `User.consentFlags` guarda um inteiro, nao duas colunas booleanas: revogar
 * um aceite e uma operacao de bit a bit, e o registro do que foi autorizado
 * deixa de depender de um par de colunas que precisam andar sempre juntas.
 * O bitmap tambem deixa obvio que os consentimentos sao independentes --
 * aceitar marketing nao implica aceitar WhatsApp, e vice-versa.
 *
 * O cliente convidado pelo portal (`Client`, sem login) nao tem bitmap: tem
 * `marketingOptIn`. Para ele o aceite do portal vale como as duas flags,
 * porque foi o unico texto que ele viu antes de autorizar.
 */
export const CONSENT_FLAG_MARKETING = 1;
export const CONSENT_FLAG_WHATSAPP = 2;

export type ConsentFlag = typeof CONSENT_FLAG_MARKETING | typeof CONSENT_FLAG_WHATSAPP;

export const CONSENT_FLAG_LABELS: Record<ConsentFlag, string> = {
  [CONSENT_FLAG_MARKETING]: 'Receber ofertas e novidades',
  [CONSENT_FLAG_WHATSAPP]: 'Receber comunicacoes por WhatsApp',
};

export function temConsentimento(flags: number, flag: ConsentFlag): boolean {
  return (flags & flag) === flag;
}

export function concedeConsentimento(flags: number, flag: ConsentFlag): number {
  return flags | flag;
}

export function revogaConsentimento(flags: number, flag: ConsentFlag): number {
  return flags & ~flag;
}

/** Todas as flags conhecidas, para validar um bitmap lido do banco. */
export const CONSENT_FLAGS: readonly ConsentFlag[] = [
  CONSENT_FLAG_MARKETING,
  CONSENT_FLAG_WHATSAPP,
];
