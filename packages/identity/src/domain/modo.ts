/**
 * @soec/identity · dominio · Modo operativo de una organización.
 *
 * PILOT: datos internos no sensibles, canales externos deshabilitados, presupuesto/resultados/ROI
 *   simulados.
 * SUPERVISED_REAL: estrategia/campañas/contenidos reales en borrador, datos internos autorizados,
 *   aprobación humana obligatoria; SIN publicación/envío/gasto/mutación externa aún.
 * AUTONOMOUS_REAL: BLOQUEADO por dominio (NOT_AVAILABLE) hasta macrobloques futuros.
 */
export type OperationalMode = 'PILOT' | 'SUPERVISED_REAL' | 'AUTONOMOUS_REAL';

export const MODOS: readonly OperationalMode[] = ['PILOT', 'SUPERVISED_REAL', 'AUTONOMOUS_REAL'];

export function esModo(v: string): v is OperationalMode {
  return (MODOS as readonly string[]).includes(v);
}

/** AUTONOMOUS_REAL no puede activarse en esta etapa: la política lo rechaza. */
export function modoActivable(modo: OperationalMode): { ok: boolean; motivo: string } {
  if (modo === 'AUTONOMOUS_REAL') return { ok: false, motivo: 'AUTONOMOUS_REAL: NOT_AVAILABLE en esta versión' };
  return { ok: true, motivo: 'modo activable' };
}
