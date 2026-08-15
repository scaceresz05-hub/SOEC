/**
 * AcquisitionChannel — el canal por el que se genera demanda, tipado y provider-neutral.
 *
 * Hoy los canales viven como strings sueltos en varias capas (`canales`, `marketing`, `plataforma`).
 * Este módulo introduce el ENUM tipado que el motor de adquisición necesita para razonar sin
 * `if canal === 'meta_ads'` dispersos. El dominio NO asume que un canal esté conectado: cada canal
 * tiene un estado explícito y "no conectado" nunca equivale a "cero".
 */

export type CanalAdquisicion =
  | 'GOOGLE_SEARCH'
  | 'META_FACEBOOK'
  | 'META_INSTAGRAM'
  | 'ORGANIC_FACEBOOK'
  | 'ORGANIC_INSTAGRAM'
  | 'WEBSITE'
  | 'EMAIL'
  | 'WHATSAPP';

export const CANALES_ADQUISICION: readonly CanalAdquisicion[] = [
  'GOOGLE_SEARCH',
  'META_FACEBOOK',
  'META_INSTAGRAM',
  'ORGANIC_FACEBOOK',
  'ORGANIC_INSTAGRAM',
  'WEBSITE',
  'EMAIL',
  'WHATSAPP',
] as const;

/** Naturaleza de la distribución: pagada (inversión publicitaria) u orgánica. */
export type NaturalezaCanal = 'PAID' | 'ORGANIC';

const CANALES_PAGADOS: readonly CanalAdquisicion[] = ['GOOGLE_SEARCH', 'META_FACEBOOK', 'META_INSTAGRAM'];

export function naturalezaDeCanal(canal: CanalAdquisicion): NaturalezaCanal {
  return CANALES_PAGADOS.includes(canal) ? 'PAID' : 'ORGANIC';
}

export function esCanalPagado(canal: CanalAdquisicion): boolean {
  return naturalezaDeCanal(canal) === 'PAID';
}

/**
 * Estado de conexión/preparación del canal. Extiende la semántica de `EstadoFuente` de la
 * plataforma con el eje SHADOW/REAL que exige la autonomía. `UNKNOWN != ZERO`: un canal
 * `NOT_CONFIGURED` no tiene métricas cero, simplemente no está instrumentado.
 */
export type EstadoCanal =
  | 'NOT_CONFIGURED'
  | 'CREDENTIALS_REQUIRED'
  | 'CONNECTED_READ_ONLY'
  | 'CONNECTED_WRITE_DISABLED'
  | 'SHADOW_READY'
  | 'REAL_READY'
  | 'ERROR'
  | 'PAUSED';

/** Estados en los que ya existe lectura real de datos del canal. */
const ESTADOS_CON_LECTURA: readonly EstadoCanal[] = [
  'CONNECTED_READ_ONLY',
  'CONNECTED_WRITE_DISABLED',
  'SHADOW_READY',
  'REAL_READY',
];

export function canalTieneLectura(estado: EstadoCanal): boolean {
  return ESTADOS_CON_LECTURA.includes(estado);
}

/**
 * Si un canal NO tiene lectura, su volumen de resultados es DESCONOCIDO, jamás 0. Esta función
 * hace explícita la regla en el tipo de retorno.
 */
export function volumenObservable(estado: EstadoCanal, n: number): number | null {
  return canalTieneLectura(estado) ? n : null;
}
