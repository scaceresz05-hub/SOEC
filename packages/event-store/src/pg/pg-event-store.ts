import type { Pool } from 'pg';
import {
  type ActorId,
  type AppendResult,
  type Attribution,
  type EventInput,
  type EventStore,
  type OrganizationId,
  type RecordedEvent,
  type RequestContext,
  ConcurrencyError,
  SoecError,
  assertAttribution,
  requireScope,
} from '@soec/contracts';
import { randomUUID } from 'node:crypto';

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

function mapRow(row: EventRow): RecordedEvent {
  return {
    eventId: row.event_id,
    streamId: row.stream_id,
    sequence: row.sequence,
    organizationId: row.organization_id as OrganizationId,
    actor: row.actor_id as ActorId,
    type: row.type,
    payload: row.payload,
    attribution: row.attribution as Attribution,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    idempotencyKey: row.idempotency_key,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * EventStore respaldado por PostgreSQL.
 * Realiza los contratos ADR-0002 con persistencia real: append-only,
 * concurrencia optimista (constraint único), idempotencia, historia inmutable,
 * reconstrucción temporal y aislamiento organizacional.
 */
export class PgEventStore implements EventStore {
  constructor(private readonly pool: Pool) {}

  async currentVersion(ctx: RequestContext, streamId: string): Promise<number> {
    requireScope(ctx, 'events:read');
    const { rows } = await this.pool.query<{ v: number }>(
      `select coalesce(max(sequence), 0)::int as v
         from events where organization_id = $1 and stream_id = $2`,
      [ctx.organizationId, streamId],
    );
    return rows[0]?.v ?? 0;
  }

  async append(
    ctx: RequestContext,
    streamId: string,
    expectedVersion: number,
    events: readonly EventInput[],
  ): Promise<AppendResult> {
    requireScope(ctx, 'events:append');
    if (events.length === 0) throw new SoecError('append vacío');
    for (const e of events) assertAttribution(e.attribution);

    const client = await this.pool.connect();
    try {
      await client.query('begin');

      // Idempotencia: repetición del lote completo → devuelve los eventos previos.
      const keys = events.map((e) => e.idempotencyKey).filter((k): k is string => Boolean(k));
      if (keys.length === events.length && keys.length > 0) {
        const replay = await client.query<EventRow>(
          `select * from events
             where organization_id = $1 and stream_id = $2 and idempotency_key = any($3::text[])
             order by sequence`,
          [ctx.organizationId, streamId, keys],
        );
        if (replay.rows.length === events.length) {
          await client.query('commit');
          const current = replay.rows.reduce((max, r) => Math.max(max, r.sequence), 0);
          return { events: replay.rows.map(mapRow), version: current };
        }
      }

      const versionResult = await client.query<{ v: number }>(
        `select coalesce(max(sequence), 0)::int as v
           from events where organization_id = $1 and stream_id = $2`,
        [ctx.organizationId, streamId],
      );
      const current = versionResult.rows[0]?.v ?? 0;
      if (current !== expectedVersion) {
        await client.query('rollback');
        throw new ConcurrencyError(
          `Conflicto de versión en '${streamId}': esperado ${expectedVersion}, actual ${current}`,
        );
      }

      const recorded: RecordedEvent[] = [];
      let seq = current;
      for (const e of events) {
        seq += 1;
        const eventId = randomUUID();
        const inserted = await client.query<EventRow>(
          `insert into events
             (event_id, stream_id, sequence, organization_id, actor_id, type,
              payload, attribution, occurred_at, correlation_id, causation_id, idempotency_key)
           values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)
           returning *`,
          [
            eventId,
            streamId,
            seq,
            ctx.organizationId,
            ctx.actor,
            e.type,
            JSON.stringify(e.payload ?? null),
            JSON.stringify(e.attribution),
            e.occurredAt,
            ctx.correlationId,
            e.causationId ?? null,
            e.idempotencyKey ?? null,
          ],
        );
        const row = inserted.rows[0];
        if (!row) throw new SoecError('insert sin retorno');
        await client.query(`insert into outbox (event_id) values ($1)`, [eventId]);
        recorded.push(mapRow(row));
      }

      await client.query('commit');
      return { events: recorded, version: seq };
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      if (isUniqueViolation(err)) {
        throw new ConcurrencyError(`Conflicto de concurrencia en '${streamId}'`);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async readStream(ctx: RequestContext, streamId: string): Promise<readonly RecordedEvent[]> {
    requireScope(ctx, 'events:read');
    const { rows } = await this.pool.query<EventRow>(
      `select * from events where organization_id = $1 and stream_id = $2 order by sequence`,
      [ctx.organizationId, streamId],
    );
    return rows.map(mapRow);
  }

  async reconstructAt(
    ctx: RequestContext,
    streamId: string,
    asOfRecordedAt: string,
  ): Promise<readonly RecordedEvent[]> {
    requireScope(ctx, 'events:read');
    const { rows } = await this.pool.query<EventRow>(
      `select * from events
         where organization_id = $1 and stream_id = $2 and recorded_at <= $3
         order by sequence`,
      [ctx.organizationId, streamId, asOfRecordedAt],
    );
    return rows.map(mapRow);
  }
}
