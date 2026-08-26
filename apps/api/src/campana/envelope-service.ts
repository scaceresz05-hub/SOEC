/**
 * apps/api · campana · SERVICIO del AUTHORIZED EXECUTION ENVELOPE (event-sourced, tenant-scoped).
 *
 * Persiste el sobre (stream last-wins) y CADA transición como audit event (stream de auditoría). Las
 * transiciones son idempotentes: doble aprobación/activación/revocación por retry/doble clic NO duplica.
 * No ejecuta ninguna acción de proveedor.
 */
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import type { MarketingPlan } from './marketing-plan';
import {
  construirEnvelope, aprobar as aprobarPuro, revocar as revocarPuro,
  type AuthorizedExecutionEnvelope, type AuditEvent, type CanalId,
} from './authorized-execution-envelope';

export const EVENTO_ENVELOPE = 'execution-envelope.estado';
export const EVENTO_ENVELOPE_AUDIT = 'execution-envelope.audit';
export function envelopeStreamId(org: string): string { return `execution-envelope:${org}`; }
export function envelopeAuditStreamId(org: string): string { return `execution-envelope-audit:${org}`; }

const ATRIB: Attribution = { source: 'execution-envelope', purpose: 'autorización de ejecución (sin efecto externo)', assumptions: ['ninguna escritura de proveedor; flags de ejecución en false'], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };

export class EnvelopeService {
  constructor(private readonly store: EventStore) {}

  private ctx(org: string): RequestContext {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('execution-envelope'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `envelope-${org}` };
  }

  private async persistir(ctx: RequestContext, e: AuthorizedExecutionEnvelope, ev?: AuditEvent): Promise<void> {
    const sid = envelopeStreamId(String(ctx.organizationId));
    const prev = await this.store.readStream(ctx, sid);
    await this.store.append(ctx, sid, prev.length, [{ type: EVENTO_ENVELOPE, payload: e, attribution: ATRIB, occurredAt: e.updatedAt }]).catch(() => undefined);
    if (ev) await this.auditar(ctx, ev);
  }

  private async auditar(ctx: RequestContext, ev: AuditEvent): Promise<void> {
    const sid = envelopeAuditStreamId(String(ctx.organizationId));
    const prev = await this.store.readStream(ctx, sid);
    await this.store.append(ctx, sid, prev.length, [{ type: EVENTO_ENVELOPE_AUDIT, payload: ev, attribution: ATRIB, occurredAt: ev.at }]).catch(() => undefined);
  }

  async leerUltimo(org: string): Promise<AuthorizedExecutionEnvelope | null> {
    const ctx = this.ctx(org);
    const eventos = await this.store.readStream(ctx, envelopeStreamId(org));
    let u: AuthorizedExecutionEnvelope | null = null;
    for (const e of eventos) if (e.type === EVENTO_ENVELOPE) u = e.payload as AuthorizedExecutionEnvelope;
    return u;
  }

  async auditoria(org: string): Promise<AuditEvent[]> {
    const ctx = this.ctx(org);
    const eventos = await this.store.readStream(ctx, envelopeAuditStreamId(org));
    return eventos.filter((e) => e.type === EVENTO_ENVELOPE_AUDIT).map((e) => e.payload as AuditEvent);
  }

  /** Crea (o regenera) el sobre desde el plan vigente. Idempotente por planHash: si ya existe el mismo, no duplica. */
  async crearDesdePlan(org: string, plan: MarketingPlan, planId: string, ahora: string): Promise<AuthorizedExecutionEnvelope> {
    const ctx = this.ctx(org);
    const { envelope, audit } = construirEnvelope(plan, org, planId, ahora);
    const prev = await this.leerUltimo(org);
    // IDEMPOTENCIA: mismo planHash + misma org ⇒ NO se crea un envelope duplicado (refresh/retry devuelven el mismo).
    // Un planHash distinto es un cambio MATERIAL ⇒ nueva revisión (el aprobado previo queda invalidado por hash).
    if (prev && prev.planHash === envelope.planHash) return prev;
    await this.persistir(ctx, envelope, audit);
    return envelope;
  }

  async aprobar(org: string, actor: string, plan: MarketingPlan, ahora: string, executionEligibleChannels: readonly CanalId[]): Promise<{ envelope: AuthorizedExecutionEnvelope; changed: boolean }> {
    const ctx = this.ctx(org);
    const actual = await this.leerUltimo(org);
    if (!actual) throw new Error('no hay sobre para aprobar');
    const r = aprobarPuro(actual, plan, actor, ahora, executionEligibleChannels);
    if (r.changed) await this.persistir(ctx, r.envelope, r.audit);
    return { envelope: r.envelope, changed: r.changed };
  }

  async revocar(org: string, actor: string, ahora: string): Promise<{ envelope: AuthorizedExecutionEnvelope; changed: boolean }> {
    const ctx = this.ctx(org);
    const actual = await this.leerUltimo(org);
    if (!actual) throw new Error('no hay sobre para revocar');
    const r = revocarPuro(actual, actor, ahora);
    if (r.changed) await this.persistir(ctx, r.envelope, r.audit);
    return { envelope: r.envelope, changed: r.changed };
  }
}
