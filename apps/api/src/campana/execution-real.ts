/**
 * apps/api · campana · EJECUTOR REAL SUPERVISADO (Fase 2B). Convierte un envelope APROBADO en escrituras reales de
 * Google Ads — pero SÓLO si TODAS las barreras pasan (incluye `SUPERVISED_REAL=true` y el gate externo READY). En
 * producción esta fase queda DORMIDA: ningún flujo lo invoca, `SUPERVISED_REAL=false` y el gate externo bloquean ⇒
 * 0 provider mutate, 0 bindings, 0 gasto. La carretera está construida; la barrera sigue cerrada.
 *
 * GARANTÍAS:
 *  - Reutiliza el MISMO `providerPayload` certificado en SHADOW (un solo traductor; el puerto real sólo envía).
 *  - Orden por dependencias: campaign (budget→campaign) → ad groups → ads/keywords (tras binding real del padre) →
 *    negativas. NO paraleliza acciones que dependan de un resourceId inexistente.
 *  - RESERVA financiera ANTES de la primera escritura que pueda gastar; jamás excede experimentCap ni totalCap.
 *  - Idempotencia: si ya hay binding exitoso para el fingerprint ⇒ SKIP (no crea dos veces).
 *  - Bindings sólo tras respuesta exitosa de Google, scoped a org+envelope+planHash+channel; jamás recurso histórico.
 *  - Fail-closed: cualquier error (gate/ownership/material/reserva/proveedor/padre) detiene esa acción y sus
 *    dependientes; no continúa en silencio.
 */
import type { MarketingPlan } from './marketing-plan';
import type { AuthorizedExecutionEnvelope, ProviderState, FlagsEjecucion } from './authorized-execution-envelope';
import type { FinancialLedger } from './financial-ledger';
import type { ExecutionActionIntent } from './execution-intent';
import type { AccionAutorizable } from './acciones';
import { evaluarBarreras, validateActionFinancialImpact, type ExecReason } from './execution-engine';
import type { GoogleAdsMutatePort, GoogleMutationPayload } from './google-translator';
import type { ProviderResourceBinding } from './resource-binding';
import { fingerprintsDelPlan, type EntityType } from './material-fingerprint';

export type RealExecStatus = 'EXECUTED' | 'SKIPPED_IDEMPOTENT' | 'BLOCKED';
export type RealExecReason = ExecReason | 'FINANCIAL_RESERVATION_FAILED' | 'PROVIDER_MUTATE_FAILED' | null;

export interface RealAuditEvent {
  readonly type: string;
  readonly actionType?: AccionAutorizable;
  readonly fingerprint?: string;
  readonly reason?: string;
  readonly providerResourceId?: string;
  readonly commitment?: number;
  readonly at: string;
}
export interface RealIntentResult {
  readonly id: string;
  readonly actionType: AccionAutorizable;
  readonly fingerprint: string;
  readonly status: RealExecStatus;
  readonly reason: RealExecReason;
  readonly providerResourceId: string | null;
}
export interface ResultadoEjecucionReal {
  readonly intents: readonly RealIntentResult[];
  readonly providerMutateCalls: number;
  readonly bindingsCreated: readonly ProviderResourceBinding[];
  readonly reservation: { readonly created: boolean; readonly commitment: number };
  readonly audit: readonly RealAuditEvent[];
}

export interface OpcionesEjecucionReal {
  readonly plan: MarketingPlan;
  readonly env: AuthorizedExecutionEnvelope;
  readonly intents: readonly ExecutionActionIntent[];
  readonly ledger: FinancialLedger;
  readonly prov: ProviderState;
  readonly flags: FlagsEjecucion;
  readonly port: GoogleAdsMutatePort;
  readonly bindingsExistentes?: readonly ProviderResourceBinding[];
  readonly ahora: string;
}

/** Prioridad de ejecución por tipo de entidad (respeta las dependencias jerárquicas). */
const PRIORIDAD: Record<EntityType, number> = { campaign: 0, adGroup: 1, ad: 2, keyword: 3, negative: 4, destination: 5 };

/** Ordena los intents por dependencia (estable). Nunca coloca un hijo antes que su padre. */
export function ordenarPorDependencia(intents: readonly ExecutionActionIntent[]): ExecutionActionIntent[] {
  return intents.map((it, i) => ({ it, i })).sort((a, b) => (PRIORIDAD[a.it.entityType] - PRIORIDAD[b.it.entityType]) || (a.i - b.i)).map((x) => x.it);
}

/**
 * Ejecuta el envelope de forma REAL SUPERVISADA. Async. NO persiste por sí mismo: devuelve los bindings creados y la
 * auditoría para que el llamador (fuera de esta fase) los persista. En esta fase ningún llamador productivo existe.
 */
export async function ejecutarEnvelopeReal(opts: OpcionesEjecucionReal): Promise<ResultadoEjecucionReal> {
  const { plan, env, ledger, prov, flags, port, ahora } = opts;
  const existentes = new Map<string, ProviderResourceBinding>();
  for (const b of opts.bindingsExistentes ?? []) if (b.envelopeId === env.id && b.organizationId === env.organizationId) existentes.set(b.materialFingerprint, b);

  const resueltos = new Map<string, string>(); // fingerprint → providerResourceId (de esta corrida o previos)
  for (const [fp, b] of existentes) if (b.providerResourceId) resueltos.set(fp, b.providerResourceId);

  const audit: RealAuditEvent[] = [];
  const bindingsCreated: ProviderResourceBinding[] = [];
  const resultados: RealIntentResult[] = [];
  let providerMutateCalls = 0;
  let reservado = false;
  let reservaCommitment = 0;

  const orden = ordenarPorDependencia(opts.intents);
  const campaignFp = fingerprintsDelPlan(plan).campaign; // todos los recursos hijos dependen de la campaña

  for (const intent of orden) {
    const fp = intent.materialEntityFingerprint;
    const bindingActual = existentes.get(fp) ?? null;

    // 1) GATE ÚNICO (mismas barreras que SHADOW, con flags reales): envelope/hash/canal/acción/material/ownership/
    //    financiero/gate externo/tracking/landing/SUPERVISED_REAL. Fail-closed ⇒ 0 provider calls.
    const gate = evaluarBarreras(intent, plan, env, ledger, prov, flags, bindingActual);
    if (gate.decision === 'DENY') {
      resultados.push({ id: intent.id, actionType: intent.actionType, fingerprint: fp, status: 'BLOCKED', reason: gate.reasonCode, providerResourceId: null });
      continue;
    }

    // 2) IDEMPOTENCIA: binding exitoso previo ⇒ no crear otra vez.
    const previo = existentes.get(fp);
    if (previo?.providerResourceId) {
      resueltos.set(fp, previo.providerResourceId);
      audit.push({ type: 'IDEMPOTENT_ACTION_SKIPPED', actionType: intent.actionType, fingerprint: fp, at: ahora });
      resultados.push({ id: intent.id, actionType: intent.actionType, fingerprint: fp, status: 'SKIPPED_IDEMPOTENT', reason: null, providerResourceId: previo.providerResourceId });
      continue;
    }

    // 3) RESERVA financiera ANTES de la primera escritura que pueda gastar (CREATE_CAMPAIGN, scope EXPERIMENT).
    if (intent.financialImpact.scope === 'EXPERIMENT' && !reservado) {
      const fin = validateActionFinancialImpact(intent, ledger, env);
      if (!fin.ok) {
        resultados.push({ id: intent.id, actionType: intent.actionType, fingerprint: fp, status: 'BLOCKED', reason: 'FINANCIAL_RESERVATION_FAILED', providerResourceId: null });
        continue;
      }
      reservado = true;
      reservaCommitment = intent.financialImpact.commitment;
      audit.push({ type: 'FINANCIAL_RESERVATION_CREATED', fingerprint: fp, commitment: reservaCommitment, at: ahora });
    }

    // 4a) FAIL-CLOSED de dependencia raíz: todo recurso hijo (ad group/negativa/ad/keyword) exige la CAMPAÑA ya
    //     creada por esta corrida. Si la campaña no se materializó, no se continúa en silencio con dependientes.
    let payload = intent.providerPayload as GoogleMutationPayload;
    if (intent.entityType !== 'campaign') {
      const campaignRid = resueltos.get(campaignFp);
      if (!campaignRid) {
        resultados.push({ id: intent.id, actionType: intent.actionType, fingerprint: fp, status: 'BLOCKED', reason: 'PARENT_PROVIDER_RESOURCE_NOT_BOUND', providerResourceId: null });
        continue;
      }
      // Los hijos DIRECTOS de la campaña (ad group, negativa) llevan la referencia real a la campaña.
      if (intent.entityType === 'adGroup' || intent.entityType === 'negative') payload = { ...payload, fields: { ...payload.fields, campaign: campaignRid } };
    }
    // 4b) Resolver el AD GROUP padre REAL (para ads/keywords). Sin binding real del padre ⇒ fail-closed.
    if (intent.parent) {
      const parentRid = resueltos.get(intent.parent.materialFingerprint);
      if (!parentRid) {
        resultados.push({ id: intent.id, actionType: intent.actionType, fingerprint: fp, status: 'BLOCKED', reason: 'PARENT_PROVIDER_RESOURCE_NOT_BOUND', providerResourceId: null });
        continue;
      }
      payload = { ...payload, parentAdGroup: { materialFingerprint: intent.parent.materialFingerprint, ...(intent.parent.logicalName ? { logicalName: intent.parent.logicalName } : {}), providerResourceId: parentRid } };
    }

    // 5) MUTATE real (a través del puerto). Fail-closed ante error del proveedor.
    audit.push({ type: 'ACTION_EXECUTION_STARTED', actionType: intent.actionType, fingerprint: fp, at: ahora });
    audit.push({ type: 'PROVIDER_MUTATE_REQUESTED', actionType: intent.actionType, fingerprint: fp, at: ahora });
    let resourceName: string;
    try {
      providerMutateCalls += 1;
      const res = await port.mutate(payload);
      resourceName = res.resourceName;
    } catch (e) {
      audit.push({ type: 'PROVIDER_MUTATE_FAILED', actionType: intent.actionType, fingerprint: fp, reason: e instanceof Error ? e.message : String(e), at: ahora });
      resultados.push({ id: intent.id, actionType: intent.actionType, fingerprint: fp, status: 'BLOCKED', reason: 'PROVIDER_MUTATE_FAILED', providerResourceId: null });
      continue; // fail-closed: los dependientes de este recurso no se ejecutarán (parent no resuelto)
    }
    audit.push({ type: 'PROVIDER_MUTATE_SUCCEEDED', actionType: intent.actionType, fingerprint: fp, providerResourceId: resourceName, at: ahora });

    // 6) BINDING real SÓLO tras éxito, scoped a este envelope/tenant/plan/canal.
    const binding: ProviderResourceBinding = {
      organizationId: env.organizationId, envelopeId: env.id, planHash: env.planHash, channel: 'google',
      entityType: intent.entityType, materialFingerprint: fp, providerResourceId: resourceName, createdAt: ahora, lastVerifiedAt: ahora,
    };
    bindingsCreated.push(binding);
    existentes.set(fp, binding);
    resueltos.set(fp, resourceName);
    audit.push({ type: 'PROVIDER_BINDING_CREATED', actionType: intent.actionType, fingerprint: fp, providerResourceId: resourceName, at: ahora });
    audit.push({ type: 'ACTION_EXECUTED', actionType: intent.actionType, fingerprint: fp, providerResourceId: resourceName, at: ahora });
    resultados.push({ id: intent.id, actionType: intent.actionType, fingerprint: fp, status: 'EXECUTED', reason: null, providerResourceId: resourceName });
  }

  return { intents: resultados, providerMutateCalls, bindingsCreated, reservation: { created: reservado, commitment: reservaCommitment }, audit };
}
