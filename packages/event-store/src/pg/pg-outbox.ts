import type { Pool } from 'pg';
import {
  type ActorId,
  type Attribution,
  type OrganizationId,
  type Outbox,
  type OutboxMessage,
  type RecordedEvent,
} from '@soec/contracts';

interface OutboxRow {
  id: string;
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

function mapEvent(r: OutboxRow): RecordedEvent {
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

/** Outbox transaccional sobre PostgreSQL — entrega asincrónica sin broker externo. */
export class PgOutbox implements Outbox {
  constructor(private readonly pool: Pool) {}

  async pending(limit: number): Promise<readonly OutboxMessage[]> {
    const { rows } = await this.pool.query<OutboxRow>(
      `select o.id, e.*
         from outbox o join events e on e.event_id = o.event_id
        where o.processed_at is null
        order by o.created_at
        limit $1`,
      [limit],
    );
    return rows.map((r) => ({ id: r.id, event: mapEvent(r) }));
  }

  async markProcessed(id: string): Promise<void> {
    // Idempotente: solo marca los aún no procesados.
    await this.pool.query(
      `update outbox set processed_at = now() where id = $1 and processed_at is null`,
      [id],
    );
  }
}
