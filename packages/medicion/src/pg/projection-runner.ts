import type { Pool } from 'pg';
import type { ActorId, Attribution, OrganizationId, Outbox, RecordedEvent } from '@soec/contracts';
import { reconstruirMed } from '../domain/med';
import { reconstruirOpt } from '../domain/optimization';
import { type MedicionProjectionStores, aplicarEventoAProyeccionMedicion, parseMedicionStream } from '../projections/projection';
import { PgMedProjectionStore, PgOptProjectionStore } from './projection-store';

export async function drenarMedicion(outbox: Outbox, stores: MedicionProjectionStores, limit = 100): Promise<number> {
  const pendientes = await outbox.pending(limit);
  for (const msg of pendientes) {
    await aplicarEventoAProyeccionMedicion(stores, msg.event);
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

export async function reconstruirProyeccionesMedicion(pool: Pool): Promise<number> {
  const medicion = new PgMedProjectionStore(pool);
  const optimizacion = new PgOptProjectionStore(pool);
  await medicion.deleteAll();
  await optimizacion.deleteAll();
  const { rows } = await pool.query<EventRow>(`select * from events where stream_id like 'med:%' or stream_id like 'opt:%' order by organization_id, stream_id, sequence`);
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
    const ref = parseMedicionStream(primero.streamId);
    if (!ref) continue;
    if (ref.tipo === 'med') {
      await medicion.save(primero.organizationId, ref.id, { version: eventos.length, state: reconstruirMed(ref.id, primero.organizationId, eventos) });
    } else {
      await optimizacion.save(primero.organizationId, ref.id, { version: eventos.length, state: reconstruirOpt(ref.id, primero.organizationId, eventos) });
    }
    n += 1;
  }
  return n;
}
