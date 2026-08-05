/**
 * @soec/motor-optimizacion · dominio · MOTOR DE EVALUACIÓN COMPARATIVA (puro, determinista, explicable).
 *
 * Compara alternativas por DIMENSIONES declaradas según políticas versionadas. No reduce todo a una sola
 * puntuación opaca: cada alternativa lleva su veredicto por dimensión y su explicación. Resultados:
 * PREFERIDA · VIABLE · DOMINADA · NO_COMPARABLE · NO_EVALUABLE · RECHAZADA_POR_POLITICA.
 */
import type { Alternativa, Confianza } from './optimizacion-tipos';
import { esExperimentoControlado } from './optimizacion-tipos';

export const COMPARACION_VERSION = 'comparacion@1';
export type ResultadoComparacion = 'PREFERIDA' | 'VIABLE' | 'DOMINADA' | 'NO_COMPARABLE' | 'NO_EVALUABLE' | 'RECHAZADA_POR_POLITICA';

export interface PoliticaOptimizacion {
  readonly version: string;
  readonly requiereExperimentoControlado: boolean; // si true, sólo se admite cambiar UNA variable
  readonly exigirLimitePresupuesto: boolean; // si true, costo desconocido/excedido ⇒ rechazo
  readonly topePresupuesto: number;
  readonly confianzaMinima: Confianza;
  readonly permitirIrreversibleAltoRiesgo: boolean;
}

export interface DimensionComparada { readonly nombre: string; readonly veredicto: 'ok' | 'debil' | 'falla'; readonly nota: string }
export interface AlternativaComparada {
  readonly alternativaId: string;
  readonly resultado: ResultadoComparacion;
  readonly puntaje: number | null; // null si no evaluable/rechazada; acompañado SIEMPRE de dimensiones
  readonly dimensiones: readonly DimensionComparada[];
  readonly explicacion: string;
}

const RANK: Record<Confianza, number> = { nula: 0, baja: 1, media: 2, alta: 3 };
const RIESGO_PESO = { bajo: 0, medio: 1, alto: 2 } as const;

function dimensiones(a: Alternativa, pol: PoliticaOptimizacion): DimensionComparada[] {
  return [
    { nombre: 'evidencia', veredicto: a.evidencia.length > 0 ? 'ok' : 'falla', nota: `${a.evidencia.length} piezas de evidencia` },
    { nombre: 'confianza', veredicto: RANK[a.alcance === 'TRANSFERIBLE' ? 'alta' : 'media'] >= RANK[pol.confianzaMinima] ? 'ok' : 'debil', nota: `alcance ${a.alcance}` },
    { nombre: 'riesgo', veredicto: a.riesgo === 'bajo' ? 'ok' : a.riesgo === 'medio' ? 'debil' : 'falla', nota: `riesgo ${a.riesgo}` },
    { nombre: 'costo', veredicto: a.costoEstimado <= pol.topePresupuesto ? 'ok' : 'falla', nota: `costo ${a.costoEstimado} vs tope ${pol.topePresupuesto}` },
    { nombre: 'experimento_controlado', veredicto: !pol.requiereExperimentoControlado || esExperimentoControlado(a) ? 'ok' : 'falla', nota: `cambia ${a.cambia.length} variable(s)` },
    { nombre: 'reversibilidad', veredicto: a.planReversion.trim() ? 'ok' : 'debil', nota: a.planReversion ? 'con plan de reversión' : 'sin plan de reversión' },
    { nombre: 'condiciones_abandono', veredicto: a.condicionesAbandono.length > 0 ? 'ok' : 'debil', nota: `${a.condicionesAbandono.length} condiciones de abandono` },
  ];
}

export function compararAlternativas(pol: PoliticaOptimizacion, alternativas: readonly Alternativa[]): readonly AlternativaComparada[] {
  // NO_COMPARABLE: KPIs distintos entre alternativas ⇒ no se comparan entre sí.
  const kpis = new Set(alternativas.map((a) => a.kpiAfectado));
  const noComparable = kpis.size > 1;

  const parciales = alternativas.map((a) => {
    const dims = dimensiones(a, pol);
    const violaControlado = pol.requiereExperimentoControlado && !esExperimentoControlado(a);
    const violaPresupuesto = pol.exigirLimitePresupuesto && a.costoEstimado > pol.topePresupuesto;
    const violaIrreversible = !pol.permitirIrreversibleAltoRiesgo && a.riesgo === 'alto';
    const rechazadaPolitica = violaControlado || violaPresupuesto || violaIrreversible;
    const noEvaluable = a.evidencia.length === 0;

    let resultado: ResultadoComparacion;
    let puntaje: number | null = null;
    if (rechazadaPolitica) resultado = 'RECHAZADA_POR_POLITICA';
    else if (noComparable) resultado = 'NO_COMPARABLE';
    else if (noEvaluable) resultado = 'NO_EVALUABLE';
    else {
      // Puntaje explicable: evidencia + reversibilidad − riesgo − costo relativo.
      puntaje = a.evidencia.length + (a.planReversion.trim() ? 1 : 0) - RIESGO_PESO[a.riesgo] - a.costoEstimado / Math.max(1, pol.topePresupuesto);
      resultado = 'VIABLE';
    }
    const explicacion = rechazadaPolitica ? `rechazada por política (${[violaControlado && 'multi-variable', violaPresupuesto && 'presupuesto', violaIrreversible && 'irreversible+riesgo'].filter(Boolean).join(', ')})`
      : noComparable ? 'KPIs distintos entre alternativas: no comparables'
      : noEvaluable ? 'sin evidencia suficiente para evaluar'
      : `viable (puntaje ${puntaje!.toFixed(2)})`;
    return { alternativaId: a.alternativaId, resultado, puntaje, dimensiones: dims, explicacion };
  });

  // PREFERIDA / DOMINADA entre las VIABLES.
  const viables = parciales.filter((p) => p.resultado === 'VIABLE' && p.puntaje !== null);
  if (viables.length === 0) return parciales;
  const mejor = viables.reduce((m, p) => (p.puntaje! > m.puntaje! ? p : m));
  return parciales.map((p) => {
    if (p.resultado !== 'VIABLE') return p;
    if (p.alternativaId === mejor.alternativaId) return { ...p, resultado: 'PREFERIDA', explicacion: `preferida (puntaje ${p.puntaje!.toFixed(2)})` };
    // DOMINADA si otra viable la supera en puntaje (aquí: la mejor la domina).
    return { ...p, resultado: 'DOMINADA', explicacion: `dominada por ${mejor.alternativaId}` };
  });
}
