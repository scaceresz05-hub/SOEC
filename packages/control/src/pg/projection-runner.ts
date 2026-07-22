import type { Pool } from 'pg';
import type { ActorId, Attribution, OrganizationId, Outbox, RecordedEvent } from '@soec/contracts';
import { reconstruirDecision } from '../domain/decision';
import { reconstruirInbox } from '../domain/inbox';
import { reconstruirPausa } from '../domain/pausa';
import { type ControlProjectionStores, aplicarEventoAProyeccionControl, parseControlStream } from '../projections/projection';
import { PgDecisionProjectionStore, PgInboxProjectionStore, PgPausaProjectionStore } from './projection-store';

export async function drenarControl(outbox: Outbox, stores: ControlProjectionStores, limit = 100): Promise<number> {
  const pendientes = await outbox.pending(limit);
  for (const msg of pendientes) {
    await aplicarEventoAProyeccionControl(stores, msg.event);
    await outbox.markProcessed(msg.id);
  }
  return pendientes.length;
}

interface EventRow {
  event_id: string;
  stream_id: string;
  sequence: number;
  organization_id: string;
  actor_id: string;
  type: string;
  payload: unknown;
  attribution: unknown;
  occurred_at: Date;
  recorded_at: Date;
  correlation_id: string;
  causation_id: string | null;
  idempotency_key: string | null;
}
function mapRow(r: EventRow): RecordedEvent {
  return {
    eventId: r.event_id,
    streamId: r.stream_id,
    sequence: r.sequence,
    organizationId: r.organization_id as OrganizationId,
    actor: r.actor_id as ActorId,
    type: r.type,
    payload: r.payload,
    attribution: r.attribution as Attribution,
    occurredAt: r.occurred_at.toISOString(),
    recordedAt: r.recorded_at.toISOString(),
    correlationId: r.correlation_id,
    causationId: r.causation_id,
    idempotencyKey: r.idempotency_key,
  };
}

export async function reconstruirProyeccionesControl(pool: Pool): Promise<number> {
  const pausa = new PgPausaProjectionStore(pool);
  const decision = new PgDecisionProjectionStore(pool);
  const inbox = new PgInboxProjectionStore(pool);
  await pausa.deleteAll();
  await decision.deleteAll();
  await inbox.deleteAll();
  const { rows } = await pool.query<EventRow>(`select * from events where stream_id like 'pausa:%' or stream_id like 'dec:%' or stream_id like 'ctrlbox:%' order by organization_id, stream_id, sequence`);
  const grupos = new Map<string, RecordedEvent[]>();
  for (const r of rows) {
    const ev = mapRow(r);
    const key = `${ev.organizationId}::${ev.streamId}`;
    const lista = grupos.get(key) ?? [];
    lista.push(ev);
    grupos.set(key, lista);
  }
  let n = 0;
  for (const eventos of grupos.values()) {
    const primero = eventos[0];
    if (!primero) continue;
    const ref = parseControlStream(primero.streamId);
    if (!ref) continue;
    const org = primero.organizationId;
    if (ref.tipo === 'pausa') await pausa.save(org, { version: eventos.length, state: reconstruirPausa(org, eventos) });
    else if (ref.tipo === 'dec') await decision.save(org, ref.id, { version: eventos.length, state: reconstruirDecision(ref.id, org, eventos) });
    else await inbox.save(org, { version: eventos.length, state: reconstruirInbox(org, eventos) });
    n += 1;
  }
  return n;
}
