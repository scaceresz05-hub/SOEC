/**
 * @soec/motor-estrategico · núcleo · MOTOR DE EVALUACIÓN (puro, determinista).
 *
 * Implementa, como función pura, la cadena epistémica raíz de SOEC:
 *   SSOT → Evaluabilidad → Pertinencia → Suficiencia → Confianza → Estado.
 * Es la pieza que faltaba: convierte la doctrina de evaluabilidad en un algoritmo único y auditable que
 * cualquier afirmación estratégica atraviesa siempre igual. No depende del reloj ni del azar ni de red;
 * dada la misma afirmación y evidencia, produce SIEMPRE el mismo veredicto (replay determinista).
 *
 * Garantías (verificadas por tests adversariales):
 *  - Sin evidencia pertinente ⇒ NO_EVALUABLE (la ausencia NUNCA es FALSO).
 *  - Con evidencia pertinente pero insuficiente/contradictoria ⇒ GRIS (se evaluó, no alcanzó).
 *  - Confianza sólo donde tiene significado: en GRIS/NO_EVALUABLE es `null`, nunca decorativa.
 *  - Toda evaluación explica por qué, qué evidencia usó, qué falta y qué impediría concluir.
 */
import { type EstadoEvaluabilidad } from './estado';
import { type Confianza, type Evidencia, esOrigenFuerte } from './evidencia';

/**
 * Política de SUFICIENCIA: cuánta y qué calidad de evidencia pertinente hace falta para poder
 * pronunciar un veredicto concluyente. Es un dato inyectado (gobernable), no una constante mágica.
 */
export interface PoliticaEvaluacion {
  /** Mínimo de piezas de evidencia PERTINENTE para poder concluir (por debajo ⇒ GRIS). */
  readonly minEvidenciaPertinente: number;
  /** Si un veredicto concluyente exige ≥1 evidencia FUERTE en el lado dominante (hecho/dato importado). */
  readonly exigeOrigenFuerte: boolean;
  readonly version: string;
}

/** Política por defecto, deliberadamente conservadora: 1 pertinente y no exige origen fuerte. */
export const POLITICA_EVALUACION_DEFECTO: PoliticaEvaluacion = {
  minEvidenciaPertinente: 1,
  exigeOrigenFuerte: false,
  version: 'defecto-1',
};

/** Explicación obligatoria de toda conclusión: nunca se responde un estado "pelado". */
export interface Explicacion {
  /** Por qué el estado es el que es, en una frase. */
  readonly porQue: string;
  /** Ids de la evidencia PERTINENTE efectivamente usada en el cómputo. */
  readonly evidenciaUsada: readonly string[];
  /** Qué información falta para robustecer o alcanzar un veredicto. */
  readonly queFalta: readonly string[];
  /** Qué, concretamente, impide concluir hoy (vacío si el estado es concluyente). */
  readonly queImpediriaConcluir: readonly string[];
}

/** Resultado completo de evaluar una afirmación contra su evidencia bajo una política. */
export interface Evaluacion {
  readonly estado: EstadoEvaluabilidad;
  readonly confianza: Confianza;
  /** Recuento de evidencia pertinente considerada. */
  readonly pertinentes: number;
  /** Evidencia registrada pero descartada por NO pertinente (se conserva, no se borra). */
  readonly noPertinentes: number;
  readonly aFavor: number;
  readonly enContra: number;
  readonly fuertesAFavor: number;
  readonly fuertesEnContra: number;
  /** ¿La evidencia pertinente alcanza el umbral de suficiencia de la política? */
  readonly suficiente: boolean;
  readonly politicaVersion: string;
  readonly explicacion: Explicacion;
}

interface Recuento {
  readonly pertinentes: readonly Evidencia[];
  readonly noPertinentes: number;
  readonly aFavor: number;
  readonly enContra: number;
  readonly fuertesAFavor: number;
  readonly fuertesEnContra: number;
}

function contar(evidencias: readonly Evidencia[]): Recuento {
  const pertinentes = evidencias.filter((e) => e.pertinente);
  let aFavor = 0;
  let enContra = 0;
  let fuertesAFavor = 0;
  let fuertesEnContra = 0;
  for (const e of pertinentes) {
    const fuerte = esOrigenFuerte(e.origen);
    if (e.sentido === 'A_FAVOR') {
      aFavor += 1;
      if (fuerte) fuertesAFavor += 1;
    } else {
      enContra += 1;
      if (fuerte) fuertesEnContra += 1;
    }
  }
  return {
    pertinentes,
    noPertinentes: evidencias.length - pertinentes.length,
    aFavor,
    enContra,
    fuertesAFavor,
    fuertesEnContra,
  };
}

/**
 * Confianza de un veredicto CONCLUYENTE, derivada del balance y la fuerza del lado dominante
 * (nunca una opinión): dominante fuerte y sin contraparte ⇒ ALTA; con evidencia en contra ⇒ MEDIA;
 * apenas por encima del umbral o sin origen fuerte ⇒ MEDIA/BAJA. En GRIS/NO_EVALUABLE es `null`.
 */
function confianzaConcluyente(dominanteFuerte: number, ladoContrario: number): Confianza {
  if (dominanteFuerte >= 1 && ladoContrario === 0) return 'ALTA';
  if (ladoContrario === 0) return 'MEDIA';
  return 'BAJA';
}

/**
 * Evalúa una afirmación contra su conjunto de evidencia bajo una política de suficiencia.
 * Función PURA: sin reloj, azar ni efectos; el mismo input da siempre el mismo resultado.
 */
export function evaluar(
  enunciado: string,
  evidencias: readonly Evidencia[],
  politica: PoliticaEvaluacion = POLITICA_EVALUACION_DEFECTO,
): Evaluacion {
  const c = contar(evidencias);
  const base = {
    pertinentes: c.pertinentes.length,
    noPertinentes: c.noPertinentes,
    aFavor: c.aFavor,
    enContra: c.enContra,
    fuertesAFavor: c.fuertesAFavor,
    fuertesEnContra: c.fuertesEnContra,
    politicaVersion: politica.version,
  };
  const usada = c.pertinentes.map((e) => e.evidenciaId);

  // 1) EVALUABILIDAD: sin evidencia pertinente no hay con qué evaluar. Ausencia ≠ conclusión.
  if (c.pertinentes.length === 0) {
    const queFalta =
      c.noPertinentes > 0
        ? [`hay ${c.noPertinentes} evidencia(s) registrada(s) pero ninguna declarada pertinente a "${enunciado}"`]
        : ['no hay evidencia registrada para esta afirmación'];
    return {
      ...base,
      estado: 'NO_EVALUABLE',
      confianza: null,
      suficiente: false,
      explicacion: {
        porQue: 'no hay evidencia pertinente: la afirmación no es evaluable (la ausencia de información no es una conclusión)',
        evidenciaUsada: [],
        queFalta,
        queImpediriaConcluir: ['sin al menos una evidencia pertinente no es posible evaluar'],
      },
    };
  }

  // 2) SUFICIENCIA: hay con qué evaluar, pero ¿alcanza el umbral para un veredicto?
  const hayDominante = c.aFavor !== c.enContra;
  const ladoFuerte = c.aFavor > c.enContra ? c.fuertesAFavor : c.fuertesEnContra;
  const cumpleMinimo = c.pertinentes.length >= politica.minEvidenciaPertinente;
  const cumpleFuerza = !politica.exigeOrigenFuerte || ladoFuerte >= 1;
  const suficiente = cumpleMinimo && hayDominante && cumpleFuerza;

  if (!suficiente) {
    const impedimentos: string[] = [];
    const falta: string[] = [];
    if (!hayDominante) {
      // Con evidencia pertinente (>0) y sin dominante, el balance es un empate ≥1 a favor / ≥1 en contra.
      impedimentos.push('la evidencia pertinente está equilibrada (a favor = en contra): es contradictoria');
      falta.push('evidencia adicional que incline el balance en un sentido');
    }
    if (!cumpleMinimo) {
      impedimentos.push(
        `evidencia pertinente insuficiente: ${c.pertinentes.length} < mínimo ${politica.minEvidenciaPertinente}`,
      );
      falta.push(`al menos ${politica.minEvidenciaPertinente - c.pertinentes.length} evidencia(s) pertinente(s) más`);
    }
    if (hayDominante && cumpleMinimo && !cumpleFuerza) {
      impedimentos.push('el lado dominante carece de evidencia fuerte (hecho verificado o dato importado)');
      falta.push('una evidencia de origen fuerte en el lado dominante');
    }
    return {
      ...base,
      estado: 'GRIS',
      confianza: null, // GRIS no lleva confianza: no se concluyó
      suficiente: false,
      explicacion: {
        porQue: 'la afirmación se evaluó pero la evidencia pertinente es insuficiente o contradictoria para concluir',
        evidenciaUsada: usada,
        queFalta: falta,
        queImpediriaConcluir: impedimentos,
      },
    };
  }

  // 3) VEREDICTO + CONFIANZA: hay evidencia pertinente, suficiente y dominante.
  const aFavorDomina = c.aFavor > c.enContra;
  const estado: EstadoEvaluabilidad = aFavorDomina ? 'VERDADERO' : 'FALSO';
  const dominanteFuerte = aFavorDomina ? c.fuertesAFavor : c.fuertesEnContra;
  const ladoContrario = aFavorDomina ? c.enContra : c.aFavor;
  const confianza = confianzaConcluyente(dominanteFuerte, ladoContrario);
  const falta: string[] = [];
  if (ladoContrario > 0) falta.push('resolver la evidencia en contra para elevar la confianza');
  if (dominanteFuerte === 0) falta.push('respaldar con evidencia de origen fuerte para elevar la confianza');
  return {
    ...base,
    estado,
    confianza,
    suficiente: true,
    explicacion: {
      porQue: `${aFavorDomina ? 'sostenida' : 'refutada'} por evidencia pertinente dominante (${c.aFavor} a favor / ${c.enContra} en contra; ${dominanteFuerte} fuerte en el lado dominante)`,
      evidenciaUsada: usada,
      queFalta: falta,
      queImpediriaConcluir: [],
    },
  };
}
