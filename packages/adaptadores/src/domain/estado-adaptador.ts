/**
 * @soec/adaptadores · dominio · ESTADO DE FRONTERA del adaptador (M4-C, Art. 3/4/8 de la Directiva PCE).
 *
 * Un adaptador real NACE en los cuatro estados seguros: DESACTIVADO · SIMULADO · SIN_CREDENCIAL ·
 * NO_CONSUMIBLE, y sólo avanza por ACTOS HUMANOS AUDITADOS (gobernados por el ciclo de vida de la capacidad
 * en M4-A y por el registro de secretos por referencia en M4-B). Este módulo NO re-deriva consumibilidad
 * de la capacidad: expone la compuerta de frontera `puedeEjecutarReal`, que exige los cuatro avances.
 * El adaptador conoce, a lo sumo, una `secretRef` (referencia opaca) — nunca un valor.
 */
export type Activacion = 'DESACTIVADO' | 'ACTIVADO';
export type ModoAdaptador = 'SIMULADO' | 'REAL';
export type Credencial = 'SIN_CREDENCIAL' | 'CON_CREDENCIAL';
export type Consumo = 'NO_CONSUMIBLE' | 'CONSUMIBLE';

export interface EstadoAdaptador {
  readonly activacion: Activacion;
  readonly modo: ModoAdaptador;
  readonly credencial: Credencial;
  readonly consumo: Consumo;
  /** REFERENCIA opaca al secreto (nunca el valor). Null hasta que un acto auditado la asocia. */
  readonly secretRef: string | null;
}

/** Estado seguro de nacimiento (Art. 8: soberanía humana). */
export function estadoInicialAdaptador(): EstadoAdaptador {
  return { activacion: 'DESACTIVADO', modo: 'SIMULADO', credencial: 'SIN_CREDENCIAL', consumo: 'NO_CONSUMIBLE', secretRef: null };
}

/**
 * Compuerta de frontera para ejecución REAL. Exige los cuatro avances desde el estado de nacimiento.
 * NO reemplaza a `esConsumible` (M4-A): el sandbox valida además la consumibilidad de la capacidad viva.
 */
export function puedeEjecutarReal(e: EstadoAdaptador): { ok: boolean; motivo: string } {
  if (e.activacion !== 'ACTIVADO') return { ok: false, motivo: 'adaptador DESACTIVADO' };
  if (e.modo !== 'REAL') return { ok: false, motivo: 'adaptador en modo SIMULADO' };
  if (e.credencial !== 'CON_CREDENCIAL' || !e.secretRef) return { ok: false, motivo: 'adaptador SIN_CREDENCIAL' };
  if (e.consumo !== 'CONSUMIBLE') return { ok: false, motivo: 'adaptador NO_CONSUMIBLE' };
  return { ok: true, motivo: '' };
}
