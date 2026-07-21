import type { Pool } from 'pg';
import type { ActorId, Attribution, OrganizationId, Outbox, RecordedEvent } from '@soec/contracts';
import { aplicarEventoAProyeccion, type ModelProjectionStore } from '@soec/models';
import { reconstruirEce } from '../domain/ece';
import { parseEceStream } from '../projections/projection';
import { PgEceProjectionStore } from './projection-store';
import { type EceWorkerDeps, procesarEventoParaEce } from './invalidation';

/**
 * Drenaje único del outbox que actualiza a la vez:
 * - las proyecciones de MED y MDM (modelos);
 * - la proyección del ECE e invalidaciones por cambios de entrada.
 * Un solo consumidor del outbox evita el problema de multi-consumo.
 */
export async function drenarModelosYEce(
  outbox: Outbox,
  modelStore: ModelProjectionStore,
  eceDeps: EceWorkerDeps,
  limit = 100,
): Promise<{ procesados: number; invalidaciones: number }> {
  const pendientes = await outbox.pending(limit);
  let invalidaciones = 0;
  for (const msg of pendientes) {
    await aplicarEventoAProyeccion(modelStore, msg.event);
    invalidaciones += await procesarEventoParaEce(msg.event, eceDeps);
    await outbox.markProcessed(msg.id);
  }
  return { procesados: pendientes.length, invalidaciones };
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

/** Reconstruye TODAS las proyecciones del ECE desde la historia inmutable. */
export async function reconstruirProyeccionesEce(pool: Pool): Promise<number> {
  const store = new PgEceProjectionStore(pool);
  await store.deleteAll();
  const { rows } = await pool.query<EventRow>(
    `select * from events where stream_id like 'ece:%' order by organization_id, stream_id, sequence`,
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
    const eceId = parseEceStream(primero.streamId);
    if (!eceId) continue;
    const estado = reconstruirEce(eceId, primero.organizationId, eventos);
    await store.save(primero.organizationId, eceId, { version: eventos.length, state: estado });
    n += 1;
  }
  return n;
}
