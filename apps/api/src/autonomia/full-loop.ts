/**
 * apps/api · V2-C · AUTONOMOUS CAMPAIGN LOOP COMPLETO (SHADOW). Cierra el ciclo entero:
 *   Director → evidencia → estrategia → contenido/creative → campaña → Budget Guard → ejecución simulada →
 *   observación → optimización → nueva decisión.
 * Todo en dry-run/shadow: 0 escrituras reales, 0 gasto real. Invariante duro verificable en cada ronda:
 *   committedSpend (real+proyectado) <= authorizedBudget del mandato. La inteligencia opera SÓLO dentro del
 *   mandato; cualquier necesidad de más dinero queda AWAITING_HUMAN_APPROVAL.
 */
import type { DepsActionPlane } from '../accion/action-plane';
import type { MetaWritePort } from '../campana/meta-write-port';
import type { Mandato } from '../accion/mandato';
import { restanteMinor } from '../accion/mandato';
import { construirCampaignPlan, type CampaignPlan } from '../campana/campaign-plan';
import { ejecutarCampana, type ResultadoEjecucionCampana } from '../campana/campaign-execution';
import type { PerfilNegocio, ObjetivoCampana, Placement } from '../campana/content-engine';
import { correrCicloAutonomo, type ShadowRun } from './autonomous-loop';
import type { ObservacionAnuncio } from './performance';
import type { UmbralesDecision } from './decision-engine';

export interface EntradaLoopCompleto {
  readonly mandato: Mandato;
  readonly perfil: PerfilNegocio;
  readonly objetivo: ObjetivoCampana;
  readonly placement: Placement;
  readonly adAccountId: string;
  readonly presupuestoDeseadoMinor: number;
  readonly rondasObservaciones: readonly (readonly ObservacionAnuncio[])[]; // una lista de observaciones por ronda
  readonly umbrales?: UmbralesDecision;
}

export interface RondaLoop {
  readonly indice: number;
  readonly shadow: ShadowRun;
  readonly committedMasProyectadoMinor: number; // acumulado (real 0 + proyectado de la campaña)
  readonly invarianteOk: boolean; // committed+proyectado <= authorizedBudget
}

export interface ResultadoLoopCompleto {
  readonly organizationId: string;
  readonly mandatoId: string;
  readonly plan: CampaignPlan;
  readonly ejecucionInicial: ResultadoEjecucionCampana;
  readonly rondas: readonly RondaLoop[];
  readonly gastoRealTotalMinor: number; // invariante: 0 en shadow
  readonly metaWriteCallsReales: number; // invariante: 0 en shadow
  readonly invarianteGlobalOk: boolean; // TODAS las rondas respetaron el techo
  readonly resumen: string;
}

/**
 * Corre el loop completo. Ronda 0 = construir estrategia + campaña y ejecutarla en dry-run. Rondas 1..n =
 * observar → decidir → optimizar (pausar bajo rendimiento / recomendar aumento a humano). Idempotente por
 * planId + keys del Action Plane. NUNCA supera el techo, ni siquiera en proyección (shadow).
 */
export async function correrLoopCompleto(deps: DepsActionPlane, port: MetaWritePort, e: EntradaLoopCompleto): Promise<ResultadoLoopCompleto> {
  const plan = construirCampaignPlan({
    perfil: e.perfil, objetivo: e.objetivo, placement: e.placement, adAccountId: e.adAccountId,
    moneda: e.mandato.currency, presupuestoDeseadoMinor: e.presupuestoDeseadoMinor, restanteMandatoMinor: restanteMinor(e.mandato),
  });
  const planId = `loop-${e.mandato.id}`;
  const ejecucionInicial = await ejecutarCampana(deps, port, e.mandato, plan, planId);

  const rondas: RondaLoop[] = [];
  let metaWriteCallsReales = ejecucionInicial.metaWriteCallsReales;
  let invarianteGlobalOk = ejecucionInicial.gastoProyectadoMinor <= e.mandato.authorizedBudgetMinor;

  for (let i = 0; i < e.rondasObservaciones.length; i++) {
    const shadow = await correrCicloAutonomo(deps, port, { mandato: e.mandato, adAccountId: e.adAccountId, observaciones: e.rondasObservaciones[i]!, ...(e.umbrales ? { umbrales: e.umbrales } : {}) });
    metaWriteCallsReales += shadow.metaWriteCallsReales;
    // El compromiso máximo posible es el gasto proyectado de la campaña (una sola vez) + 0 real de las pausas.
    const committedMasProyectadoMinor = ejecucionInicial.gastoProyectadoMinor + shadow.gastoRealComprometidoMinor;
    const invarianteOk = committedMasProyectadoMinor <= e.mandato.authorizedBudgetMinor;
    if (!invarianteOk) invarianteGlobalOk = false;
    rondas.push({ indice: i, shadow, committedMasProyectadoMinor, invarianteOk });
  }

  const gastoRealTotalMinor = ejecucionInicial.gastoComprometidoMinor + rondas.reduce((a, r) => a + r.shadow.gastoRealComprometidoMinor, 0);
  const recomendaciones = rondas.reduce((a, r) => a + r.shadow.recomendacionesFinancieras.length, 0);
  return {
    organizationId: e.mandato.organizationId,
    mandatoId: e.mandato.id,
    plan,
    ejecucionInicial,
    rondas,
    gastoRealTotalMinor,
    metaWriteCallsReales,
    invarianteGlobalOk,
    resumen: `Loop completo en shadow: campaña + ${rondas.length} ronda(s) de optimización, ${recomendaciones} recomendación(es) para aprobación humana. Gasto real ${gastoRealTotalMinor}, writes reales ${metaWriteCallsReales}. Techo respetado: ${invarianteGlobalOk ? 'sí' : 'NO'}.`,
  };
}
