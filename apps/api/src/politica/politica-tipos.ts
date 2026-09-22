/**
 * apps/api · POLÍTICA DE EVALUACIÓN COMO DATO · vocabulario del dominio.
 *
 * Una POLÍTICA DE EVALUACIÓN responde «¿qué significa que a este negocio le vaya bien?». Hasta ahora eso
 * vivía en un módulo TypeScript (`real-director/criterio-smileflow.ts` + `autonomia-ads/limites-smileflow.ts`)
 * y sólo existía para UNA empresa: las demás tenían `perfil: null` y, por tanto, no eran evaluables.
 *
 * CUATRO CLASES QUE NO SE MEZCLAN —el error que este modelo evita— son:
 *
 *   FACT             lo que el negocio ES (vive en `business_profile`, `business_offering`, `business_geo_scope`)
 *   POLICY           lo que el negocio QUIERE y qué umbral considera bueno o malo (esto)
 *   OBSERVED_METRIC  lo que de hecho pasó (event store, snapshots; JAMÁS se guarda aquí)
 *   DECISION         lo que se resolvió hacer (ledger de decisiones/mandatos)
 *
 * Una métrica observada no es una política: guardar «CTR 2,5 %» en esta tabla convertiría una medición en un
 * objetivo sin que nadie lo decidiera. Y una política positiva no autoriza gasto: eso lo decide el gobierno.
 */

/** Papel de un KPI o de un evento de conversión dentro de la política. */
export type RolMetrica = 'PRIMARY' | 'SECONDARY';

/**
 * Forma de un KPI, no su nombre. Con estas cinco formas caben una clínica (contactos, costo por contacto),
 * un SaaS (demos, CAC) y un e-commerce (compras, ingreso, ROAS) sin una rama de código por industria.
 */
export type TipoKpi = 'EVENT_COUNT' | 'RATE' | 'COST_PER' | 'VALUE' | 'RATIO';

export type UnidadKpi = 'COUNT' | 'RATE' | 'CURRENCY' | 'RATIO' | 'DAYS';

/** Hacia dónde es mejor. Sin esto, «CPA 3.000» no dice si subir es bueno o malo. */
export type DireccionKpi = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';

/**
 * Estado de un dato de política. `UNKNOWN` es una respuesta legítima y distinta de cero: un negocio puede
 * declarar que le importan los contactos y todavía no saber cuántos necesita.
 */
export type EstadoDato = 'CONFIGURED' | 'UNKNOWN' | 'NOT_APPLICABLE';

/**
 * Naturaleza de una regla de evaluación:
 *   SUCCESS           umbral que define «va bien»
 *   ALERT             umbral que merece avisar (no pausar)
 *   PAUSE             umbral por debajo/encima del cual la campaña es candidata a pausa
 *   ESCALATION        umbral desde el que valdría la pena invertir más (siempre con aprobación humana)
 *   EVIDENCE_MINIMUM  cuánta evidencia hace falta ANTES de concluir cualquiera de las anteriores
 */
export type TipoRegla = 'SUCCESS' | 'ALERT' | 'PAUSE' | 'ESCALATION' | 'EVIDENCE_MINIMUM';

/** Métrica sobre la que se expresa una regla. Vocabulario abierto por diseño (una fila, no una rama). */
export type MetricaRegla =
  | 'CONVERSION_RATE'
  | 'CONVERSIONS'
  | 'CLICKS'
  | 'IMPRESSIONS'
  | 'SPEND'
  | 'COST_PER_CONVERSION'
  | 'REVENUE'
  | 'ROAS'
  | 'OBSERVATION_WINDOW_DAYS';

export type Comparador = 'GTE' | 'LTE' | 'GT' | 'LT';

/** Un canal está permitido o prohibido para este negocio. Ausente ⇒ no declarado (no se infiere). */
export type ModoCanal = 'ALLOWED' | 'FORBIDDEN';

export const ROLES: readonly RolMetrica[] = ['PRIMARY', 'SECONDARY'];
export const TIPOS_KPI: readonly TipoKpi[] = ['EVENT_COUNT', 'RATE', 'COST_PER', 'VALUE', 'RATIO'];
export const UNIDADES_KPI: readonly UnidadKpi[] = ['COUNT', 'RATE', 'CURRENCY', 'RATIO', 'DAYS'];
export const DIRECCIONES: readonly DireccionKpi[] = ['HIGHER_IS_BETTER', 'LOWER_IS_BETTER'];
export const ESTADOS_DATO: readonly EstadoDato[] = ['CONFIGURED', 'UNKNOWN', 'NOT_APPLICABLE'];
export const TIPOS_REGLA: readonly TipoRegla[] = ['SUCCESS', 'ALERT', 'PAUSE', 'ESCALATION', 'EVIDENCE_MINIMUM'];
export const METRICAS_REGLA: readonly MetricaRegla[] = [
  'CONVERSION_RATE', 'CONVERSIONS', 'CLICKS', 'IMPRESSIONS', 'SPEND',
  'COST_PER_CONVERSION', 'REVENUE', 'ROAS', 'OBSERVATION_WINDOW_DAYS',
];
export const COMPARADORES: readonly Comparador[] = ['GTE', 'LTE', 'GT', 'LT'];
export const MODOS_CANAL: readonly ModoCanal[] = ['ALLOWED', 'FORBIDDEN'];

/**
 * PROCEDENCIA de un valor de política (Fase D). Sin esto, un umbral puesto por el sistema para no dejar un
 * hueco es indistinguible de una decisión del negocio — y eso es exactamente lo que no puede pasar:
 *
 *   USER_DEFINED   lo fijó una persona del negocio
 *   SYSTEM_DEFAULT punto de partida prudente y VERSIONADO del sistema, con fundamento escrito
 *   LEARNED        se aprendió observando datos reales
 *   MIGRATED       venía del módulo TypeScript histórico
 *   TO_BE_LEARNED  el negocio no lo sabe todavía y se aprenderá con datos iniciales (no es cero, no es meta)
 *   UNCONFIGURED   nadie lo fijó y el sistema NO lo inventa
 */
export type ProcedenciaValor =
  | 'USER_DEFINED'
  | 'SYSTEM_DEFAULT'
  | 'LEARNED'
  | 'MIGRATED'
  | 'TO_BE_LEARNED'
  | 'UNCONFIGURED';

export const PROCEDENCIAS: readonly ProcedenciaValor[] = [
  'USER_DEFINED', 'SYSTEM_DEFAULT', 'LEARNED', 'MIGRATED', 'TO_BE_LEARNED', 'UNCONFIGURED',
];

export class PoliticaInvalidaError extends Error {}

const en = <T extends string>(valores: readonly T[], v: unknown, campo: string): T => {
  if (typeof v === 'string' && (valores as readonly string[]).includes(v)) return v as T;
  throw new PoliticaInvalidaError(`${campo} inválido: ${String(v)}`);
};

export const exigirRol = (v: unknown): RolMetrica => en(ROLES, v, 'rol');
export const exigirTipoKpi = (v: unknown): TipoKpi => en(TIPOS_KPI, v, 'tipo de KPI');
export const exigirUnidad = (v: unknown): UnidadKpi => en(UNIDADES_KPI, v, 'unidad');
export const exigirDireccion = (v: unknown): DireccionKpi => en(DIRECCIONES, v, 'dirección');
export const exigirEstado = (v: unknown): EstadoDato => en(ESTADOS_DATO, v, 'estado');
export const exigirTipoRegla = (v: unknown): TipoRegla => en(TIPOS_REGLA, v, 'tipo de regla');
export const exigirMetrica = (v: unknown): MetricaRegla => en(METRICAS_REGLA, v, 'métrica');
export const exigirComparador = (v: unknown): Comparador => en(COMPARADORES, v, 'comparador');
export const exigirModoCanal = (v: unknown): ModoCanal => en(MODOS_CANAL, v, 'modo de canal');
export const exigirProcedencia = (v: unknown): ProcedenciaValor => en(PROCEDENCIAS, v, 'procedencia');

/**
 * PUNTOS DE PARTIDA del sistema, versionados y con fundamento escrito. Sólo existen donde hay una razón
 * interna clara; donde no la hay, el valor queda `UNCONFIGURED` y se dice, en lugar de inventarlo.
 *
 * `IMPRESSIONS = 1000`: piso documentado desde el primer piloto — a un CTR observado ~2,5 % equivale a ~25
 * clics, mínimo razonable para empezar a observar señal de conversión. No está calibrado para forzar ninguna
 * conclusión: por debajo, la evaluación prevalece en OBSERVAR/NO_EVALUABLE.
 */
export const DEFAULTS_EVIDENCIA_V1: Readonly<Partial<Record<MetricaRegla, number>>> = {
  IMPRESSIONS: 1000,
};
export const VERSION_DEFAULTS_EVIDENCIA = 'v1' as const;

/** Clave de evento/KPI: minúsculas, números, `_`, `-` y `:` (los eventos Growth usan `service_viewed:<slug>`). */
export function exigirClave(v: unknown, campo: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^[a-z0-9][a-z0-9_:-]{0,79}$/.test(s)) {
    throw new PoliticaInvalidaError(`${campo} inválido: admite minúsculas, números, '_', '-' y ':'`);
  }
  return s;
}

export function numeroOpcional(v: unknown, campo: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new PoliticaInvalidaError(`${campo} debe ser numérico`);
  return n;
}

export function enteroPositivoOpcional(v: unknown, campo: string): number | null {
  const n = numeroOpcional(v, campo);
  if (n === null) return null;
  if (!Number.isInteger(n) || n < 0) throw new PoliticaInvalidaError(`${campo} debe ser un entero ≥ 0`);
  return n;
}

export function fraccionOpcional(v: unknown, campo: string): number | null {
  const n = numeroOpcional(v, campo);
  if (n === null) return null;
  if (n < 0 || n > 1) throw new PoliticaInvalidaError(`${campo} debe estar entre 0 y 1`);
  return n;
}

/**
 * Qué le falta a una política para ser evaluable, en campos ESTRUCTURADOS: la interfaz tiene que poder
 * pedir exactamente lo que falta, y el Director tiene que poder decir por qué se saltó a una empresa.
 */
export type CampoFaltante =
  | 'primaryObjective'
  | 'primaryConversionEvent'
  | 'primaryKpi'
  | 'successCriterion'
  /**
   * Cuánta evidencia hace falta antes de concluir. Es REQUISITO, no adorno: sin un mínimo declarado, el
   * Director podría dar por bueno —o por malo— un resultado con un puñado de datos. Los mínimos concretos
   * (clics, conversiones, gasto) pueden quedar `NOT_APPLICABLE` según el canal; lo que no puede faltar es
   * que el negocio haya declarado AL MENOS UNO.
   */
  | 'evidenceMinimum';

/** Campos que NO bloquean la evaluación pero la hacen mejor. Se informan como recomendaciones. */
export type CampoRecomendado =
  | 'objectiveText'
  | 'pauseCriterion'
  | 'evaluationHorizon'
  | 'secondaryKpi'
  | 'channelRules'
  | 'geographicScope'
  | 'offerPriorities';

export interface MotivoIncompletitud {
  readonly campo: CampoFaltante;
  /** Por qué falta, en lenguaje de negocio. */
  readonly motivo: string;
  /** Qué hay que hacer para resolverlo. */
  readonly comoSeResuelve: string;
}

export interface Recomendacion {
  readonly campo: CampoRecomendado;
  readonly motivo: string;
}

export type EstadoPerfilEvaluacion = 'EVALUATION_PROFILE_COMPLETE' | 'EVALUATION_PROFILE_INCOMPLETE';

export interface CompletitudPerfil {
  readonly estado: EstadoPerfilEvaluacion;
  readonly faltantes: readonly MotivoIncompletitud[];
  readonly recomendaciones: readonly Recomendacion[];
  /** Momento del último cambio de la política. `null` si la empresa no tiene ninguna todavía. */
  readonly actualizadoEn: string | null;
}

/** Textos de los motivos. Se declaran juntos para que la API y la interfaz digan lo mismo. */
export const MOTIVOS: Readonly<Record<CampoFaltante, Omit<MotivoIncompletitud, 'campo'>>> = {
  primaryObjective: {
    motivo: 'el negocio no tiene un objetivo de evaluación declarado',
    comoSeResuelve: 'indicar qué quiere conseguir el negocio',
  },
  primaryConversionEvent: {
    motivo: 'no se ha declarado qué acción de un cliente cuenta como resultado',
    comoSeResuelve: 'elegir la acción principal (por ejemplo, escribir por WhatsApp o pedir una hora)',
  },
  primaryKpi: {
    motivo: 'no hay un indicador principal con el que medir el objetivo',
    comoSeResuelve: 'elegir el indicador principal (por ejemplo, contactos conseguidos o costo por contacto)',
  },
  successCriterion: {
    motivo: 'no hay un criterio que diga cuándo el resultado es bueno',
    comoSeResuelve: 'fijar la meta del indicador principal, o un umbral de éxito',
  },
  evidenceMinimum: {
    motivo: 'no se ha declarado cuántos datos hacen falta antes de sacar conclusiones',
    comoSeResuelve: 'fijar un mínimo de evidencia (por ejemplo, impresiones o clics mínimos antes de concluir)',
  },
};
