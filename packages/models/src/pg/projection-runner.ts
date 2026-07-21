import type { Pool } from 'pg';
import type { ActorId, Attribution, OrganizationId, Outbox, RecordedEvent } from '@soec/contracts';
import { type ModelInstanceState, reconstruir } from '../domain/model';
import { type ModelProjectionStore, aplicarEventoAProyeccion, parseStream } from '../projections/projection';
import { PgProjectionStore } from './projection-store';

/**
 * Drena el outbox y actualiza las proyecciones de MED y MDM de forma idempotente.
 * El worker no decide ni ejecuta acciones reservadas a la persona: solo proyecta
 * representación (frontera del ECE, #12).
 */
export async function drenarProyecciones(
  outbox: Outbox,
  store: ModelProjectionStore,
  limit = 100,
): Promise<number> {
  const pendientes = await outbox.pending(limit);
  for (const msg of pendientes) {
    await aplicarEventoAProyeccion(store, msg.event);
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

/**
 * Reconstruye TODAS las proyecciones desde cero a partir de la historia inmutable.
 * Operación de sistema (lee la tabla de eventos directamente): borrar y reconstruir
 * produce exactamente el mismo estado que el procesamiento incremental.
 */
export async function reconstruirProyecciones(pool: Pool): Promise<number> {
  const store = new PgProjectionStore(pool);
  await store.deleteAll();

  const { rows } = await pool.query<EventRow>(
    `select * from events
       where stream_id like 'med:%' or stream_id like 'mdm:%'
       order by organization_id, stream_id, sequence`,
  );

  // Agrupa por (organización, stream) preservando el orden por secuencia.
  const grupos = new Map<string, RecordedEvent[]>();
  for (const r of rows) {
    const ev = mapRow(r);
    const key = `${ev.organizationId}::${ev.streamId}`;
    const lista = grupos.get(key) ?? [];
    lista.push(ev);
    grupos.set(key, lista);
  }

  let proyectadas = 0;
  for (const eventos of grupos.values()) {
    const primero = eventos[0];
    if (!primero) continue;
    const ref = parseStream(primero.streamId);
    if (!ref) continue;
    const estado: ModelInstanceState = reconstruir(
      ref.instanceId,
      ref.modelType,
      primero.organizationId,
      eventos,
    );
    await store.save(ref.modelType, primero.organizationId, ref.instanceId, {
      version: eventos.length,
      state: estado,
    });
    proyectadas += 1;
  }
  return proyectadas;
}
