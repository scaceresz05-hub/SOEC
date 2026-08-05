/**
 * @soec/cia · app · SERVICIO DE KILL-SWITCH. Activa/desactiva el freno por alcance (organización o capacidad).
 * Un kill activo prevalece sobre autorizaciones y planes. Event-sourced, multi-tenant, reversible con traza.
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RequestContext } from '@soec/contracts';
import { EVENTOS_KILL, killStreamId, reconstruirKill, type AlcanceKill, type KillSwitchState } from '../dominio/kill-switch';

export class KillSwitchService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  cargar(ctx: RequestContext): Promise<KillSwitchState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, killStreamId(org)).then((e) => reconstruirKill(org, e));
  }

  private async append(ctx: RequestContext, type: string, alcance: AlcanceKill, a: Attribution, o: string): Promise<void> {
    const st = await this.cargar(ctx);
    const input: EventInput = { type, payload: { alcance }, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, killStreamId(this.org(ctx)), st.version, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  /** `alcance = 'ORG'` detiene todo en la organización; cualquier `capacidadId` detiene sólo esa capacidad. */
  async activar(ctx: RequestContext, alcance: AlcanceKill, a: Attribution, o: string): Promise<KillSwitchState> {
    await this.append(ctx, EVENTOS_KILL.activado, alcance, a, o);
    return this.cargar(ctx);
  }

  async desactivar(ctx: RequestContext, alcance: AlcanceKill, a: Attribution, o: string): Promise<KillSwitchState> {
    await this.append(ctx, EVENTOS_KILL.desactivado, alcance, a, o);
    return this.cargar(ctx);
  }
}
