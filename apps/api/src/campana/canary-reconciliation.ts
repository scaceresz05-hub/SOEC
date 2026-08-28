/**
 * apps/api · campana · RECONCILIACIÓN POST-MUTATE EXITOSO (PURO + idempotente). Tras un GoogleAdsService.Mutate
 * atómico exitoso, correlaciona los resource names REALES devueltos por Google (por operation index) con el grafo
 * materializado y produce los `ProviderResourceBinding`. NO fabrica IDs (una operación sin resourceName real no
 * genera binding). NO llama a Google. El registro es idempotente (buscar antes de registrar) ⇒ correrlo dos veces
 * no duplica bindings. La ACTIVACIÓN del envelope / el gasto NO se inventan aquí: no existen como capacidad de
 * dominio persistida, y este bloque no crea una nueva.
 */
import { fingerprint, type EntityType } from './material-fingerprint';
import type { ResourceBindingService, ProviderResourceBinding } from './resource-binding';
import type { AuthorizedExecutionEnvelope } from './authorized-execution-envelope';

/** Una operación exitosa: su tipo (clave del MutateOperation) y el resource name REAL de Google (o null). */
export interface OperacionResuelta { readonly operationIndex: number; readonly resourceType: string; readonly resourceName: string | null }

const TIPO_A_ENTIDAD: Record<string, EntityType | null> = {
  campaignBudgetOperation: null, // el budget no es una entidad accionable (pause/stop); no se bindea
  campaignOperation: 'campaign',
  adGroupOperation: 'adGroup',
  adGroupAdOperation: 'ad',
  adGroupCriterionOperation: 'keyword',
  campaignCriterionOperation: 'negative',
};

/**
 * Construye los bindings desde las operaciones resueltas. Sólo genera binding cuando hay resourceName REAL y el
 * tipo mapea a una entidad accionable. `materialFingerprint` es determinista y ligado al recurso real (no inventado).
 */
export function bindingsDesdeOperaciones(org: string, envelope: AuthorizedExecutionEnvelope, ops: readonly OperacionResuelta[], ahora: string): ProviderResourceBinding[] {
  const out: ProviderResourceBinding[] = [];
  for (const op of ops) {
    const entityType = TIPO_A_ENTIDAD[op.resourceType];
    if (!entityType || !op.resourceName) continue; // sin entidad accionable o sin ID real ⇒ no se fabrica binding
    out.push({
      organizationId: org, envelopeId: envelope.id, planHash: envelope.planHash, channel: 'google', entityType,
      materialFingerprint: fingerprint(entityType, [op.resourceName]), providerResourceId: op.resourceName,
      createdAt: ahora, lastVerifiedAt: ahora,
    });
  }
  return out;
}

export interface ResultadoReconciliacion {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly bindingsRegistrados: number;
  readonly bindingsYaExistian: number;
  readonly providerBindingsTotal: number;
  readonly boundCampaignResourceName: string | null;
  readonly newGoogleWriteCalls: 0; // SIEMPRE 0: la reconciliación NO escribe en Google
}

/** Registra los bindings de forma IDEMPOTENTE (buscar antes de registrar). Nunca llama a Google. */
export async function reconciliarBindings(bindingSvc: ResourceBindingService, org: string, envelope: AuthorizedExecutionEnvelope, ops: readonly OperacionResuelta[], ahora: string): Promise<ResultadoReconciliacion> {
  const candidatos = bindingsDesdeOperaciones(org, envelope, ops, ahora);
  if (candidatos.length === 0) {
    // Sin resource names reales en la evidencia durable ⇒ no se puede reconstruir binding alguno (no se fabrica).
    const total = (await bindingSvc.listar(org)).filter((b) => b.envelopeId === envelope.id).length;
    return { ok: false, reason: 'EVIDENCE_INSUFFICIENT', bindingsRegistrados: 0, bindingsYaExistian: 0, providerBindingsTotal: total, boundCampaignResourceName: null, newGoogleWriteCalls: 0 };
  }
  let registrados = 0; let yaExistian = 0;
  for (const b of candidatos) {
    const existente = await bindingSvc.buscar(org, envelope.id, b.materialFingerprint);
    if (existente) { yaExistian += 1; continue; }
    await bindingSvc.registrar(b);
    registrados += 1;
  }
  const todos = (await bindingSvc.listar(org)).filter((b) => b.envelopeId === envelope.id);
  const campania = todos.find((b) => b.entityType === 'campaign');
  return { ok: true, reason: null, bindingsRegistrados: registrados, bindingsYaExistian: yaExistian, providerBindingsTotal: todos.length, boundCampaignResourceName: campania?.providerResourceId ?? null, newGoogleWriteCalls: 0 };
}
