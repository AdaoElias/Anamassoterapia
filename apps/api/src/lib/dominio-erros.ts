/**
 * Erro de dominio com resposta HTTP ja decidida.
 *
 * Existe para o handler global nao ter que conhecer regra de negocio: o
 * servico diz o que aconteceu (`codigo`) e qual o status, e a rota so
 * repassa. Sem isso, cada "nao ha template de anamnese para esta terapia"
 * voltaria como 500 -- que e mentira para quem esta usando o painel.
 */
export class ErroDominio extends Error {
  constructor(
    readonly codigo: string,
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroDominio';
  }

  toJSON(): { error: string; message: string } {
    return { error: this.codigo, message: this.message };
  }
}

export function ehErroDominio(error: unknown): error is ErroDominio {
  return error instanceof ErroDominio;
}
