/**
 * Catálogos base y validación de catálogos EXTENSIBLES (F2-CTRL-HARD-01). Los tipos de
 * decisión y de alerta son catálogos abiertos: un departamento futuro puede registrar
 * sus propios valores SIN modificar @soec/control. El núcleo valida FORMATO, no
 * membresía: no necesita conocer cada valor de marketing para funcionar. Los valores
 * conocidos viven aquí como catálogo base DOCUMENTADO, claramente separado de las
 * primitivas centrales (salud/pausa/decisión/buzón).
 *
 * Los ESTADOS (pendiente/aprobada/…; abierta/atendida/…) permanecen como uniones
 * CERRADAS en sus módulos: no son catálogos extensibles.
 *
 * Decisión de diseño registrada: el puerto universal «Módulo de operación» se DIFIERE
 * hasta disponer de un segundo departamento real; la abstracción se extraerá de dos
 * consumidores, no de una proyección especulativa.
 */

/** Catálogo base de tipos de decisión del departamento de marketing (documentado, no exhaustivo). */
export const CATALOGO_DECISION_MARKETING = [
  'escalamiento_frecuencia',
  'aumento_presupuesto',
  'habilitar_canal',
  'afirmacion_sensible',
  'activo_no_validado',
  'reanudar_tras_anomalia',
  'cambio_modo',
  'habilitar_cuenta',
  'retiro_masivo',
] as const;

/** Catálogo base de tipos de alerta del departamento de marketing (documentado, no exhaustivo). */
export const CATALOGO_ALERTA_MARKETING = [
  'presupuesto',
  'gasto_anomalo',
  'publicacion_fallida',
  'publicacion_desconocida',
  'credencial',
  'canal',
  'activo',
  'politica',
  'contenido',
  'metrica',
  'evidencia',
  'optimizacion',
  'vencimiento',
] as const;

/** Formato de un valor de catálogo extensible: minúsculas, dígitos y guion bajo, 3–48 chars. */
const RE_CATALOGO = /^[a-z][a-z0-9_]{2,48}$/;

/** Valida el FORMATO de un tipo de catálogo (no la membresía). Rechaza vacíos y malformados. */
export function esTipoCatalogoValido(v: string): boolean {
  return typeof v === 'string' && RE_CATALOGO.test(v);
}
export const esTipoDecisionValido = esTipoCatalogoValido;
export const esTipoAlertaValido = esTipoCatalogoValido;

/** Constructor validado (branded-lite): garantiza formato en el borde; lanza si es inválido. */
export function tipoCatalogo(v: string): string {
  if (!esTipoCatalogoValido(v)) throw new Error(`Tipo de catálogo inválido: '${v}'`);
  return v;
}
