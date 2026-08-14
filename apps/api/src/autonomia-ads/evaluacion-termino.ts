/**
 * apps/api · CAPA DE COMPOSICIÓN · EVALUACIÓN EPISTEMOLÓGICA de un término de búsqueda (genérico, reutilizable).
 *
 * Corrige un defecto de razonamiento: la heurística previa (`clasificarTermino`) equiparaba CERO CLICS con
 * IRRELEVANCIA, y de ahí proponía una palabra excluida. Son conceptos distintos:
 *  - RENDIMIENTO (performance): sale del CTR/clics. 0 clics = rendimiento POBRE (un hecho).
 *  - RELEVANCIA/INTENCIÓN: NO se puede inferir del CTR. Un término comercialmente relevante (p. ej. la
 *    búsqueda de un competidor) puede tener 0 clics por desajuste de mensaje, copy débil o marca reconocida
 *    — no porque la búsqueda "no tenga que ver". SOEC NO tiene, de forma genérica, señal semántica de
 *    relevancia: por defecto es DESCONOCIDA. Sólo una POLÍTICA explícita del negocio (por-organización) puede
 *    marcar un término como irrelevante.
 *
 * Regla dura: una NEGATIVA requiere evidencia de IRRELEVANCIA, no sólo "N impresiones sin clics". Sin señal de
 * relevancia, el bajo rendimiento lleva a OBSERVAR/OPTIMIZAR el mensaje, jamás a excluir tráfico.
 *
 * Genérico y sin hardcodear ningún término/negocio: cualquier org (incl. org-cyp) lo reutiliza con su propia
 * política (vacía por defecto ⇒ ninguna negativa automática). Tenant-safe: la política viaja en los límites de
 * la organización, no se comparte entre tenants.
 */
export type Rendimiento = 'BUENO' | 'POBRE' | 'NO_EVALUABLE';
export type Relevancia = 'RELEVANTE' | 'IRRELEVANTE' | 'DESCONOCIDA';
export type ConfianzaTermino = 'baja' | 'media' | 'alta';

/** Acciones posibles sobre un término. NO se fuerza una acción: sin evidencia ⇒ observar/optimizar, no excluir. */
export type AccionTermino =
  | 'EVIDENCIA_INSUFICIENTE' // muestra por debajo del mínimo ⇒ no se concluye nada
  | 'MANTENER'               // recibe clics ⇒ atrae interés; no es candidato a exclusión
  | 'OPTIMIZAR_MENSAJE'      // 0 clics con muestra suficiente y relevancia desconocida ⇒ revisar anuncio/match, NO excluir
  | 'CANDIDATO_NEGATIVA'     // señal fuerte de irrelevancia pero no concluyente ⇒ revisión humana
  | 'NEGATIVA_JUSTIFICADA';  // evidencia de irrelevancia (política del negocio) + 0 clics con muestra ⇒ excluir

export interface EvaluacionTermino {
  readonly termino: string;
  readonly impresiones: number;
  readonly clics: number;
  readonly rendimiento: Rendimiento;
  readonly muestraSuficiente: boolean;
  readonly relevancia: Relevancia;
  readonly confianza: ConfianzaTermino;
  readonly accion: AccionTermino;
  readonly motivo: string;
}

export interface OpcionesEvaluacion {
  /** Impresiones mínimas sobre el término para siquiera evaluar rendimiento/negativa. */
  readonly muestraMinima: number;
  /** CTR mínimo para considerar el rendimiento BUENO (default 0.05). */
  readonly ctrBueno?: number;
  /**
   * Predicado de IRRELEVANCIA de la organización (política explícita del negocio). SOEC NO lo infiere del CTR.
   * Ausente/false ⇒ relevancia DESCONOCIDA (nunca se propone negativa por rendimiento solo).
   */
  readonly esIrrelevante?: (termino: string) => boolean;
}

/** Evalúa un término separando rendimiento, muestra, relevancia, confianza y acción. Puro y determinista. */
export function evaluarTermino(termino: string, clics: number, impresiones: number, opts: OpcionesEvaluacion): EvaluacionTermino {
  const ctrBueno = opts.ctrBueno ?? 0.05;
  const muestraSuficiente = Number.isFinite(impresiones) && impresiones >= opts.muestraMinima;
  const ctr = impresiones > 0 ? clics / impresiones : 0;
  const irrelevantePorPolitica = opts.esIrrelevante?.(termino) === true;

  // Relevancia: sólo IRRELEVANTE si la política del negocio lo dice; RELEVANTE si atrae clics/CTR; si no, DESCONOCIDA.
  const relevancia: Relevancia = irrelevantePorPolitica ? 'IRRELEVANTE' : clics > 0 || ctr >= ctrBueno ? 'RELEVANTE' : 'DESCONOCIDA';

  const base = { termino, impresiones, clics, muestraSuficiente, relevancia };

  if (!muestraSuficiente) {
    return { ...base, rendimiento: 'NO_EVALUABLE', confianza: 'baja', accion: 'EVIDENCIA_INSUFICIENTE',
      motivo: `Sólo ${impresiones} impresiones: muestra insuficiente para concluir algo sobre este término.` };
  }
  if (clics > 0) {
    return { ...base, rendimiento: 'BUENO', confianza: 'media', accion: 'MANTENER',
      motivo: `Recibió ${clics} clic(s) en ${impresiones} impresiones: atrae interés, no es candidato a exclusión.` };
  }
  // clics == 0 con muestra suficiente:
  if (irrelevantePorPolitica) {
    return { ...base, rendimiento: 'POBRE', confianza: 'alta', accion: 'NEGATIVA_JUSTIFICADA',
      motivo: `${impresiones} impresiones y 0 clics, y coincide con la política de términos irrelevantes del negocio: excluir es justificable.` };
  }
  return { ...base, rendimiento: 'POBRE', confianza: 'baja', accion: 'OPTIMIZAR_MENSAJE',
    motivo: `${impresiones} impresiones y 0 clics: es BAJO RENDIMIENTO, no evidencia de que la búsqueda sea irrelevante. Puede faltar coincidencia entre el anuncio/mensaje y la intención. Revisar el anuncio antes de excluir tráfico.` };
}

/** Construye un predicado de irrelevancia a partir de patrones (subcadena, case-insensitive). Vacío ⇒ nunca irrelevante. */
export function crearPredicadoIrrelevancia(patrones: readonly string[] | undefined): (termino: string) => boolean {
  const ps = (patrones ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (ps.length === 0) return () => false;
  return (termino: string) => {
    const t = (termino ?? '').toLowerCase();
    return ps.some((p) => t.includes(p));
  };
}
