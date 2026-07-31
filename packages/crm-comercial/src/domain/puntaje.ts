/**
 * @soec/crm-comercial · dominio · Scoring multidimensional EXPLICABLE y recomendación fundamentada.
 *
 * Funciones puras y deterministas que derivan puntajes del estado del contacto. Ninguna dimensión se
 * inventa: si falta información, la dimensión es NO EVALUABLE (Evaluabilidad, Constitución §8), con
 * sus faltantes declarados. Toda recomendación es explicada (razones + evidencia + alternativas
 * descartadas + confianza + qué falta) o una ABSTENCIÓN honesta.
 */
import type { Confianza } from '@soec/negocio';
import type { ContactoState } from './contacto';
import type { AlternativaDescartada, Banda, Factor, RecomendacionExplicada } from './explicabilidad';

export type DimensionNombre =
  | 'actividad'
  | 'interes'
  | 'relacion'
  | 'riesgo'
  | 'probabilidadCompra'
  | 'valorEsperado'
  | 'prioridad';

export interface DimensionPuntaje {
  readonly dimension: DimensionNombre;
  readonly evaluable: boolean;
  /** Magnitud normalizada 0..1 cuando aplica; null si no evaluable o sin escala. */
  readonly valor: number | null;
  /** Monto monetario estimado (solo `valorEsperado`). */
  readonly montoEstimado: number | null;
  readonly banda: Banda | null;
  readonly confianza: Confianza;
  readonly factores: readonly Factor[];
  readonly faltantes: readonly string[];
}

export interface PuntajeContacto {
  readonly contactoId: string;
  readonly asOf: string;
  readonly dimensiones: Readonly<Record<DimensionNombre, DimensionPuntaje>>;
}

/** Contexto opcional para monetizar/priorizar (p. ej. tamaño de negocio típico del rubro). */
export interface OpcionesPuntaje {
  /** Valor monetario de referencia para normalizar el valor esperado en banda 0..1. */
  readonly valorReferencia?: number;
}

const DIA_MS = 86_400_000;
const VENTANA_DIAS = 180;

function diasEntre(aISO: string, bISO: string): number {
  return Math.floor((Date.parse(bISO) - Date.parse(aISO)) / DIA_MS);
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function bandaDe(v: number): Banda {
  return v >= 0.66 ? 'ALTA' : v >= 0.33 ? 'MEDIA' : 'BAJA';
}
const ORDEN: Record<Exclude<Confianza, null>, number> = { BAJA: 1, MEDIA: 2, ALTA: 3 };
/** Confianza más débil entre varias evaluables (null si alguna es null). */
function minConfianza(cs: readonly Confianza[]): Confianza {
  let min: Confianza = 'ALTA';
  for (const c of cs) {
    if (c === null) return null;
    if (ORDEN[c] < ORDEN[min ?? 'ALTA']) min = c;
  }
  return min;
}
function contar(state: ContactoState, tipos: readonly string[]): number {
  return state.actividades.filter((a) => tipos.includes(a.tipo)).length;
}
function noEvaluable(dim: DimensionNombre, faltantes: readonly string[]): DimensionPuntaje {
  return { dimension: dim, evaluable: false, valor: null, montoEstimado: null, banda: null, confianza: null, factores: [], faltantes };
}
function factor(descripcion: string, efecto: Factor['efecto'], evidencia?: string): Factor {
  return { descripcion, efecto, ...(evidencia ? { evidencia } : {}) };
}

// ── Dimensiones individuales ───────────────────────────────────────────────────────────────────

function dimActividad(state: ContactoState, asOf: string): DimensionPuntaje {
  const n = state.actividades.length;
  if (n === 0 || !state.ultimaActividadEn) {
    return noEvaluable('actividad', ['sin actividad registrada del contacto']);
  }
  const dias = diasEntre(state.ultimaActividadEn, asOf);
  const recencia = clamp01(1 - dias / VENTANA_DIAS);
  const frecuencia = clamp01(n / 10);
  const valor = clamp01(0.6 * recencia + 0.4 * frecuencia);
  const confianza: Confianza = n >= 3 ? 'ALTA' : 'MEDIA';
  return {
    dimension: 'actividad',
    evaluable: true,
    valor,
    montoEstimado: null,
    banda: bandaDe(valor),
    confianza,
    factores: [
      factor(`${n} actividad(es) registradas`, frecuencia >= 0.3 ? 'SUBE' : 'NEUTRO'),
      factor(`última actividad hace ${dias} día(s)`, recencia >= 0.5 ? 'SUBE' : 'BAJA'),
    ],
    faltantes: [],
  };
}

function dimInteres(state: ContactoState): DimensionPuntaje {
  const compras = contar(state, ['COMPRA']); // una compra es la señal de interés más fuerte (hecho)
  const positivasSuaves = contar(state, ['CONSULTA', 'RESPUESTA_POSITIVA', 'VISITA']);
  const negativas = contar(state, ['RESPUESTA_NEGATIVA', 'NO_ASISTIO']);
  if (compras + positivasSuaves + negativas === 0) {
    return noEvaluable('interes', ['sin señales de interés (consultas, respuestas, visitas, compras)']);
  }
  const valor = clamp01(0.5 + 0.25 * compras + 0.18 * positivasSuaves - 0.22 * negativas);
  const confianza: Confianza = compras >= 1 ? 'ALTA' : positivasSuaves + negativas >= 3 ? 'MEDIA' : 'BAJA';
  return {
    dimension: 'interes',
    evaluable: true,
    valor,
    montoEstimado: null,
    banda: bandaDe(valor),
    confianza,
    factores: [
      factor(`${compras} compra(s) — interés demostrado`, compras > 0 ? 'SUBE' : 'NEUTRO'),
      factor(`${positivasSuaves} señal(es) positiva(s)`, positivasSuaves > 0 ? 'SUBE' : 'NEUTRO'),
      factor(`${negativas} señal(es) negativa(s)`, negativas > 0 ? 'BAJA' : 'NEUTRO'),
    ],
    faltantes: [],
  };
}

function dimRelacion(state: ContactoState, asOf: string): DimensionPuntaje {
  const compras = contar(state, ['COMPRA']);
  const antiguedad = state.creadoEn ? diasEntre(state.creadoEn, asOf) : 0;
  const valor = clamp01(0.45 * clamp01(compras / 3) + 0.3 * clamp01(antiguedad / 365) + 0.25 * clamp01(state.actividades.length / 8));
  const confianza: Confianza = compras >= 1 ? 'ALTA' : 'MEDIA';
  return {
    dimension: 'relacion',
    evaluable: true,
    valor,
    montoEstimado: null,
    banda: bandaDe(valor),
    confianza,
    factores: [
      factor(`${compras} compra(s) histórica(s)`, compras > 0 ? 'SUBE' : 'NEUTRO'),
      factor(`antigüedad ${antiguedad} día(s)`, antiguedad > 90 ? 'SUBE' : 'NEUTRO'),
    ],
    faltantes: [],
  };
}

function dimRiesgo(state: ContactoState, asOf: string): DimensionPuntaje {
  const ref = state.ultimaActividadEn ?? state.creadoEn;
  if (!ref) return noEvaluable('riesgo', ['sin fecha de referencia para estimar inactividad']);
  const diasInactivo = diasEntre(ref, asOf);
  const negativas = contar(state, ['RESPUESTA_NEGATIVA', 'NO_ASISTIO']);
  const valor = clamp01(diasInactivo / VENTANA_DIAS + 0.15 * negativas);
  return {
    dimension: 'riesgo',
    evaluable: true,
    valor,
    montoEstimado: null,
    banda: bandaDe(valor),
    confianza: 'MEDIA',
    factores: [
      factor(`${diasInactivo} día(s) de inactividad`, diasInactivo > 90 ? 'SUBE' : 'NEUTRO'),
      factor(`${negativas} respuesta(s) negativa(s)/inasistencia(s)`, negativas > 0 ? 'SUBE' : 'NEUTRO'),
    ],
    faltantes: [],
  };
}

function dimValorEsperado(state: ContactoState, opciones: OpcionesPuntaje): DimensionPuntaje {
  const comprasConValor = state.actividades.filter((a) => a.tipo === 'COMPRA' && a.valor != null);
  const montoHistorico = comprasConValor.length > 0 ? comprasConValor.reduce((s, a) => s + (a.valor ?? 0), 0) / comprasConValor.length : null;
  const monto = montoHistorico ?? opciones.valorReferencia ?? null;
  if (monto == null) {
    return noEvaluable('valorEsperado', ['sin valor de compra histórico ni valor de referencia del rubro/producto']);
  }
  const faltantes: string[] = [];
  let valor: number | null = null;
  let banda: Banda | null = null;
  if (opciones.valorReferencia != null && opciones.valorReferencia > 0) {
    valor = clamp01(monto / opciones.valorReferencia);
    banda = bandaDe(valor);
  } else {
    faltantes.push('sin valor de referencia para normalizar en banda (se reporta el monto)');
  }
  return {
    dimension: 'valorEsperado',
    evaluable: true,
    valor,
    montoEstimado: monto,
    banda,
    confianza: montoHistorico != null ? 'ALTA' : 'BAJA',
    factores: [
      factor(montoHistorico != null ? `monto medio de ${comprasConValor.length} compra(s)` : 'valor de referencia del rubro', montoHistorico != null ? 'SUBE' : 'NEUTRO'),
    ],
    faltantes,
  };
}

// ── Composición ───────────────────────────────────────────────────────────────────────────────

/** Puntúa un contacto en todas las dimensiones. Determinista respecto a `asOf`. */
export function puntuarContacto(state: ContactoState, asOf: string, opciones: OpcionesPuntaje = {}): PuntajeContacto {
  const actividad = dimActividad(state, asOf);
  const interes = dimInteres(state);
  const relacion = dimRelacion(state, asOf);
  const riesgo = dimRiesgo(state, asOf);
  const valorEsperado = dimValorEsperado(state, opciones);

  // Probabilidad de compra: requiere actividad e interés evaluables.
  let probabilidadCompra: DimensionPuntaje;
  if (!actividad.evaluable || !interes.evaluable) {
    const faltantes = [...actividad.faltantes, ...interes.faltantes];
    probabilidadCompra = noEvaluable('probabilidadCompra', faltantes.length ? faltantes : ['faltan señales para estimar la probabilidad de compra']);
  } else {
    const v = clamp01(0.4 * (interes.valor ?? 0) + 0.35 * (actividad.valor ?? 0) + 0.25 * (relacion.valor ?? 0) - 0.3 * (riesgo.valor ?? 0));
    probabilidadCompra = {
      dimension: 'probabilidadCompra',
      evaluable: true,
      valor: v,
      montoEstimado: null,
      banda: bandaDe(v),
      confianza: minConfianza([interes.confianza, actividad.confianza, relacion.confianza]),
      factores: [
        factor(`interés ${interes.banda}`, (interes.valor ?? 0) >= 0.5 ? 'SUBE' : 'BAJA'),
        factor(`actividad ${actividad.banda}`, (actividad.valor ?? 0) >= 0.5 ? 'SUBE' : 'BAJA'),
        factor(`riesgo ${riesgo.banda}`, (riesgo.valor ?? 0) >= 0.5 ? 'BAJA' : 'NEUTRO'),
      ],
      faltantes: [],
    };
  }

  // Prioridad: probabilidad × valor esperado normalizado. Sin escala de valor → NO EVALUABLE.
  let prioridad: DimensionPuntaje;
  if (!probabilidadCompra.evaluable) {
    prioridad = noEvaluable('prioridad', probabilidadCompra.faltantes);
  } else if (!valorEsperado.evaluable || valorEsperado.valor == null) {
    prioridad = noEvaluable('prioridad', [
      ...(valorEsperado.evaluable ? valorEsperado.faltantes : ['no se puede priorizar sin un valor esperado evaluable']),
    ]);
  } else {
    const v = clamp01((probabilidadCompra.valor ?? 0) * valorEsperado.valor);
    prioridad = {
      dimension: 'prioridad',
      evaluable: true,
      valor: v,
      montoEstimado: null,
      banda: bandaDe(v),
      confianza: minConfianza([probabilidadCompra.confianza, valorEsperado.confianza]),
      factores: [factor(`probabilidad ${probabilidadCompra.banda} × valor ${valorEsperado.banda}`, 'NEUTRO')],
      faltantes: [],
    };
  }

  return { contactoId: state.contactoId, asOf, dimensiones: { actividad, interes, relacion, riesgo, probabilidadCompra, valorEsperado, prioridad } };
}

// ── Recomendación explicada ──────────────────────────────────────────────────────────────────

function faltantesGlobales(p: PuntajeContacto): string[] {
  const set = new Set<string>();
  for (const d of Object.values(p.dimensiones)) for (const f of d.faltantes) set.add(f);
  return [...set];
}

/**
 * Deriva el "siguiente paso recomendado" de un contacto. Si no hay base suficiente (actividad o
 * probabilidad no evaluables), ABSTIENE honestamente. Nunca recomienda sin razones ni evidencia.
 */
export function recomendarSiguientePaso(state: ContactoState, p: PuntajeContacto): RecomendacionExplicada {
  const d = p.dimensiones;
  if (!d.actividad.evaluable || !d.probabilidadCompra.evaluable) {
    return { tipo: 'ABSTENCION', motivo: 'datos insuficientes para recomendar una acción fundamentada', faltantes: faltantesGlobales(p) };
  }
  const compras = state.actividades.filter((a) => a.tipo === 'COMPRA').length;
  const diasInactivo = state.ultimaActividadEn ? diasEntre(state.ultimaActividadEn, p.asOf) : VENTANA_DIAS;
  const evidencia = state.actividades.slice(-3).map((a) => `${a.tipo}@${a.en}`);

  const CATALOGO: Record<string, string> = {
    postventa: 'seguimiento post-venta y venta cruzada',
    reactivacion: 'reactivación con seguimiento personalizado',
    oferta: 'enviar propuesta u oferta comercial',
    nutrir: 'nutrir con contenido educativo',
  };

  let clave: keyof typeof CATALOGO;
  const razones: string[] = [];
  if (compras >= 1 && diasInactivo <= 90) {
    clave = 'postventa';
    razones.push(`tiene ${compras} compra(s) y actividad reciente (${diasInactivo} día(s))`);
  } else if (d.riesgo.banda === 'ALTA' && (d.relacion.valor ?? 0) >= 0.33) {
    clave = 'reactivacion';
    razones.push(`relación previa con riesgo de pérdida alto (${diasInactivo} día(s) inactivo)`);
  } else if (d.interes.banda !== 'BAJA' && compras === 0) {
    clave = 'oferta';
    razones.push(`interés ${d.interes.banda} sin compra aún; probabilidad ${d.probabilidadCompra.banda}`);
  } else {
    clave = 'nutrir';
    razones.push(`interés ${d.interes.banda}; conviene nutrir antes de ofertar`);
  }

  const alternativasDescartadas: AlternativaDescartada[] = Object.entries(CATALOGO)
    .filter(([k]) => k !== clave)
    .map(([k, accion]) => ({ accion, motivo: motivoDescarte(k, { compras, diasInactivo, d }) }));

  return {
    tipo: 'RECOMENDACION',
    accion: CATALOGO[clave]!,
    razones,
    evidenciaUsada: evidencia,
    alternativasDescartadas,
    confianza: d.probabilidadCompra.confianza,
    queFalta: faltantesGlobales(p),
  };
}

function motivoDescarte(clave: string, ctx: { compras: number; diasInactivo: number; d: PuntajeContacto['dimensiones'] }): string {
  switch (clave) {
    case 'postventa':
      return ctx.compras === 0 ? 'aún no hay compra para dar seguimiento post-venta' : 'la actividad no es lo bastante reciente';
    case 'reactivacion':
      return ctx.d.riesgo.banda !== 'ALTA' ? 'el riesgo de pérdida no es alto todavía' : 'no hay relación previa suficiente';
    case 'oferta':
      return ctx.d.interes.banda === 'BAJA' ? 'el interés es bajo; ofertar sería prematuro' : ctx.compras > 0 ? 'ya es cliente; corresponde otra acción' : 'no priorizada frente a la acción elegida';
    case 'nutrir':
      return 'hay señales suficientes para una acción más directa';
    default:
      return 'no priorizada';
  }
}
