/**
 * @soec/motor-creativo · dominio · VIGENCIA / OBSOLESCENCIA de artefactos respecto de M5.
 *
 * Un artefacto creativo (brief, estrategia, pieza) referencia afirmaciones de M5 por id+versión. Antes de
 * usar, aprobar, variar o calendarizar, se compara la versión referenciada contra la ACTUAL de M5. Si
 * cambió (o desapareció), el artefacto está OBSOLETO. Puro y determinista; el servicio provee las
 * versiones actuales leyéndolas de M5.
 */
export interface RefVersionada {
  readonly afirmacionId: string;
  readonly version: number;
}

/** Referencias cuya versión actual difiere de la referenciada (o desaparecieron). */
export function desajustesVersiones(
  refs: readonly RefVersionada[],
  versionesActuales: Readonly<Record<string, number>>,
): readonly RefVersionada[] {
  return refs.filter((r) => {
    const actual = Object.prototype.hasOwnProperty.call(versionesActuales, r.afirmacionId)
      ? versionesActuales[r.afirmacionId]!
      : null;
    return actual === null || actual !== r.version;
  });
}

export type Vigencia = 'VIGENTE' | 'OBSOLETO';

export function estadoVigencia(
  refs: readonly RefVersionada[],
  versionesActuales: Readonly<Record<string, number>>,
): Vigencia {
  return desajustesVersiones(refs, versionesActuales).length > 0 ? 'OBSOLETO' : 'VIGENTE';
}

/** Suma de versiones referenciadas: huella barata para detectar cambios de conocimiento agregados. */
export function versionConocimiento(refs: readonly RefVersionada[]): number {
  return refs.reduce((acc, r) => acc + r.version, 0);
}
