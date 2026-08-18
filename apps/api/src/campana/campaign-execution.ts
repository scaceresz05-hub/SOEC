/**
 * apps/api · V2-B · CAMPAIGN EXECUTION ENGINE (dry-run). Traduce un CampaignPlan a una secuencia ORDENADA de
 * acciones y las hace pasar UNA POR UNA por el Action Plane certificado (policy → budget guard → ledger).
 * SOLO tras un veredicto permitido invoca el Meta Write Port. Es el ÚNICO llamador del port: ninguna capa de
 * inteligencia toca Meta directamente. Idempotente por (planId, paso). En dry-run: META_WRITE_CALLS reales = 0.
 *
 * Presupuesto: el compromiso de gasto vive en un ÚNICO paso (CREATE_CAMPAIGN = presupuesto de la campaña).
 * Los pasos estructurales (conjunto/anuncios/creatividades) cuestan 0 para no duplicar el techo.
 */
import type { DepsActionPlane, ResultadoAccion } from '../accion/action-plane';
import { procesarAccion } from '../accion/action-plane';
import type { AccionPropuesta } from '../accion/budget-guard';
import type { Mandato } from '../accion/mandato';
import type { CampaignPlan } from './campaign-plan';
import { metaObjetivo } from './campaign-plan';
import type { MetaWritePort, OperacionMeta, ResultadoEscrituraMeta, SolicitudEscrituraMeta } from './meta-write-port';

export type EstadoPaso = 'EJECUTADA' | 'SIMULADA' | 'RECHAZADA' | 'BLOQUEADA';

export interface PasoEjecucion {
  readonly orden: number;
  readonly descripcion: string;
  readonly actionType: string;
  readonly operacionMeta: OperacionMeta;
  readonly costMinor: number;
  readonly estado: EstadoPaso;
  readonly bloqueos: readonly string[];
  readonly externalRef: string | null;
  readonly idempotencyKey: string;
}

export interface ResultadoEjecucionCampana {
  readonly organizationId: string;
  readonly mandatoId: string;
  readonly planId: string;
  readonly modo: 'DRY_RUN' | 'REAL';
  readonly pasos: readonly PasoEjecucion[];
  readonly gastoComprometidoMinor: number; // gasto REALMENTE comprometido en el mandato (0 en dry-run)
  readonly gastoProyectadoMinor: number; // SHADOW: lo que se comprometería si fuese REAL (invariante ≤ restante)
  readonly metaWriteCallsReales: number; // 0 en dry-run — invariante verificable
  readonly ok: boolean; // el plan se materializó sin bloqueos inesperados
  readonly resumen: string;
}

interface PlantillaPaso {
  readonly descripcion: string;
  readonly actionType: string;
  readonly operacionMeta: OperacionMeta;
  readonly costMinor: number;
  readonly sufijoIdem: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly estructuralDependiente: boolean; // si un prerequisito falla, se bloquea sin ejecutar
}

/** Deriva la secuencia ordenada de pasos desde el plan. Determinista. */
export function pasosDesdePlan(plan: CampaignPlan): PlantillaPaso[] {
  const pasos: PlantillaPaso[] = [];
  // 1) Creatividades (orgánico/estructural, costo 0) — una por anuncio.
  for (const a of plan.anuncios) {
    pasos.push({
      descripcion: `Preparar creatividad variante ${a.variante}`,
      actionType: 'UPDATE_CREATIVE_DRAFT',
      operacionMeta: 'UPLOAD_CREATIVE',
      costMinor: 0,
      sufijoIdem: `creative-${a.variante}`,
      payload: { variante: a.variante, headline: a.contenido.headline, cta: a.contenido.cta },
      estructuralDependiente: false,
    });
  }
  // 2) Campaña — ÚNICO paso que compromete presupuesto.
  pasos.push({
    descripcion: `Crear campaña (${plan.objetivo})`,
    actionType: 'CREATE_CAMPAIGN',
    operacionMeta: 'CREATE_CAMPAIGN',
    costMinor: plan.presupuestoTotalMinor,
    sufijoIdem: 'campaign',
    payload: { objective: metaObjetivo(plan.objetivo), dailyBudgetMinor: plan.presupuestoTotalMinor, currency: plan.moneda },
    estructuralDependiente: false,
  });
  // 3) Conjunto de anuncios (estructural, costo 0) — depende de la campaña.
  pasos.push({
    descripcion: 'Crear conjunto de anuncios',
    actionType: 'CREATE_ADSET',
    operacionMeta: 'CREATE_ADSET',
    costMinor: 0,
    sufijoIdem: 'adset',
    payload: { segmentacion: plan.segmentacion },
    estructuralDependiente: true,
  });
  // 4) Anuncios (estructural, costo 0) — dependen de la campaña/conjunto.
  for (const a of plan.anuncios) {
    pasos.push({
      descripcion: `Crear anuncio variante ${a.variante}`,
      actionType: 'CREATE_AD',
      operacionMeta: 'CREATE_AD',
      costMinor: 0,
      sufijoIdem: `ad-${a.variante}`,
      payload: { variante: a.variante },
      estructuralDependiente: true,
    });
  }
  return pasos;
}

/**
 * Ejecuta el plan en dry-run a través del Action Plane. `planId` debe ser estable para que reejecutar el
 * mismo plan sea idempotente (el ledger es la barrera). El port SIEMPRE es el adapter provisto (dry-run en
 * V2-B); solo se invoca tras un veredicto permitido.
 */
export async function ejecutarCampana(
  deps: DepsActionPlane,
  port: MetaWritePort,
  mandatoInicial: Mandato,
  plan: CampaignPlan,
  planId: string,
): Promise<ResultadoEjecucionCampana> {
  let mandato = mandatoInicial;
  let gastoComprometidoMinor = 0;
  let gastoProyectadoMinor = 0;
  let metaWriteCallsReales = 0;
  let campanaOk = true; // ¿la campaña (paso que compromete presupuesto) quedó permitida?
  const pasos: PasoEjecucion[] = [];
  const plantillas = pasosDesdePlan(plan);

  for (let i = 0; i < plantillas.length; i++) {
    const t = plantillas[i]!;
    const idempotencyKey = `${planId}:${t.sufijoIdem}`;
    const orden = i + 1;

    // Si un prerequisito estructural falló (campaña bloqueada), no ejecutamos pasos dependientes.
    if (t.estructuralDependiente && !campanaOk) {
      pasos.push({ orden, descripcion: t.descripcion, actionType: t.actionType, operacionMeta: t.operacionMeta, costMinor: t.costMinor, estado: 'BLOQUEADA', bloqueos: ['DEPENDE_DE_PASO_BLOQUEADO'], externalRef: null, idempotencyKey });
      continue;
    }

    const accion: AccionPropuesta = {
      organizationId: plan.organizationId,
      mandatoId: mandato.id,
      idempotencyKey,
      actionType: t.actionType,
      assetId: plan.adAccountId,
      costMinor: t.costMinor,
      currency: plan.moneda,
      propuestaPor: 'director',
    };

    const r: ResultadoAccion = await procesarAccion(deps, mandato, accion);
    mandato = r.mandatoActualizado;
    gastoComprometidoMinor += r.gastoComprometidoMinor;

    if (!r.veredicto.permitido) {
      if (t.actionType === 'CREATE_CAMPAIGN') campanaOk = false;
      pasos.push({ orden, descripcion: t.descripcion, actionType: t.actionType, operacionMeta: t.operacionMeta, costMinor: t.costMinor, estado: 'RECHAZADA', bloqueos: r.veredicto.bloqueos, externalRef: null, idempotencyKey });
      continue;
    }

    // Permitido: proyectar (shadow) el gasto que se comprometería si fuese REAL. Solo el paso pagado con costo.
    gastoProyectadoMinor += t.costMinor;

    // Recién ahora se invoca el Meta Write Port. guardApproved=true prueba que el Action Plane ya aprobó.
    const solicitud: SolicitudEscrituraMeta = { operacion: t.operacionMeta, organizationId: plan.organizationId, assetId: plan.adAccountId, idempotencyKey, payload: t.payload, mandateId: mandato.id, guardApproved: true };
    const escritura: ResultadoEscrituraMeta = await port.ejecutar(solicitud);
    if (port.esReal && escritura.ok) metaWriteCallsReales += 1;

    const estado: EstadoPaso = r.veredicto.modo === 'REAL' && escritura.ok ? 'EJECUTADA' : 'SIMULADA';
    pasos.push({ orden, descripcion: t.descripcion, actionType: t.actionType, operacionMeta: t.operacionMeta, costMinor: t.costMinor, estado, bloqueos: [], externalRef: escritura.externalRef, idempotencyKey });
  }

  const rechazados = pasos.filter((p) => p.estado === 'RECHAZADA' || p.estado === 'BLOQUEADA').length;
  const ok = campanaOk && rechazados === 0;
  const modo = mandatoInicial && deps.autonomousReal ? 'REAL' : 'DRY_RUN';
  return {
    organizationId: plan.organizationId,
    mandatoId: mandato.id,
    planId,
    modo,
    pasos,
    gastoComprometidoMinor,
    gastoProyectadoMinor,
    metaWriteCallsReales,
    ok,
    resumen: ok
      ? `Campaña preparada en dry-run: ${pasos.length} pasos, gasto que se comprometería ${gastoProyectadoMinor} ${plan.moneda} (shadow; comprometido real ${gastoComprometidoMinor}).`
      : `Campaña bloqueada por el Budget Guard/estructura: ${rechazados} paso(s) no ejecutable(s). Sin gasto real.`,
  };
}
