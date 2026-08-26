/**
 * apps/api · campana · PROVIDER RESOURCE BINDING (event-sourced, tenant-scoped).
 *
 * Vincula un fingerprint MATERIAL (del plan aprobado) con un recurso del proveedor creado por ESTE envelope.
 * Sirve para que las acciones NO-creación (pause/stop/adjust) sólo puedan operar sobre recursos PROPIOS del
 * envelope. Una campaña histórica NO vinculada NO puede mutarse. En SHADOW `providerResourceId` es null.
 */
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import type { EntityType } from './material-fingerprint';

export interface ProviderResourceBinding {
  readonly organizationId: string;
  readonly envelopeId: string;
  readonly planHash: string;
  readonly channel: 'google' | 'meta';
  readonly entityType: EntityType;
  readonly materialFingerprint: string;
  readonly providerResourceId: string | null; // null en SHADOW (no se inventan IDs)
  readonly createdAt: string;
  readonly lastVerifiedAt: string | null;
}

export const EVENTO_BINDING = 'provider-resource-binding.registrado';
export function bindingStreamId(org: string): string { return `provider-resource-binding:${org}`; }

const ATRIB: Attribution = { source: 'provider-resource-binding', purpose: 'vinculación de recursos por envelope (sin efecto externo)', assumptions: ['SHADOW: sin providerResourceId real'], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };

export class ResourceBindingService {
  constructor(private readonly store: EventStore) {}
  private ctx(org: string): RequestContext {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('resource-binding'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `binding-${org}` };
  }
  async registrar(b: ProviderResourceBinding): Promise<void> {
    const ctx = this.ctx(b.organizationId);
    const sid = bindingStreamId(b.organizationId);
    const prev = await this.store.readStream(ctx, sid);
    await this.store.append(ctx, sid, prev.length, [{ type: EVENTO_BINDING, payload: b, attribution: ATRIB, occurredAt: b.createdAt }]).catch(() => undefined);
  }
  async listar(org: string): Promise<ProviderResourceBinding[]> {
    const ctx = this.ctx(org);
    return (await this.store.readStream(ctx, bindingStreamId(org))).filter((e) => e.type === EVENTO_BINDING).map((e) => e.payload as ProviderResourceBinding);
  }
  async buscar(org: string, envelopeId: string, fingerprint: string): Promise<ProviderResourceBinding | null> {
    return (await this.listar(org)).find((b) => b.envelopeId === envelopeId && b.materialFingerprint === fingerprint) ?? null;
  }
}

/**
 * ¿La acción puede operar sobre el recurso? Las creaciones (CREATE_*) no requieren binding previo. Las acciones
 * NO-creación exigen un binding del MISMO tenant + MISMO envelope. Sin binding ⇒ NO propiedad (fail-closed).
 */
export function esAccionDeCreacion(actionType: string): boolean {
  return actionType.startsWith('CREATE_') || actionType === 'ADD_KEYWORD' || actionType === 'ADD_NEGATIVE_KEYWORD';
}

export function validarPropiedad(actionType: string, binding: ProviderResourceBinding | null, org: string, envelopeId: string): { ok: boolean } {
  if (esAccionDeCreacion(actionType)) return { ok: true }; // crear no requiere binding previo
  if (!binding) return { ok: false };
  if (binding.organizationId !== org || binding.envelopeId !== envelopeId) return { ok: false };
  return { ok: true };
}
