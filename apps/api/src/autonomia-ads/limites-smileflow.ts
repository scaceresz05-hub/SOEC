/**
 * apps/api · CAPA DE COMPOSICIÓN · Límites de AUTONOMÍA GOBERNADA para "SmileFlow Search Chile".
 * Parametrizables. Son TOPES DUROS que el humano fija por adelantado; SOEC opera dentro y nunca los eleva.
 * En G1 (DRY-RUN) NADA se ejecuta: estos límites sólo se EVALÚAN y se muestran en la simulación.
 */
export interface LimitesAutonomia {
  /** Tope ABSOLUTO de presupuesto diario (CLP). Auto sólo puede BAJAR; subir es humano y ≤ este tope. */
  readonly presupuestoMaxDiarioCLP: number;
  /** Tope ABSOLUTO del techo de CPC (CLP). */
  readonly cpcTechoMaxCLP: number;
  /** Variación máxima permitida por cambio de CPC/presupuesto (fracción [0,1]). */
  readonly variacionMaxPct: number;
  /** Máximo de cambios ejecutados por día (contador gobernado). */
  readonly maxCambiosPorDia: number;
  /** Cooldown tras cualquier cambio a una palanca, en horas (deja acumular señal; corta oscilación). */
  readonly cooldownHoras: number;
  /** Impresiones mínimas SOBRE UN TÉRMINO para siquiera considerar una negativa (evidencia por-palanca). */
  readonly muestraMinimaNegativaImpresiones: number;
}

/**
 * Valores conservadores y DOCUMENTADOS (no calibrados para forzar una acción). El presupuesto/CPC reflejan la
 * campaña real (2.000 CLP/día, CPC máx 1.000). La muestra mínima de negativa (30 impresiones sobre el término,
 * 0 clics) es un piso prudente: por debajo, no hay evidencia por-término para excluir nada.
 */
export const LIMITES_SMILEFLOW: LimitesAutonomia = {
  presupuestoMaxDiarioCLP: 2000,
  cpcTechoMaxCLP: 1000,
  variacionMaxPct: 0.15,
  maxCambiosPorDia: 2,
  cooldownHoras: 72,
  muestraMinimaNegativaImpresiones: 30,
};
