/**
 * Conversao entre instantes UTC e o horario local da clinica.
 *
 * O banco guarda sempre UTC (`Timestamptz`); o fuso da clinica
 * (`Clinic.timezone`) so existe na apresentacao e no calculo de agenda. Como
 * o projeto nao carrega biblioteca de datas, a conversao usa `Intl`, que ja
 * conhece o historico de horario de verao de cada regiao IANA.
 *
 * O algoritmo e o classico "zoned time to UTC": monta os componentes locais
 * como se fossem UTC, mede o deslocamento do fuso naquele instante e o
 * subtrai. Uma segunda passada cobre a virada de horario de verao, quando o
 * deslocamento do palpite inicial difere do deslocamento real.
 */

export interface ComponentesLocais {
  year: number;
  /** 1 a 12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Componentes de uma data sem horario, como vem de `YYYY-MM-DD`. */
export interface DataLocal {
  year: number;
  month: number;
  day: number;
}

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(timeZone: string): Intl.DateTimeFormat {
  let encontrado = formatadores.get(timeZone);
  if (!encontrado) {
    encontrado = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatadores.set(timeZone, encontrado);
  }
  return encontrado;
}

/** Componentes do instante no fuso informado. */
export function componentesLocais(instante: Date, timeZone: string): ComponentesLocais {
  const partes = formatador(timeZone).formatToParts(instante);
  const valores: Record<string, number> = {};
  for (const parte of partes) {
    if (parte.type !== 'literal') valores[parte.type] = Number(parte.value);
  }
  return {
    year: valores.year ?? 0,
    month: valores.month ?? 1,
    day: valores.day ?? 1,
    hour: valores.hour ?? 0,
    minute: valores.minute ?? 0,
    second: valores.second ?? 0,
  };
}

/** Deslocamento do fuso, em milissegundos, no instante informado. */
function deslocamentoMillis(instante: Date, timeZone: string): number {
  const c = componentesLocais(instante, timeZone);
  const comoUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  const semMillis = instante.getTime() - (instante.getTime() % 1000);
  return comoUtc - semMillis;
}

/** Data + horario local da clinica para o instante UTC correspondente. */
export function utcDeLocal(
  local: DataLocal & { hour?: number; minute?: number },
  timeZone: string,
): Date {
  const hora = local.hour ?? 0;
  const minuto = local.minute ?? 0;
  const tentativa = Date.UTC(local.year, local.month - 1, local.day, hora, minuto, 0, 0);
  const palpite = new Date(tentativa);
  const primeiro = deslocamentoMillis(palpite, timeZone);
  let resultado = new Date(tentativa - primeiro);
  const segundo = deslocamentoMillis(resultado, timeZone);
  if (segundo !== primeiro) resultado = new Date(tentativa - segundo);
  return resultado;
}

/** `YYYY-MM-DD` a partir de componentes de data. */
export function paraTextoData(data: DataLocal): string {
  return `${String(data.year).padStart(4, '0')}-${String(data.month).padStart(2, '0')}-${String(
    data.day,
  ).padStart(2, '0')}`;
}

/** Le `YYYY-MM-DD` para componentes de data. */
export function parseDataLocal(data: string): DataLocal {
  const [ano, mes, dia] = data.split('-').map(Number);
  return { year: ano ?? 0, month: mes ?? 1, day: dia ?? 1 };
}

/** Data civil (`YYYY-MM-DD`) do instante no fuso da clinica. */
export function dataLocal(instante: Date, timeZone: string): string {
  const c = componentesLocais(instante, timeZone);
  return paraTextoData(c);
}

/** Minutos desde a meia-noite do instante no fuso da clinica. */
export function minutosLocais(instante: Date, timeZone: string): number {
  const c = componentesLocais(instante, timeZone);
  return c.hour * 60 + c.minute;
}

/** Dia da semana (0 = domingo) de uma data civil. */
export function diaDaSemanaDaData(data: string): number {
  const { year, month, day } = parseDataLocal(data);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Dia da semana (0 = domingo) do instante no fuso da clinica. */
export function diaDaSemanaLocal(instante: Date, timeZone: string): number {
  return diaDaSemanaDaData(dataLocal(instante, timeZone));
}

/** Soma dias a uma data civil, respeitando meses e anos. */
export function adicionarDias(data: string, dias: number): string {
  const { year, month, day } = parseDataLocal(data);
  const instante = new Date(Date.UTC(year, month - 1, day));
  instante.setUTCDate(instante.getUTCDate() + dias);
  return paraTextoData({
    year: instante.getUTCFullYear(),
    month: instante.getUTCMonth() + 1,
    day: instante.getUTCDate(),
  });
}

/** Todas as datas civis de `de` a `ate`, inclusive. */
export function intervaloDeDatas(de: string, ate: string): string[] {
  const datas: string[] = [];
  let atual = de;
  while (atual <= ate) {
    datas.push(atual);
    atual = adicionarDias(atual, 1);
  }
  return datas;
}

/** Numero de dias entre duas datas civis, inclusive nas duas pontas. */
export function diasEntre(de: string, ate: string): number {
  let dias = 0;
  let atual = de;
  while (atual < ate) {
    atual = adicionarDias(atual, 1);
    dias += 1;
  }
  return dias + 1;
}

export const ROTULOS_DIA_SEMANA = [
  'Domingo',
  'Segunda',
  'Terca',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sabado',
] as const;

/** `540` -> `09:00`. */
export function minutosParaHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `09:00` -> `540`. Nulo quando o texto nao e um horario valido. */
export function horaParaMinutos(hora: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}
