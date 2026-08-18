/**
 * apps/api · V2-C · AUTONOMOUS LOOP (SHADOW). Ciclo observe → decide → optimize que se comporta como si
 * administrara real pero SIN escribir a Meta: cada acción pasa por el Action Plane (dry-run) y persiste un
 * ShadowRun con qué habría hecho, por qué, cuánto habría comprometido (0 real) y la evidencia. El loop JAMÁS
 * llama a reautorizar ni aumenta presupuesto: las recomendaciones financieras quedan para aprobación humana.
 */
import type { DepsActionPlane } from '../accion/action-plane';
import { procesarAccion } from '../accion/action-plane';
import type { AccionPropuesta } from '../accion/budget-guard';
import type { Mandato } from '../accion/mandato';
import type { MetaWritePort } from '../campana/meta-write-port';
import { derivarLote, type ObservacionAnuncio, type MetricasAnuncio } from './performance';
import { decidir, type Decision, type RecomendacionFinanciera, type UmbralesDecision, UMBRALES_DEFECTO } from './decision-engine';
import { planificarOptimizaciones } from './optimization-engine';

export interface AccionShadow {
  readonly adRef: string;
  readonly actionType: string;
  readonly estado: 'SIMULADA' | 'EJECUTADA' | 'RECHAZADA';
  readonly bloqueos: readonly string[];
  readonly externalRef: string | null;
  readonly razon: string;
}

export interface ShadowRun {
  readonly organizationId: string;
  readonly mandatoId: string;
  readonly ranAt: string;
  readonly modo: 'SHADOW' | 'REAL';
  readonly metricas: readonly MetricasAnuncio[];
  readonly decisiones: readonly Decision[];
  readonly recomendacionesFinancieras: readonly RecomendacionFinanciera[];
  readonly acciones: readonly AccionShadow[];
  readonly gastoRealComprometidoMinor: number; // invariante: 0 en shadow
  readonly metaWriteCallsReales: number; // invariante: 0 en shadow
  readonly resumen: string;
}

export interface ShadowRunRepo {
  guardar(run: ShadowRun): Promise<void>;
  ultimos(organizationId: string, mandatoId: string, limite?: number): Promise<readonly ShadowRun[]>;
}

export class InMemoryShadowRunRepo implements ShadowRunRepo {
  private readonly runs: ShadowRun[] = [];
  async guardar(run: ShadowRun): Promise<void> {
    this.runs.push(run);
  }
  async ultimos(org: string, mandatoId: string, limite = 20): Promise<readonly ShadowRun[]> {
    return this.runs.filter((r) => r.organizationId === org && r.mandatoId === mandatoId).slice(-limite).reverse();
  }
}

export interface EntradaCiclo {
  readonly mandato: Mandato;
  readonly adAccountId: string; // activo autorizado; assetId de las acciones de control
  readonly observaciones: readonly ObservacionAnuncio[];
  readonly umbrales?: UmbralesDecision;
}

/**
 * Corre un ciclo autónomo en SHADOW. Devuelve el ShadowRun (no lo persiste; el caller decide). Toda acción de
 * optimización pasa por el Action Plane dry-run; el port solo se invoca tras veredicto permitido.
 */
export async function correrCicloAutonomo(deps: DepsActionPlane, port: MetaWritePort, e: EntradaCiclo): Promise<ShadowRun> {
  const ahora = deps.ahora();
  const modo: 'SHADOW' | 'REAL' = deps.autonomousReal ? 'REAL' : 'SHADOW';
  const metricas = derivarLote(e.observaciones);
  const { decisiones, recomendacionesFinancieras } = decidir(e.mandato, metricas, e.umbrales ?? UMBRALES_DEFECTO);
  const optimizaciones = planificarOptimizaciones(decisiones);

  let mandato = e.mandato;
  let metaWriteCallsReales = 0;
  const acciones: AccionShadow[] = [];

  for (const opt of optimizaciones) {
    const accion: AccionPropuesta = {
      organizationId: e.mandato.organizationId,
      mandatoId: e.mandato.id,
      idempotencyKey: `optim:${e.mandato.id}:${opt.adRef}:pause`,
      actionType: opt.actionType, // PAUSE_AD: orgánico, costo 0
      assetId: e.adAccountId, // el ad pertenece a la cuenta autorizada; el adRef va como razón/evidencia
      costMinor: 0,
      currency: e.mandato.currency,
      propuestaPor: 'director',
    };
    const r = await procesarAccion(deps, mandato, accion);
    mandato = r.mandatoActualizado;
    if (!r.veredicto.permitido) {
      acciones.push({ adRef: opt.adRef, actionType: opt.actionType, estado: 'RECHAZADA', bloqueos: r.veredicto.bloqueos, externalRef: null, razon: opt.razon });
      continue;
    }
    const escritura = await port.ejecutar({ operacion: opt.actionType, organizationId: e.mandato.organizationId, assetId: e.adAccountId, idempotencyKey: accion.idempotencyKey, payload: { adRef: opt.adRef } });
    if (port.esReal && escritura.ok) metaWriteCallsReales += 1;
    const estado = r.veredicto.modo === 'REAL' && escritura.ok ? 'EJECUTADA' : 'SIMULADA';
    acciones.push({ adRef: opt.adRef, actionType: opt.actionType, estado, bloqueos: [], externalRef: escritura.externalRef, razon: opt.razon });
  }

  const pausas = acciones.filter((a) => a.estado !== 'RECHAZADA').length;
  return {
    organizationId: e.mandato.organizationId,
    mandatoId: e.mandato.id,
    ranAt: ahora,
    modo,
    metricas,
    decisiones,
    recomendacionesFinancieras,
    acciones,
    gastoRealComprometidoMinor: 0, // shadow: nunca compromete gasto real
    metaWriteCallsReales,
    resumen: `Ciclo ${modo}: ${metricas.length} anuncios observados, ${pausas} pausa(s) propuesta(s), ${recomendacionesFinancieras.length} recomendación(es) financiera(s) para aprobación humana. Gasto real 0.`,
  };
}
