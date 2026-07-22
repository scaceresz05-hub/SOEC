import type { Pool } from 'pg';
import type { ActorId, Attribution, OrganizationId, Outbox, RecordedEvent } from '@soec/contracts';
import { reconstruirEnsayo } from '../domain/ensayo';
import { reconstruirExpediente } from '../domain/expediente';
import { reconstruirOrg } from '../domain/organizacion';
import { type PilotoProjectionStores, aplicarEventoAProyeccionPiloto, parsePilotoStream } from '../projections/projection';
import { PgEnsProjectionStore, PgExpProjectionStore, PgOrgProjectionStore } from './projection-store';

export async function drenarPiloto(outbox: Outbox, stores: PilotoProjectionStores, limit = 100): Promise<number> {
  const pendientes = await outbox.pending(limit);
  for (const msg of pendientes) {
    await aplicarEventoAProyeccionPiloto(stores, msg.event);
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

export async function reconstruirProyeccionesPiloto(pool: Pool): Promise<number> {
  const organizacion = new PgOrgProjectionStore(pool);
  const expediente = new PgExpProjectionStore(pool);
  const ensayo = new PgEnsProjectionStore(pool);
  await organizacion.deleteAll();
  await expediente.deleteAll();
  await ensayo.deleteAll();
  const { rows } = await pool.query<EventRow>(`select * from events where stream_id like 'org:%' or stream_id like 'exp:%' or stream_id like 'ens:%' order by organization_id, stream_id, sequence`);
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
    const ref = parsePilotoStream(primero.streamId);
    if (!ref) continue;
    const org = primero.organizationId;
    if (ref.tipo === 'org') await organizacion.save(org, ref.id, { version: eventos.length, state: reconstruirOrg(ref.id, org, eventos) });
    else if (ref.tipo === 'exp') await expediente.save(org, ref.id, { version: eventos.length, state: reconstruirExpediente(ref.id, org, eventos) });
    else await ensayo.save(org, ref.id, { version: eventos.length, state: reconstruirEnsayo(ref.id, org, eventos) });
    n += 1;
  }
  return n;
}
