/**
 * @soec/motor-optimizacion · aplicación · MEMORIA DE DECISIONES (event-sourced, append-only).
 *
 * Historial consultable de optimizaciones: qué se propuso, qué se decidió/rechazó, por qué, qué artefactos
 * se derivaron, quién aprobó, y qué cambios se aplicaron (para la guarda de oscilación). Conserva el
 * histórico; la vigencia se deriva del estado actual de ciclos/propuestas. Multi-tenant, reconstruible.
 */
import { ConcurrencyError, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import type { Derivacion } from '../dominio/propuesta';
import type { CambioAplicado } from '../dominio/politica-oscilacion';

const EVENTOS_MEMORIA_DEC = { entrada: 'memoria-decision.entrada' } as const;
function memoriaStreamId(org: string): string { return `memoria-decision:${org}`; }

export interface RegistroDecision {
  readonly cicloId: string;
  readonly propuestaId: string;
  readonly decision: string; // APROBADA | RECHAZADA | NO_ACTUAR | APLICADA
  readonly actorHumano: string | null;
  readonly motivo: string;
  readonly aplicada: boolean;
  readonly derivaciones: readonly Derivacion[];
  readonly cambios: readonly CambioAplicado[];
  readonly en: string;
}

export class MemoriaDecisionesService {
  constructor(private readonly store: EventStore) {}
  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  /** Registra una decisión (idempotente por propuestaId+decision; convergente ante concurrencia). */
  async registrar(ctx: RequestContext, r: RegistroDecision, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, memoriaStreamId(org));
    const clave = `${r.propuestaId}:${r.decision}`;
    if (events.some((e) => e.type === EVENTOS_MEMORIA_DEC.entrada && `${(e.payload as RegistroDecision).propuestaId}:${(e.payload as RegistroDecision).decision}` === clave)) return;
    try { await this.store.append(ctx, memoriaStreamId(org), events.length, [{ type: EVENTOS_MEMORIA_DEC.entrada, payload: r, attribution: a, occurredAt: o }]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  async listar(ctx: RequestContext): Promise<readonly RegistroDecision[]> {
    const events = await this.store.readStream(ctx, memoriaStreamId(this.org(ctx)));
    return events.filter((e) => e.type === EVENTOS_MEMORIA_DEC.entrada).map((e) => e.payload as RegistroDecision);
  }

  /** Historial de cambios APLICADOS (para la guarda de oscilación). */
  async historialCambios(ctx: RequestContext): Promise<readonly CambioAplicado[]> {
    return (await this.listar(ctx)).filter((r) => r.aplicada).flatMap((r) => r.cambios);
  }
}
