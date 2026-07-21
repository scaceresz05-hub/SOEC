import type { Pool } from 'pg';
import type { ActorId, Attribution, OrganizationId, Outbox, RecordedEvent } from '@soec/contracts';
import { reconstruirCapDef } from '../domain/aggregate-definition';
import { reconstruirCapExec } from '../domain/aggregate-execution';
import {
  type CapProjectionStores,
  aplicarEventoAProyeccionCap,
  parseCapStream,
} from '../projections/projection';
import { PgCapDefProjectionStore, PgCapExecProjectionStore } from './projection-store';

/** Drena el outbox proyectando solo los eventos de capacidades (ignora los demás). */
export async function drenarCapacidades(outbox: Outbox, stores: CapProjectionStores, limit = 100): Promise<number> {
  const pendientes = await outbox.pending(limit);
  for (const msg of pendientes) {
    await aplicarEventoAProyeccionCap(stores, msg.event);
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

/** Reconstruye TODAS las proyecciones de capacidades desde la historia inmutable. */
export async function reconstruirProyeccionesCap(pool: Pool): Promise<number> {
  const def = new PgCapDefProjectionStore(pool);
  const exec = new PgCapExecProjectionStore(pool);
  await def.deleteAll();
  await exec.deleteAll();
  const { rows } = await pool.query<EventRow>(
    `select * from events where stream_id like 'capdef:%' or stream_id like 'capexec:%'
       order by organization_id, stream_id, sequence`,
  );
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
    const ref = parseCapStream(primero.streamId);
    if (!ref) continue;
    if (ref.tipo === 'def') {
      await def.save(primero.organizationId, ref.id, { version: eventos.length, state: reconstruirCapDef(ref.id, primero.organizationId, eventos) });
    } else {
      await exec.save(primero.organizationId, ref.id, { version: eventos.length, state: reconstruirCapExec(ref.id, primero.organizationId, eventos) });
    }
    n += 1;
  }
  return n;
}
