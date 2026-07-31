/**
 * @soec/crm-comercial · dominio · Validación y límites de datos (H-5).
 *
 * Rechaza datos inválidos ANTES de persistir: montos negativos/no finitos, fechas futuras en
 * actividades ya ocurridas, textos y colecciones sin límite. No normaliza en exceso ni afirma
 * validación absoluta de email/teléfono; solo evita basura y strings vacíos como dato significativo.
 */
import { ComandoCrmInvalidoError } from './errors';

export const LIMITES = {
  nombre: 200,
  email: 254,
  telefono: 40,
  texto: 2000, // detalle de actividad, descripción de evidencia, fuente, valor de campo…
  claveAtributo: 60,
  valorAtributo: 2000,
  enunciadoHipotesis: 500,
  contextoHipotesis: 2000,
  descripcionResultado: 2000,
  porQueAprendizaje: 4000,
  maxMonto: 1_000_000_000_000, // 1e12; cota razonable y documentada
  maxActividades: 5000,
  maxEvidencias: 500,
  /** Tolerancia de reloj para fechas de actividad (evita rechazar por desfase menor). */
  toleranciaFuturoMs: 60 * 60 * 1000,
} as const;

/** Monto opcional: null se admite; si hay valor, debe ser finito, ≥0 y ≤ máximo. */
export function validarMonto(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) throw new ComandoCrmInvalidoError('monto no finito (NaN/Infinity) no permitido');
  if (v < 0) throw new ComandoCrmInvalidoError('monto negativo no permitido');
  if (v > LIMITES.maxMonto) throw new ComandoCrmInvalidoError(`monto supera el máximo permitido (${LIMITES.maxMonto})`);
  return v;
}

/** Fecha de una actividad YA OCURRIDA: no puede ser futura (más allá de la tolerancia de reloj). */
export function validarFechaActividad(iso: string, ahoraMs: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new ComandoCrmInvalidoError('fecha de actividad inválida');
  if (t > ahoraMs + LIMITES.toleranciaFuturoMs) throw new ComandoCrmInvalidoError('una actividad ya ocurrida no puede tener fecha futura');
  return iso;
}

/** Texto obligatorio con cota de longitud. */
export function validarTexto(valor: string, max: number, campo: string): string {
  if (typeof valor !== 'string') throw new ComandoCrmInvalidoError(`${campo} inválido`);
  if (valor.length > max) throw new ComandoCrmInvalidoError(`${campo} supera el máximo de ${max} caracteres`);
  return valor;
}

/** Texto opcional: vacío/espacios → null (no se guarda un string vacío como dato). */
export function normalizarOpcional(valor: string | undefined | null, max: number, campo: string): string | null {
  if (valor === undefined || valor === null) return null;
  const t = valor.trim();
  if (t === '') return null;
  return validarTexto(t, max, campo);
}

/** Cota de cardinalidad de una colección antes de agregar un elemento más. */
export function exigirBajoLimite(actual: number, max: number, coleccion: string): void {
  if (actual >= max) throw new ComandoCrmInvalidoError(`${coleccion} alcanzó el máximo de ${max} elementos`);
}
