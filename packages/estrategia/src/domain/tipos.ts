/**
 * @soec/estrategia · dominio · tipos del motor de Estrategia (contrato v1.1).
 *
 * Produce CANDIDATOS, no decisiones, derivados CAUSALMENTE de señales diagnósticas
 * activas y mapeos versionados del rubro (nunca por coincidencia libre de texto).
 * Consume solo `ComprensionEvaluable`, `RubroKnowledgePort` y una política explícita.
 */
import type { ActivadorRegulatorio, Confianza } from '@soec/rubros';

export interface PoliticaEstrategia {
  /** Confianza mínima para proponer un candidato. */
  readonly minConfianza: Confianza;
  /** Tope de candidatos a devolver. */
  readonly maxCandidatos: number;
  /** Candidatos esperados (para declarar cobertura parcial, sin inventar débiles). */
  readonly candidatosEsperados: number;
  /** Si una contradicción abierta degrada la confianza. */
  readonly degradarPorContradiccion: boolean;
}

export interface ExplicacionCandidato {
  readonly detecte: string;
  readonly observe: string;
  readonly necesito: string;
  readonly meFalta: string;
}

/** Factores explícitos que determinan la confianza (explicable y monotónica). */
export interface FactoresConfianza {
  readonly hechosRespaldatorios: readonly string[];
  readonly faltantesQueReducen: readonly string[];
  readonly contradiccionesQueReducen: readonly string[];
  readonly supuestosUtilizados: readonly string[];
  readonly resultado: Confianza;
}

/** Trazabilidad causal: hasta el mapeo/señal y las entradas del rubro utilizadas. */
export interface ProcedenciaCandidato {
  readonly senalesActivas: readonly string[];
  readonly hechosUtilizados: readonly string[];
  readonly faltantesRelevantes: readonly string[];
  readonly contradiccionesQueReducenConfianza: readonly string[];
  /** IDs de entradas del rubro que justifican la derivación (MAP-…, SIG-…, OBJ-…, EST-…, SUP-…). */
  readonly entradasRubro: readonly string[];
}

export interface EstrategiaSugerida {
  readonly id: string;
  readonly estrategia: string;
  /** Bloqueada por una regla regulatoria (efecto BLOQUEA). */
  readonly bloqueada: boolean;
}

/** Advertencia/bloqueo regulatorio ESPECÍFICO por candidato y estrategia. */
export interface AdvertenciaRegulatoria {
  readonly reglaId: string;
  readonly estrategiaId: string;
  readonly activadaPor: ActivadorRegulatorio;
  readonly efecto: 'ADVIERTE' | 'BLOQUEA';
  readonly estado: 'PRELIMINARY';
  readonly certificaCumplimiento: false;
  readonly nota: string;
}

export interface CandidatoEstrategia {
  readonly objetivoId: string;
  readonly objetivo: string;
  readonly metrica: string;
  readonly costoMedicion: string | null;
  readonly estrategiasSugeridas: readonly EstrategiaSugerida[];
  readonly confianza: Confianza;
  readonly factoresConfianza: FactoresConfianza;
  readonly explicacion: ExplicacionCandidato;
  readonly procedencia: ProcedenciaCandidato;
  readonly advertenciasRegulatorias: readonly AdvertenciaRegulatoria[];
}

export interface Cobertura {
  readonly candidatosEsperados: number;
  readonly candidatosFundados: number;
  readonly motivoDeCoberturaParcial?: string;
}

export interface AbstencionEstrategia {
  readonly razon: string;
  readonly faltantesRelevantes: readonly string[];
}

export type ResultadoEstrategia =
  | {
      readonly tipo: 'PROPUESTA';
      readonly candidatos: readonly CandidatoEstrategia[];
      readonly cobertura: Cobertura;
    }
  | { readonly tipo: 'ABSTENCION'; readonly abstencion: AbstencionEstrategia };
