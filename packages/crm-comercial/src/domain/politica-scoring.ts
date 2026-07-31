/**
 * @soec/crm-comercial · dominio · Política de scoring GOBERNADA, versionada y COMPLETAMENTE
 * inyectable (H-4 / N-1). Todos los parámetros DECISORIOS del scoring, la confianza, la clasificación
 * en bandas y la recomendación viven aquí; ninguna función interna lee la política por defecto
 * directamente (solo la frontera pública selecciona `POLITICA_SCORING_V1`). El puntaje es HEURÍSTICO.
 */
import { ComandoCrmInvalidoError } from './errors';

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
  /** Factor sobre `frecuenciaTope` para saturar el aporte de actividad a la relación. */
  readonly factorRelacionActividad: number;
  readonly pesos: {
    readonly actividad: { readonly recencia: number; readonly frecuencia: number };
    readonly interes: { readonly base: number; readonly pesoCompra: number; readonly positivo: number; readonly negativo: number };
    readonly relacion: { readonly compras: number; readonly antiguedad: number; readonly actividad: number };
    readonly probabilidad: { readonly interes: number; readonly actividad: number; readonly relacion: number; readonly riesgo: number };
    readonly riesgo: { readonly inactividadPorVentana: number; readonly negativa: number };
  };
  /** Umbrales de DECISIÓN de la recomendación (siguiente paso). */
  readonly recomendacion: {
    readonly diasRecienteCompra: number;
    readonly relacionMinReactivacion: number;
  };
  /** Reglas de derivación de CONFIANZA desde la evidencia. */
  readonly confianza: {
    /** Cobertura mínima (nº de señales) para poder alcanzar ALTA. */
    readonly coberturaMinimaParaAlta: number;
    /** Si hay contradicción, degrada un nivel la confianza. */
    readonly degradaPorContradiccion: boolean;
  };
}

/** Política por defecto V1 (documentada, versionada). Solo se selecciona en la frontera pública. */
export const POLITICA_SCORING_V1: PoliticaScoringComercial = {
  version: 'scoring-comercial-v1',
  ventanaDias: 180,
  umbralBandaAlta: 0.66,
  umbralBandaMedia: 0.33,
  frecuenciaTope: 10,
  antiguedadPlenaDias: 365,
  comprasPlenas: 3,
  factorRelacionActividad: 0.8,
  pesos: {
    actividad: { recencia: 0.6, frecuencia: 0.4 },
    interes: { base: 0.5, pesoCompra: 0.25, positivo: 0.18, negativo: 0.22 },
    relacion: { compras: 0.45, antiguedad: 0.3, actividad: 0.25 },
    probabilidad: { interes: 0.4, actividad: 0.35, relacion: 0.25, riesgo: 0.3 },
    riesgo: { inactividadPorVentana: 1, negativa: 0.15 },
  },
  recomendacion: { diasRecienteCompra: 90, relacionMinReactivacion: 0.33 },
  confianza: { coberturaMinimaParaAlta: 2, degradaPorContradiccion: true },
};

function num(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}
function pesosNoNegativos(o: Record<string, number>): boolean {
  return Object.values(o).every((v) => num(v) && v >= 0);
}

/** Valida una política antes de usarla: sin NaN/Infinity/negativos, umbrales en rango, versión no vacía. */
export function validarPolitica(P: PoliticaScoringComercial): void {
  const err = (m: string): never => {
    throw new ComandoCrmInvalidoError(`política de scoring inválida: ${m}`);
  };
  if (!P.version?.trim()) err('version vacía');
  for (const [k, v] of Object.entries({ ventanaDias: P.ventanaDias, frecuenciaTope: P.frecuenciaTope, antiguedadPlenaDias: P.antiguedadPlenaDias, comprasPlenas: P.comprasPlenas, factorRelacionActividad: P.factorRelacionActividad })) {
    if (!num(v) || v <= 0) err(`${k} debe ser > 0`);
  }
  for (const [k, v] of Object.entries({ umbralBandaAlta: P.umbralBandaAlta, umbralBandaMedia: P.umbralBandaMedia, relacionMinReactivacion: P.recomendacion.relacionMinReactivacion })) {
    if (!num(v) || v < 0 || v > 1) err(`${k} debe estar en [0,1]`);
  }
  if (P.umbralBandaMedia > P.umbralBandaAlta) err('umbralBandaMedia no puede superar a umbralBandaAlta');
  if (!num(P.recomendacion.diasRecienteCompra) || P.recomendacion.diasRecienteCompra <= 0) err('diasRecienteCompra debe ser > 0');
  if (!num(P.confianza.coberturaMinimaParaAlta) || P.confianza.coberturaMinimaParaAlta < 1) err('coberturaMinimaParaAlta debe ser >= 1');
  for (const grupo of [P.pesos.actividad, P.pesos.interes, P.pesos.relacion, P.pesos.probabilidad, P.pesos.riesgo]) {
    if (!pesosNoNegativos(grupo as unknown as Record<string, number>)) err('los pesos deben ser finitos y no negativos');
  }
}
