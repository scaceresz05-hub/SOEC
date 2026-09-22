/**
 * apps/api · OPTIMIZACIÓN AUTÓNOMA · aplicación de acciones (escritura gobernada).
 *
 * Aquí es donde una decisión se convierte en un cambio real. Cuatro obsesiones, las mismas de la Fase F:
 *
 *  1. **IDENTIDAD ESTABLE.** `organización:campaña:acción:objetivo:estadoPretendido`. Reintentar la misma
 *     intención no la aplica dos veces: devuelve `NOOP_ALREADY_APPLIED`.
 *  2. **EL OBJETIVO SIGUE SIENDO EL DE LA DECISIÓN.** Antes de escribir se relee el estado remoto: si la
 *     palabra ya estaba pausada, si alguien cambió el presupuesto por fuera, la decisión vieja no se aplica.
 *  3. **VERIFICAR DESPUÉS DE ESCRIBIR.** Un HTTP 200 no es una campaña cambiada. Se relee y se compara.
 *  4. **UN SOLO TRANSPORTE.** El mismo cliente y el mismo `mutarGrafo` atómico de la Fase F. No hay un segundo
 *     camino de escritura en el producto.
 */
import type { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import type { GoogleAdsMutateRequest } from '../campana/google-ads-materializer';
import { aMicros, deMicros } from '../dinero';
import type { DecisionOptimizacion } from './optimizacion-pg';
import { normalizar, type ResultadoAccion, type VerificacionRemota } from './optimizacion-tipos';

type Cliente = Pick<GoogleAdsMutateHttpClient, 'buscar' | 'mutarGrafo'>;

export interface ResultadoAplicacion {
  readonly resultado: ResultadoAccion;
  readonly verificacion: VerificacionRemota;
  readonly recursoExterno: string | null;
  readonly providerRequestId: string | null;
  readonly detalle: Record<string, unknown>;
  /** Escrituras REALES al proveedor. Un NOOP idempotente debe dejar esto en 0. */
  readonly escrituras: number;
}

/**
 * Clave de idempotencia. Incluye el estado PRETENDIDO: subir el presupuesto a 12.000 y subirlo a 15.000 son
 * intenciones distintas, pero repetir «a 12.000» es la misma y no debe aplicarse dos veces.
 */
export function claveIdempotencia(d: DecisionOptimizacion, campaignId: string | null): string {
  const objetivo = d.objetivo.id ?? normalizar(d.objetivo.nombre);
  return `${d.organizationId}:${campaignId ?? 'sin-campania'}:${d.accion}:${objetivo}:${normalizar(d.estadoPropuesto)}`;
}

export interface EntradaAplicacion {
  readonly decision: DecisionOptimizacion;
  readonly cliente: Cliente;
  readonly customerId: string;
  readonly campaignId: string;
  /** Moneda ISO del negocio. Sin ella no se puede convertir a micros sin suponer cuántos decimales tiene. */
  readonly moneda: string;
  /** Recurso ya aplicado con esta misma clave, si lo hubiera (idempotencia consultada por el servicio). */
  readonly yaAplicado: boolean;
  readonly log?: (info: Record<string, unknown>) => void;
}

/** Aplica la decisión. Nunca lanza por un error del proveedor: lo devuelve descrito para que quede en el libro. */
export async function aplicarDecision(e: EntradaAplicacion): Promise<ResultadoAplicacion> {
  if (e.yaAplicado) {
    return { resultado: 'NOOP_ALREADY_APPLIED', verificacion: 'VERIFIED', recursoExterno: null, providerRequestId: null, detalle: { motivo: 'esta misma intención ya se aplicó antes' }, escrituras: 0 };
  }

  const request = await construirRequest(e);
  if (request === null) {
    return { resultado: 'NOOP_ALREADY_APPLIED', verificacion: 'VERIFIED', recursoExterno: null, providerRequestId: null, detalle: { motivo: 'la plataforma ya está en el estado propuesto' }, escrituras: 0 };
  }
  if (request === 'NO_SOPORTADA') {
    return { resultado: 'BLOCKED', verificacion: 'UNKNOWN', recursoExterno: null, providerRequestId: null, detalle: { motivo: `esta fase no ejecuta «${e.decision.accion}»` }, escrituras: 0 };
  }
  if (request === 'OBJETIVO_CAMBIADO') {
    return { resultado: 'BLOCKED', verificacion: 'UNKNOWN', recursoExterno: null, providerRequestId: null, detalle: { motivo: 'lo que la decisión quería cambiar ya no está como estaba: se descarta por seguridad' }, escrituras: 0 };
  }

  const r = await e.cliente.mutarGrafo(e.customerId, request);
  if (!r.ok) {
    e.log?.({ optimizacion: 'accion_fallida', accion: e.decision.accion, errorCode: r.errorCode, requestId: r.requestId });
    return {
      resultado: 'FAILED', verificacion: 'UNKNOWN', recursoExterno: null, providerRequestId: r.requestId,
      detalle: { httpStatus: r.httpStatus, errorStatus: r.errorStatus, errorCode: r.errorCode, errorMessage: r.errorMessage },
      escrituras: 1,
    };
  }

  const verificacion = await verificar(e);
  e.log?.({ optimizacion: 'accion_aplicada', accion: e.decision.accion, verificacion, requestId: r.requestId });
  return {
    resultado: 'APPLIED', verificacion,
    recursoExterno: r.results[0]?.resourceName ?? null, providerRequestId: r.requestId,
    detalle: { operaciones: request.mutateOperations.length },
    escrituras: 1,
  };
}

/**
 * Construye la operación. Devuelve `null` si la plataforma YA está como se propone (nada que hacer),
 * `'OBJETIVO_CAMBIADO'` si el estado de partida ya no es el que la decisión vio, y `'NO_SOPORTADA'` si esta
 * fase no ejecuta esa acción.
 */
async function construirRequest(e: EntradaAplicacion): Promise<GoogleAdsMutateRequest | null | 'NO_SOPORTADA' | 'OBJETIVO_CAMBIADO'> {
  const d = e.decision;
  const cid = e.customerId;

  switch (d.accion) {
    case 'PAUSE_CAMPAIGN':
    case 'ENABLE_CAMPAIGN': {
      const estado = await estadoCampania(e);
      const destino = d.accion === 'PAUSE_CAMPAIGN' ? 'PAUSED' : 'ENABLED';
      if (estado === destino) return null;
      return op({ campaignOperation: { update: { resourceName: `customers/${cid}/campaigns/${e.campaignId}`, status: destino }, updateMask: 'status' } });
    }

    case 'PAUSE_AD_GROUP': {
      if (d.objetivo.id === null) return 'NO_SOPORTADA';
      return op({ adGroupOperation: { update: { resourceName: `customers/${cid}/adGroups/${d.objetivo.id}`, status: 'PAUSED' }, updateMask: 'status' } });
    }

    case 'PAUSE_KEYWORD': {
      const criterio = await localizarPalabra(e, d.objetivo.nombre);
      if (criterio === null) return 'OBJETIVO_CAMBIADO';
      if (criterio.estado === 'PAUSED') return null;
      return op({ adGroupCriterionOperation: { update: { resourceName: `customers/${cid}/adGroupCriteria/${criterio.adGroupId}~${criterio.criterionId}`, status: 'PAUSED' }, updateMask: 'status' } });
    }

    case 'ADD_NEGATIVE_KEYWORD': {
      const existe = await negativaExiste(e, d.objetivo.nombre);
      if (existe) return null;
      return op({ campaignCriterionOperation: { create: {
        campaign: `customers/${cid}/campaigns/${e.campaignId}`,
        negative: true,
        keyword: { text: d.objetivo.nombre, matchType: 'PHRASE' },
      } } });
    }

    case 'ADJUST_DAILY_BUDGET': {
      const presupuesto = await presupuestoDeLaCampania(e);
      if (presupuesto === null) return 'OBJETIVO_CAMBIADO';
      const nuevoClp = numeroDe(d.estadoPropuesto);
      const actualClp = numeroDe(d.estadoActual);
      if (nuevoClp === null) return 'NO_SOPORTADA';
      // Si el presupuesto real ya no es el que la decisión vio, alguien lo cambió por fuera: no se pisa.
      if (actualClp !== null && Math.abs(presupuesto.montoClp - actualClp) > Math.max(1, actualClp * 0.02)) return 'OBJETIVO_CAMBIADO';
      if (Math.round(presupuesto.montoClp) === Math.round(nuevoClp)) return null;
      const micros = aMicros(Math.round(nuevoClp), e.moneda);
      if (micros === null) return 'NO_SOPORTADA';
      return op({ campaignBudgetOperation: { update: { resourceName: presupuesto.resourceName, amountMicros: String(micros) }, updateMask: 'amount_micros' } });
    }

    case 'ADJUST_MAX_CPC': {
      const nuevoClp = numeroDe(d.estadoPropuesto);
      if (nuevoClp === null) return 'NO_SOPORTADA';
      return op({ campaignOperation: { update: {
        resourceName: `customers/${cid}/campaigns/${e.campaignId}`,
        targetSpend: { cpcBidCeilingMicros: String(aMicros(Math.round(nuevoClp), e.moneda) ?? 0) },
      }, updateMask: 'target_spend.cpc_bid_ceiling_micros' } });
    }

    default:
      return 'NO_SOPORTADA';
  }
}

const op = (operacion: Record<string, unknown>): GoogleAdsMutateRequest => ({ mutateOperations: [operacion], partialFailure: false });

/** Extrae el número de una frase como «12.000 CLP/día». Sin número ⇒ null (y la acción no se aplica). */
export function numeroDe(texto: string): number | null {
  const limpio = texto.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const v = Number.parseFloat(limpio);
  return Number.isFinite(v) ? v : null;
}

async function estadoCampania(e: EntradaAplicacion): Promise<string | null> {
  try {
    const filas = await e.cliente.buscar(e.customerId, `SELECT campaign.status FROM campaign WHERE campaign.id = ${e.campaignId} LIMIT 1`);
    const v = (filas[0] as { campaign?: { status?: unknown } } | undefined)?.campaign?.status;
    return v === undefined ? null : String(v);
  } catch {
    return null;
  }
}

async function presupuestoDeLaCampania(e: EntradaAplicacion): Promise<{ resourceName: string; montoClp: number } | null> {
  try {
    const filas = await e.cliente.buscar(e.customerId, `SELECT campaign_budget.resource_name, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${e.campaignId} LIMIT 1`);
    const b = (filas[0] as { campaignBudget?: { resourceName?: string; amountMicros?: unknown } } | undefined)?.campaignBudget;
    if (b?.resourceName === undefined) return null;
    return { resourceName: b.resourceName, montoClp: deMicros(Number(b.amountMicros ?? 0), e.moneda) ?? 0 };
  } catch {
    return null;
  }
}

async function localizarPalabra(e: EntradaAplicacion, texto: string): Promise<{ adGroupId: string; criterionId: string; estado: string } | null> {
  try {
    const filas = await e.cliente.buscar(
      e.customerId,
      `SELECT ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.status, ad_group_criterion.keyword.text
       FROM keyword_view WHERE campaign.id = ${e.campaignId} AND ad_group_criterion.keyword.text = '${texto.replace(/'/g, "\\'")}' LIMIT 1`,
    );
    const f = filas[0] as { adGroup?: { id?: unknown }; adGroupCriterion?: { criterionId?: unknown; status?: unknown } } | undefined;
    if (f?.adGroupCriterion?.criterionId === undefined) return null;
    return { adGroupId: String(f.adGroup?.id ?? ''), criterionId: String(f.adGroupCriterion.criterionId), estado: String(f.adGroupCriterion.status ?? '') };
  } catch {
    return null;
  }
}

async function negativaExiste(e: EntradaAplicacion, texto: string): Promise<boolean> {
  try {
    const filas = await e.cliente.buscar(
      e.customerId,
      `SELECT campaign_criterion.keyword.text FROM campaign_criterion
       WHERE campaign.id = ${e.campaignId} AND campaign_criterion.type = 'KEYWORD'
       AND campaign_criterion.negative = true AND campaign_criterion.status != 'REMOVED'`,
    );
    const objetivo = normalizar(texto);
    return filas.some((f) => normalizar(String((f as { campaignCriterion?: { keyword?: { text?: string } } }).campaignCriterion?.keyword?.text ?? '')) === objetivo);
  } catch {
    return false;
  }
}

/** Relee la plataforma y compara con lo que la decisión pretendía. `UNKNOWN` si no se pudo comprobar. */
async function verificar(e: EntradaAplicacion): Promise<VerificacionRemota> {
  const d = e.decision;
  try {
    switch (d.accion) {
      case 'PAUSE_CAMPAIGN': return (await estadoCampania(e)) === 'PAUSED' ? 'VERIFIED' : 'DIVERGED';
      case 'ENABLE_CAMPAIGN': return (await estadoCampania(e)) === 'ENABLED' ? 'VERIFIED' : 'DIVERGED';
      case 'PAUSE_KEYWORD': {
        const k = await localizarPalabra(e, d.objetivo.nombre);
        return k === null ? 'UNKNOWN' : k.estado === 'PAUSED' ? 'VERIFIED' : 'DIVERGED';
      }
      case 'ADD_NEGATIVE_KEYWORD': return (await negativaExiste(e, d.objetivo.nombre)) ? 'VERIFIED' : 'DIVERGED';
      case 'ADJUST_DAILY_BUDGET': {
        const b = await presupuestoDeLaCampania(e);
        const esperado = numeroDe(d.estadoPropuesto);
        if (b === null || esperado === null) return 'UNKNOWN';
        return Math.round(b.montoClp) === Math.round(esperado) ? 'VERIFIED' : 'DIVERGED';
      }
      default: return 'UNKNOWN';
    }
  } catch {
    return 'UNKNOWN';
  }
}
