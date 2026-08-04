/**
 * @soec/motor-optimizacion · dominio · TIPOS de optimización (oportunidad, alternativa, counterfactual).
 *
 * Todo TIPADO (no texto libre). Una recomendación NO es una orden; una mejora SIMULADA no es evidencia de
 * mejora real. `NO_ACTUAR` es de primera clase. Toda pieza declara evidencia, incertidumbre, riesgo,
 * reversibilidad y naturaleza (SIMULADO/ESTIMADO — nunca REAL).
 */

export type TipoOportunidad =
  | 'mantener' | 'detener' | 'repetir' | 'ampliar_evidencia'
  | 'cambiar_segmento' | 'cambiar_hipotesis' | 'cambiar_objetivo' | 'cambiar_territorio'
  | 'cambiar_mensaje' | 'cambiar_pieza' | 'cambiar_variante' | 'cambiar_calendario'
  | 'cambiar_politica_operacional' | 'cambiar_presupuesto_simulado' | 'no_actuar';

export type Alcance = 'LOCAL' | 'TRANSFERIBLE';
export type Riesgo = 'bajo' | 'medio' | 'alto';
export type Reversibilidad = 'reversible' | 'irreversible';
export type Naturaleza = 'SIMULADO' | 'ESTIMADO';
export type Confianza = 'nula' | 'baja' | 'media' | 'alta';

export interface Oportunidad {
  readonly oportunidadId: string;
  readonly tipo: TipoOportunidad;
  readonly fundamento: string;
  readonly evidencia: readonly string[];
  readonly contraevidencia: readonly string[];
  readonly alcance: Alcance;
  readonly confianza: Confianza;
  readonly riesgo: Riesgo;
  readonly costoEstimado: number; // unidades lógicas SIMULADAS
  readonly impactoEsperado: string;
  readonly reversibilidad: Reversibilidad;
  readonly restricciones: readonly string[];
  readonly informacionFaltante: readonly string[];
  readonly dependencias: readonly string[];
  readonly naturaleza: Naturaleza;
}

/** Una variable de cambio declarada (para el chequeo de experimento controlado = una sola variable). */
export type VariableCambio = 'segmento' | 'hipotesis' | 'objetivo' | 'territorio' | 'mensaje' | 'pieza' | 'variante' | 'calendario' | 'politica_operacional' | 'presupuesto';

export interface Alternativa {
  readonly alternativaId: string;
  readonly oportunidadId: string;
  readonly cambia: readonly VariableCambio[]; // variables que cambian (declaración explícita)
  readonly constantes: readonly VariableCambio[];
  readonly razon: string;
  readonly hipotesisId: string | null;
  readonly riesgo: Riesgo;
  readonly costoEstimado: number;
  readonly beneficioEsperado: string;
  readonly kpiAfectado: string;
  readonly evidencia: readonly string[];
  readonly condicionesExito: readonly string[];
  readonly condicionesAbandono: readonly string[];
  readonly planReversion: string;
  readonly alcance: Alcance;
  readonly naturaleza: Naturaleza;
}

/** ¿Es un experimento controlado válido? (cambia EXACTAMENTE una variable). */
export function esExperimentoControlado(a: Alternativa): boolean {
  return a.cambia.length === 1;
}

export type TipoCounterfactual = 'SI_MANTENEMOS' | 'SI_CAMBIAMOS' | 'SI_DETENEMOS' | 'SI_REPETIMOS';

export interface Counterfactual {
  readonly tipo: TipoCounterfactual;
  readonly supuestos: readonly string[];
  readonly variablesModificadas: readonly VariableCambio[];
  readonly variablesConstantes: readonly VariableCambio[];
  readonly datosUtilizados: readonly string[];
  readonly incertidumbre: Confianza;
  readonly rangoEsperado: string; // declarado como rango, no como hecho
  readonly riesgos: readonly string[];
  readonly limitaciones: readonly string[];
  readonly naturaleza: Naturaleza; // SIMULADO/ESTIMADO — nunca afirma el futuro como hecho
}
