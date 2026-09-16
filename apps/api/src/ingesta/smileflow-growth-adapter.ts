/**
 * apps/api · CAPA DE COMPOSICIÓN · COMPATIBILIDAD: adaptador Growth de SmileFlow.
 *
 * El adaptador real vive ahora en `growth-adapter.ts` y es agnóstico de proveedor: el provider, el host
 * autorizado, la ruta y la credencial los declara la FUENTE REGISTRADA de cada organización.
 *
 * Esta clase se conserva para que el wiring y las pruebas históricas de SmileFlow sigan funcionando SIN
 * CAMBIOS: rellena, con la configuración registrada de `org-smileflow`, exactamente los valores que antes
 * estaban cableados aquí (provider `smileflow-growth`, host productivo, ruta `/integrations/soec/growth-events`).
 * No añade capacidades ni relaja el egress: es el mismo comportamiento, expresado como configuración.
 */
import { GrowthAdapter, type DependenciasGrowth } from './growth-adapter';
import {
  HOST_GROWTH_SMILEFLOW,
  PROVIDER_GROWTH_SMILEFLOW,
} from '../plataforma/negocios/org-smileflow';

/** Ruta del puente M2M de SmileFlow (idéntica a la histórica). */
export const RUTA_M2M_SMILEFLOW = '/integrations/soec/growth-events' as const;

export type DependenciasSmileFlowGrowth = Omit<
  DependenciasGrowth,
  'provider' | 'hostsAutorizados' | 'rutaIngesta'
> &
  Partial<Pick<DependenciasGrowth, 'provider' | 'hostsAutorizados' | 'rutaIngesta'>>;

export class SmileFlowGrowthAdapter extends GrowthAdapter {
  constructor(deps: DependenciasSmileFlowGrowth) {
    super({
      ...deps,
      provider: deps.provider ?? PROVIDER_GROWTH_SMILEFLOW,
      hostsAutorizados: deps.hostsAutorizados ?? [HOST_GROWTH_SMILEFLOW],
      rutaIngesta: deps.rutaIngesta ?? RUTA_M2M_SMILEFLOW,
    });
  }
}
