/**
 * Resolución de mandato POR CANAL, sobre el `MandatoAutonomia` existente (no un mandato paralelo).
 *
 * Permite políticas independientes por (organization, business, canal, externalAccount, actionType):
 * cada mandato lleva su `canal` opaco; la resolución exige coincidencia EXACTA de los cuatro ejes y es
 * fail-closed — nunca devuelve el mandato de otro canal, otra cuenta ni otra organización. La
 * clasificación por acción sigue viviendo en `clasificarAccion` de `@soec/autonomia`.
 */

import type { MandatoAutonomia, NivelAutonomia, TipoAccion, ClaseAccionMandato } from '@soec/autonomia';
import { clasificarAccion } from '@soec/autonomia';

export interface CriterioMandatoCanal {
  readonly organizationId: string;
  readonly businessKey: string;
  readonly canal: string;
  readonly externalAccountId: string;
}

/**
 * Selecciona el mandato ACTIVO que coincide EXACTAMENTE en org+business+canal+cuenta. Devuelve `null`
 * si no hay coincidencia — jamás cae al mandato de otro canal/cuenta/organización.
 */
export function resolverMandatoDeCanal(
  mandatos: readonly MandatoAutonomia[],
  criterio: CriterioMandatoCanal,
): MandatoAutonomia | null {
  const match = mandatos.find(
    (m) =>
      m.organizationId === criterio.organizationId &&
      m.businessKey === criterio.businessKey &&
      m.externalAccountId === criterio.externalAccountId &&
      (m.canal ?? null) === criterio.canal,
  );
  return match ?? null;
}

/** Nivel de autonomía efectivo para un canal; sin mandato, el nivel es el más conservador (observar). */
export function nivelDeCanal(mandatos: readonly MandatoAutonomia[], criterio: CriterioMandatoCanal): NivelAutonomia {
  const m = resolverMandatoDeCanal(mandatos, criterio);
  return m?.nivel ?? 'LEVEL_0_OBSERVE';
}

/**
 * Clasifica una acción para un canal reutilizando `clasificarAccion` del motor existente. Si no hay
 * mandato para ese canal, la acción queda fuera de mandato (fail-closed), sin heredar otro canal.
 */
export function clasificarAccionDeCanal(
  mandatos: readonly MandatoAutonomia[],
  criterio: CriterioMandatoCanal,
  tipo: TipoAccion,
): ClaseAccionMandato {
  const m = resolverMandatoDeCanal(mandatos, criterio);
  if (m === null) return 'NOT_IN_MANDATE';
  return clasificarAccion(m, tipo);
}
