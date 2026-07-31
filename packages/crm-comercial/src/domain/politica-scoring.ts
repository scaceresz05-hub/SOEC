/**
 * @soec/crm-comercial · dominio · Política de scoring GOBERNADA y versionada (H-4).
 *
 * Extrae los pesos, umbrales y ventanas que antes eran "números mágicos" en el scoring a un objeto
 * explícito, versionado e inyectable (patrón `PoliticaEstrategia`). Existe una política por defecto
 * V1; los tests pueden inyectar otra. La confianza NO se deriva de esta política sino de la evidencia
 * (origen, cobertura, contradicción); la política solo fija la mecánica del puntaje HEURÍSTICO.
 */
export interface PoliticaScoringComercial {
  readonly version: string;
  /** Ventana de recencia/inactividad en días. */
  readonly ventanaDias: number;
  /** Umbrales de banda cualitativa (0..1). */
  readonly umbralBandaAlta: number;
  readonly umbralBandaMedia: number;
  /** Nº de actividades para saturar la frecuencia (=1). */
  readonly frecuenciaTope: number;
  /** Días de antigüedad para saturar (=1). */
  readonly antiguedadPlenaDias: number;
  /** Nº de compras para saturar la relación (=1). */
  readonly comprasPlenas: number;
  readonly pesos: {
    readonly actividad: { readonly recencia: number; readonly frecuencia: number };
    readonly interes: { readonly base: number; readonly positivo: number; readonly negativo: number };
    readonly relacion: { readonly compras: number; readonly antiguedad: number; readonly actividad: number };
    readonly probabilidad: { readonly interes: number; readonly actividad: number; readonly relacion: number; readonly riesgo: number };
    readonly riesgo: { readonly inactividadPorVentana: number; readonly negativa: number };
  };
}

/** Política por defecto V1 (documentada, versionada). Reproduce la mecánica inicial, ahora gobernada. */
export const POLITICA_SCORING_V1: PoliticaScoringComercial = {
  version: 'scoring-comercial-v1',
  ventanaDias: 180,
  umbralBandaAlta: 0.66,
  umbralBandaMedia: 0.33,
  frecuenciaTope: 10,
  antiguedadPlenaDias: 365,
  comprasPlenas: 3,
  pesos: {
    actividad: { recencia: 0.6, frecuencia: 0.4 },
    interes: { base: 0.5, positivo: 0.18, negativo: 0.22 },
    relacion: { compras: 0.45, antiguedad: 0.3, actividad: 0.25 },
    probabilidad: { interes: 0.4, actividad: 0.35, relacion: 0.25, riesgo: 0.3 },
    riesgo: { inactividadPorVentana: 1, negativa: 0.15 },
  },
};
