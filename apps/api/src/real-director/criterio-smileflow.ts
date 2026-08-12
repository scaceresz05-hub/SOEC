/**
 * apps/api · CAPA DE COMPOSICIÓN · Configuración REAL del objetivo/política para la campaña
 * "SmileFlow Search Chile" (Google Ads, READ ONLY). Parametrizable — NO se calibran umbrales para
 * forzar una recomendación: ante evidencia insuficiente prevalece OBSERVAR/NO_EVALUABLE.
 *
 * IMPORTANTE (honestidad de umbrales): `muestraMinima` está en IMPRESIONES (así lo usa `evaluarCalidad`).
 * El valor por defecto (1000) es un piso conservador y DOCUMENTADO: a un CTR observado ~2,5 % equivale a
 * ~25 clics, mínimo razonable para empezar a observar señal de conversión; NO está ajustado al dato actual.
 * Además el veredicto NO depende de este umbral: sin conversión atribuible, `evaluarResultadoCampania`
 * clasifica el ROI como NO_CONCLUYENTE por contrato, de modo que OBSERVAR prevalece igual.
 */
import type { CriterioObjetivo, PoliticaOptimizacion } from '@soec/medicion';

/** Identidad de la campaña real observada. `campaignId` es el de Google Ads; `campaniaRef` es interno de SOEC. */
export const CAMPANIA_SMILEFLOW = {
  campaignId: '24120966895',
  campaniaRef: 'cmp-smileflow-search-chile',
  actividadId: 'act-smileflow-search-chile',
  canal: 'google_ads',
  nombre: 'SmileFlow Search Chile',
} as const;

export const OBJETIVO_SMILEFLOW = 'obj-smileflow-search-chile';

/**
 * Criterio de objetivo comercial (conversion-rate). `lineaBase` 0 (sin histórico), `meta` = tasa de conversión
 * objetivo (parametrizable por el negocio). `muestraMinima` documentada arriba. Cambiar estos valores NO puede
 * usarse para fabricar una recomendación: el gate de suficiencia + el contrato de ROI mantienen la honestidad.
 */
export const CRITERIO_SMILEFLOW: CriterioObjetivo = {
  objetivoId: OBJETIVO_SMILEFLOW,
  indicador: 'tasa_conversion',
  lineaBase: 0,
  meta: 0.03,
  tolerancia: 0.2,
  muestraMinima: 1000,
};

/** Política de optimización: el escalamiento SIEMPRE requiere aprobación humana (nunca automático). */
export const POLICY_SMILEFLOW: PoliticaOptimizacion = {
  muestraMinima: 1000,
  umbralPausaTasaConversion: 0.005,
  umbralEscalamiento: 0.05,
  variacionMaxPresupuesto: 0.2,
  cooldownDias: 1,
  campaniasProtegidas: [],
  actividadesNoModificables: [],
  escalamientoRequiereAprobacion: true,
};

/**
 * Gasto autorizado para la detección de anomalías de gasto. `null` = SOEC OBSERVA el gasto real de Google Ads
 * pero NO es la autoridad del presupuesto (el presupuesto lo fija la persona en Google Ads). Evita anomalías
 * espurias de "gasto superior al autorizado" sobre una campaña externa que SOEC no gobierna.
 */
export const GASTO_AUTORIZADO_SMILEFLOW: number | null = null;
