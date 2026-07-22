/**
 * Fixtures SINTÉTICOS de medición (F2-MET-01). Criterio de objetivo y política de
 * optimización de desarrollo. Datos sintéticos; sin gasto ni datos reales.
 */
import type { CriterioObjetivo } from './domain/evaluation';
import type { PoliticaOptimizacion } from './domain/optimization';

export const CRITERIO_DEMO: CriterioObjetivo = {
  objetivoId: 'obj-cont-leads',
  indicador: 'tasa_conversion',
  lineaBase: 0.02,
  meta: 0.05,
  tolerancia: 0.2,
  muestraMinima: 500,
};

export const POLICY_OPT_DEMO: PoliticaOptimizacion = {
  muestraMinima: 500,
  umbralPausaTasaConversion: 0.01,
  umbralEscalamiento: 0.05,
  variacionMaxPresupuesto: 0.2,
  cooldownDias: 1,
  campaniasProtegidas: [],
  actividadesNoModificables: [],
  escalamientoRequiereAprobacion: true, // el escalamiento no es automático: requiere aprobación humana
};

/** Presupuesto autorizado para la detección de anomalías de gasto (CLP). */
export const GASTO_AUTORIZADO_DEMO = 300;
