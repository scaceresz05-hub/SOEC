/**
 * apps/api · CAPA DE COMPOSICIÓN · COMPATIBILIDAD: servicio de ingesta Growth de SmileFlow.
 *
 * El servicio real vive ahora en `ingesta-growth-service.ts` y es agnóstico de proveedor: el `provider` lo
 * aporta la fuente registrada de cada organización, y con él se derivan la atribución, el id de observación
 * y el stream de cursor.
 *
 * Esta subclase conserva el punto de entrada histórico de SmileFlow: si no se indica `provider`, usa el de
 * su fuente registrada (`smileflow-growth`), de modo que el stream de cursor sigue siendo exactamente
 * `ingesta-cursor:smileflow-growth:<org>` y no hay migración de estado ni reingesta.
 */
import { IngestaGrowth, type DependenciasIngestaGrowth } from './ingesta-growth-service';
import { ORG_SMILEFLOW } from '../plataforma/identidad-organizacion';
import { PROVIDER_GROWTH_SMILEFLOW } from '../plataforma/negocios/org-smileflow';

export type { ResumenIngesta } from './ingesta-growth-service';
export type DependenciasIngestaSmileFlow = Omit<DependenciasIngestaGrowth, 'provider'> & {
  readonly provider?: string;
};

export class IngestaSmileFlowGrowth extends IngestaGrowth {
  constructor(deps: DependenciasIngestaSmileFlow) {
    // El provider por defecto es de SmileFlow: prestárselo a otra organización escribiría sus eventos
    // bajo la identidad y el espacio de idempotencia de SmileFlow. Otras organizaciones usan
    // `IngestaGrowth` con el provider de SU fuente registrada.
    if (deps.provider === undefined && deps.org !== ORG_SMILEFLOW) {
      throw new Error(
        `IngestaSmileFlowGrowth: '${deps.org}' no es org-smileflow; use IngestaGrowth con el provider de su fuente registrada`,
      );
    }
    super({ ...deps, provider: deps.provider ?? PROVIDER_GROWTH_SMILEFLOW });
  }
}
