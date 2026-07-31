/**
 * @soec/crm-comercial · dominio · Scoring multidimensional EXPLICABLE y recomendación fundamentada.
 *
 * Funciones puras y deterministas. Ninguna dimensión se inventa: si falta información, es NO
 * EVALUABLE (Evaluabilidad). N-1: TODA la mecánica decisoria (pesos, umbrales, ventanas, reglas de
 * confianza y de recomendación) viene de una POLÍTICA gobernada y versionada, y ninguna función
 * interna lee la política por defecto — solo la frontera pública selecciona `POLITICA_SCORING_V1`.
 * La confianza deriva de la EVIDENCIA (origen, cobertura, contradicción). El puntaje es HEURÍSTICO.
 */
import { type Confianza, confianzaPorDefecto } from '@soec/negocio';
import type { Actividad, ContactoState } from './contacto';
import type { AlternativaDescartada, Banda, Factor, RecomendacionExplicada } from './explicabilidad';
import { POLITICA_SCORING_V1, type PoliticaScoringComercial, validarPolitica } from './politica-scoring';

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
  readonly valor: number | null;
  readonly montoEstimado: number | null;
  readonly banda: Banda | null;
  readonly confianza: Confianza;
  readonly factores: readonly Factor[];
  readonly faltantes: readonly string[];
}

export interface PuntajeContacto {
  readonly contactoId: string;
  readonly asOf: string;
  /** Naturaleza declarada: es un puntaje HEURÍSTICO, no una probabilidad estadística. */
  readonly naturaleza: 'HEURISTICO';
  readonly politicaVersion: string;
  readonly dimensiones: Readonly<Record<DimensionNombre, DimensionPuntaje>>;
}

export interface OpcionesPuntaje {
  /** Valor monetario de referencia para normalizar el valor esperado en banda 0..1. */
  readonly valorReferencia?: number;
  /** Política de scoring gobernada; por defecto V1 (única selección del default). */
  readonly politica?: PoliticaScoringComercial;
}

const DIA_MS = 86_400_000;
/** Umbrales de ETIQUETA (SUBE/NEUTRO en los factores explicativos): cosméticos, no alteran el valor
 * numérico ni la banda; se mantienen fuera de la política a propósito. */
const ETIQUETA_SUBE = 0.5;
const ETIQUETA_FRECUENCIA = 0.3;
const ETIQUETA_ANTIGUEDAD_DIAS = 90;

function diasEntre(aISO: string, bISO: string): number {
  return Math.floor((Date.parse(bISO) - Date.parse(aISO)) / DIA_MS);
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function bandaDe(v: number, P: PoliticaScoringComercial): Banda {
  return v >= P.umbralBandaAlta ? 'ALTA' : v >= P.umbralBandaMedia ? 'MEDIA' : 'BAJA';
}
const RANGO: Record<Exclude<Confianza, null>, number> = { BAJA: 1, MEDIA: 2, ALTA: 3 };
function rango(c: Confianza): number {
  return c === null ? 0 : RANGO[c];
}
function minConfianza(cs: readonly Confianza[]): Confianza {
  let min: Confianza = 'ALTA';
  for (const c of cs) {
    if (c === null) return null;
    if (rango(c) < rango(min)) min = c;
  }
  return min;
}
function degradar(c: Confianza): Confianza {
  return c === 'ALTA' ? 'MEDIA' : c === 'MEDIA' ? 'BAJA' : c;
}

/**
 * N-1: la confianza deriva de la EVIDENCIA y de la POLÍTICA — mejor origen presente (vía
 * `confianzaPorDefecto`), acotada por la cobertura (`coberturaMinimaParaAlta`: sin suficientes
 * señales no se alcanza ALTA) y degradada si hay contradicción (`degradaPorContradiccion`).
 */
function confianzaDesdeEvidencia(acts: readonly Actividad[], hayContradiccion: boolean, P: PoliticaScoringComercial): Confianza {
  if (acts.length === 0) return null;
  let mejor: Confianza = 'BAJA';
  for (const a of acts) {
    const c = confianzaPorDefecto(a.origen);
    if (rango(c) > rango(mejor)) mejor = c;
  }
  let c: Confianza = mejor;
  if (acts.length < P.confianza.coberturaMinimaParaAlta && rango(c) > rango('MEDIA')) c = 'MEDIA';
  if (hayContradiccion && P.confianza.degradaPorContradiccion) c = degradar(c);
  return c;
}

function contar(state: ContactoState, tipos: readonly string[]): number {
  return state.actividades.filter((a) => tipos.includes(a.tipo)).length;
}
function actsDe(state: ContactoState, tipos: readonly string[]): Actividad[] {
  return state.actividades.filter((a) => tipos.includes(a.tipo));
}
function noEvaluable(dim: DimensionNombre, faltantes: readonly string[]): DimensionPuntaje {
  return { dimension: dim, evaluable: false, valor: null, montoEstimado: null, banda: null, confianza: null, factores: [], faltantes };
}
function factor(descripcion: string, efecto: Factor['efecto'], evidencia?: string): Factor {
  return { descripcion, efecto, ...(evidencia ? { evidencia } : {}) };
}

const POSITIVAS = ['CONSULTA', 'RESPUESTA_POSITIVA', 'VISITA'] as const;
const NEGATIVAS = ['RESPUESTA_NEGATIVA', 'NO_ASISTIO'] as const;

// ── Dimensiones individuales (todas reciben la política) ────────────────────────────────────────

function dimActividad(state: ContactoState, asOf: string, P: PoliticaScoringComercial): DimensionPuntaje {
  const n = state.actividades.length;
  if (n === 0 || !state.ultimaActividadEn) return noEvaluable('actividad', ['sin actividad registrada del contacto']);
  const dias = diasEntre(state.ultimaActividadEn, asOf);
  const recencia = clamp01(1 - dias / P.ventanaDias);
  const frecuencia = clamp01(n / P.frecuenciaTope);
  const valor = clamp01(P.pesos.actividad.recencia * recencia + P.pesos.actividad.frecuencia * frecuencia);
  return {
    dimension: 'actividad',
    evaluable: true,
    valor,
    montoEstimado: null,
    banda: bandaDe(valor, P),
    confianza: confianzaDesdeEvidencia(state.actividades, false, P),
    factores: [
      factor(`${n} actividad(es) registradas`, frecuencia >= ETIQUETA_FRECUENCIA ? 'SUBE' : 'NEUTRO', state.actividades.at(-1)?.actividadId),
      factor(`última actividad hace ${dias} día(s)`, recencia >= ETIQUETA_SUBE ? 'SUBE' : 'BAJA'),
    ],
    faltantes: [],
  };
}

function dimInteres(state: ContactoState, P: PoliticaScoringComercial): DimensionPuntaje {
  const compras = contar(state, ['COMPRA']);
  const positivasSuaves = contar(state, POSITIVAS);
  const negativas = contar(state, NEGATIVAS);
  const relevantes = actsDe(state, ['COMPRA', ...POSITIVAS, ...NEGATIVAS]);
  if (relevantes.length === 0) return noEvaluable('interes', ['sin señales de interés (consultas, respuestas, visitas, compras)']);
  const valor = clamp01(P.pesos.interes.base + P.pesos.interes.pesoCompra * compras + P.pesos.interes.positivo * positivasSuaves - P.pesos.interes.negativo * negativas);
  const contradiccion = compras + positivasSuaves > 0 && negativas > 0;
  return {
    dimension: 'interes',
    evaluable: true,
    valor,
    montoEstimado: null,
    banda: bandaDe(valor, P),
    confianza: confianzaDesdeEvidencia(relevantes, contradiccion, P),
    factores: [
      factor(`${compras} compra(s) — interés demostrado`, compras > 0 ? 'SUBE' : 'NEUTRO'),
      factor(`${positivasSuaves} señal(es) positiva(s)`, positivasSuaves > 0 ? 'SUBE' : 'NEUTRO'),
      factor(`${negativas} señal(es) negativa(s)`, negativas > 0 ? 'BAJA' : 'NEUTRO'),
    ],
    faltantes: [],
  };
}

function dimRelacion(state: ContactoState, asOf: string, P: PoliticaScoringComercial): DimensionPuntaje {
  const compras = contar(state, ['COMPRA']);
  const antiguedad = state.creadoEn ? diasEntre(state.creadoEn, asOf) : 0;
  const valor = clamp01(
    P.pesos.relacion.compras * clamp01(compras / P.comprasPlenas) +
      P.pesos.relacion.antiguedad * clamp01(antiguedad / P.antiguedadPlenaDias) +
      P.pesos.relacion.actividad * clamp01(state.actividades.length / (P.frecuenciaTope * P.factorRelacionActividad)),
  );
  return {
    dimension: 'relacion',
    evaluable: true,
    valor,
    montoEstimado: null,
    banda: bandaDe(valor, P),
    confianza: state.actividades.length > 0 ? confianzaDesdeEvidencia(state.actividades, false, P) : 'BAJA',
    factores: [
      factor(`${compras} compra(s) histórica(s)`, compras > 0 ? 'SUBE' : 'NEUTRO'),
      factor(`antigüedad ${antiguedad} día(s)`, antiguedad > ETIQUETA_ANTIGUEDAD_DIAS ? 'SUBE' : 'NEUTRO'),
    ],
    faltantes: [],
  };
}

function dimRiesgo(state: ContactoState, asOf: string, P: PoliticaScoringComercial): DimensionPuntaje {
  const ref = state.ultimaActividadEn ?? state.creadoEn;
  if (!ref) return noEvaluable('riesgo', ['sin fecha de referencia para estimar inactividad']);
  const diasInactivo = diasEntre(ref, asOf);
  const negativas = contar(state, NEGATIVAS);
  const valor = clamp01(P.pesos.riesgo.inactividadPorVentana * (diasInactivo / P.ventanaDias) + P.pesos.riesgo.negativa * negativas);
  return {
    dimension: 'riesgo',
    evaluable: true,
    valor,
    montoEstimado: null,
    banda: bandaDe(valor, P),
    confianza: state.actividades.length > 0 ? confianzaDesdeEvidencia(state.actividades, false, P) : 'BAJA',
    factores: [
      factor(`${diasInactivo} día(s) de inactividad`, diasInactivo > ETIQUETA_ANTIGUEDAD_DIAS ? 'SUBE' : 'NEUTRO'),
      factor(`${negativas} respuesta(s) negativa(s)/inasistencia(s)`, negativas > 0 ? 'SUBE' : 'NEUTRO'),
    ],
    faltantes: [],
  };
}

function dimValorEsperado(state: ContactoState, valorReferencia: number | undefined, P: PoliticaScoringComercial): DimensionPuntaje {
  const comprasConValor = state.actividades.filter((a) => a.tipo === 'COMPRA' && a.valor != null);
  const montoHistorico = comprasConValor.length > 0 ? comprasConValor.reduce((s, a) => s + (a.valor ?? 0), 0) / comprasConValor.length : null;
  const monto = montoHistorico ?? valorReferencia ?? null;
  if (monto == null) return noEvaluable('valorEsperado', ['sin valor de compra histórico ni valor de referencia del rubro/producto']);
  const faltantes: string[] = [];
  let valor: number | null = null;
  let banda: Banda | null = null;
  if (valorReferencia != null && valorReferencia > 0) {
    valor = clamp01(monto / valorReferencia);
    banda = bandaDe(valor, P);
  } else {
    faltantes.push('sin valor de referencia para normalizar en banda (se reporta el monto)');
  }
  return {
    dimension: 'valorEsperado',
    evaluable: true,
    valor,
    montoEstimado: monto,
    banda,
    confianza: montoHistorico != null ? confianzaDesdeEvidencia(comprasConValor, false, P) : 'BAJA',
    factores: [factor(montoHistorico != null ? `monto medio de ${comprasConValor.length} compra(s)` : 'valor de referencia del rubro', montoHistorico != null ? 'SUBE' : 'NEUTRO')],
    faltantes,
  };
}

// ── Composición (frontera pública: única selección de la política por defecto) ──────────────────

export function puntuarContacto(state: ContactoState, asOf: string, opciones: OpcionesPuntaje = {}): PuntajeContacto {
  const P = opciones.politica ?? POLITICA_SCORING_V1;
  validarPolitica(P);
  const actividad = dimActividad(state, asOf, P);
  const interes = dimInteres(state, P);
  const relacion = dimRelacion(state, asOf, P);
  const riesgo = dimRiesgo(state, asOf, P);
  const valorEsperado = dimValorEsperado(state, opciones.valorReferencia, P);

  let probabilidadCompra: DimensionPuntaje;
  if (!actividad.evaluable || !interes.evaluable) {
    const faltantes = [...actividad.faltantes, ...interes.faltantes];
    probabilidadCompra = noEvaluable('probabilidadCompra', faltantes.length ? faltantes : ['faltan señales para estimar la probabilidad de compra']);
  } else {
    const w = P.pesos.probabilidad;
    const v = clamp01(w.interes * (interes.valor ?? 0) + w.actividad * (actividad.valor ?? 0) + w.relacion * (relacion.valor ?? 0) - w.riesgo * (riesgo.valor ?? 0));
    probabilidadCompra = {
      dimension: 'probabilidadCompra',
      evaluable: true,
      valor: v,
      montoEstimado: null,
      banda: bandaDe(v, P),
      confianza: minConfianza([interes.confianza, actividad.confianza, relacion.confianza]),
      factores: [
        factor(`interés ${interes.banda}`, (interes.valor ?? 0) >= ETIQUETA_SUBE ? 'SUBE' : 'BAJA'),
        factor(`actividad ${actividad.banda}`, (actividad.valor ?? 0) >= ETIQUETA_SUBE ? 'SUBE' : 'BAJA'),
        factor(`riesgo ${riesgo.banda}`, (riesgo.valor ?? 0) >= ETIQUETA_SUBE ? 'BAJA' : 'NEUTRO'),
      ],
      faltantes: [],
    };
  }

  let prioridad: DimensionPuntaje;
  if (!probabilidadCompra.evaluable) {
    prioridad = noEvaluable('prioridad', probabilidadCompra.faltantes);
  } else if (!valorEsperado.evaluable || valorEsperado.valor == null) {
    prioridad = noEvaluable('prioridad', valorEsperado.evaluable ? valorEsperado.faltantes : ['no se puede priorizar sin un valor esperado evaluable']);
  } else {
    const v = clamp01((probabilidadCompra.valor ?? 0) * valorEsperado.valor);
    prioridad = {
      dimension: 'prioridad',
      evaluable: true,
      valor: v,
      montoEstimado: null,
      banda: bandaDe(v, P),
      confianza: minConfianza([probabilidadCompra.confianza, valorEsperado.confianza]),
      factores: [factor(`probabilidad ${probabilidadCompra.banda} × valor ${valorEsperado.banda}`, 'NEUTRO')],
      faltantes: [],
    };
  }

  return {
    contactoId: state.contactoId,
    asOf,
    naturaleza: 'HEURISTICO',
    politicaVersion: P.version,
    dimensiones: { actividad, interes, relacion, riesgo, probabilidadCompra, valorEsperado, prioridad },
  };
}

// ── Recomendación explicada (frontera pública) ─────────────────────────────────────────────────

function faltantesGlobales(p: PuntajeContacto): string[] {
  const set = new Set<string>();
  for (const d of Object.values(p.dimensiones)) for (const f of d.faltantes) set.add(f);
  return [...set];
}

export function recomendarSiguientePaso(state: ContactoState, p: PuntajeContacto, politica: PoliticaScoringComercial = POLITICA_SCORING_V1): RecomendacionExplicada {
  const P = politica;
  const d = p.dimensiones;
  if (!d.actividad.evaluable || !d.probabilidadCompra.evaluable) {
    return { tipo: 'ABSTENCION', motivo: 'datos insuficientes para recomendar una acción fundamentada', faltantes: faltantesGlobales(p) };
  }
  const compras = state.actividades.filter((a) => a.tipo === 'COMPRA').length;
  const diasInactivo = state.ultimaActividadEn ? diasEntre(state.ultimaActividadEn, p.asOf) : P.ventanaDias;
  const evidencia = state.actividades.slice(-3).map((a) => `${a.tipo}@${a.en}#${a.actividadId}`);

  const CATALOGO: Record<string, string> = {
    postventa: 'seguimiento post-venta y venta cruzada',
    reactivacion: 'reactivación con seguimiento personalizado',
    oferta: 'enviar propuesta u oferta comercial',
    nutrir: 'nutrir con contenido educativo',
  };

  let clave: keyof typeof CATALOGO;
  const razones: string[] = [];
  if (compras >= 1 && diasInactivo <= P.recomendacion.diasRecienteCompra) {
    clave = 'postventa';
    razones.push(`tiene ${compras} compra(s) y actividad reciente (${diasInactivo} día(s))`);
  } else if (d.riesgo.banda === 'ALTA' && (d.relacion.valor ?? 0) >= P.recomendacion.relacionMinReactivacion) {
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
    .map(([k, accion]) => ({ accion, motivo: motivoDescarte(k, { compras, d }) }));

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

function motivoDescarte(clave: string, ctx: { compras: number; d: PuntajeContacto['dimensiones'] }): string {
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
