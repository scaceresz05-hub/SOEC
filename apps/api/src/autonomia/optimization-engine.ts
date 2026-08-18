/**
 * apps/api · V2-C · OPTIMIZATION ENGINE. Convierte decisiones en acciones de optimización DENTRO del mandato.
 * SOLO produce acciones seguras (pausar bajo rendimiento). NUNCA produce acciones que aumenten gasto o
 * amplíen el mandato: eso vive como recomendación financiera (aprobación humana). Determinista.
 */
import type { Decision } from './decision-engine';

export interface AccionOptimizacion {
  readonly adRef: string;
  readonly actionType: 'PAUSE_AD'; // única optimización autónoma segura en V2-C
  readonly razon: string;
}

export function planificarOptimizaciones(decisiones: readonly Decision[]): AccionOptimizacion[] {
  return decisiones
    .filter((d) => d.tipo === 'PAUSAR_ANUNCIO')
    .map((d) => ({ adRef: d.adRef, actionType: 'PAUSE_AD' as const, razon: d.razon }));
}
