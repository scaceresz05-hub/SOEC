import {
  type AppendResult,
  type EventInput,
  type EventStore,
  type RecordedEvent,
  type RequestContext,
  ConcurrencyError,
  SoecError,
  assertAttribution,
  requireScope,
} from '@soec/contracts';
import { randomUUID } from 'node:crypto';
import { type Clock, systemClock } from './clock';

/**
 * Implementación de referencia en memoria del EventStore.
 * Semántica idéntica a la de PostgreSQL; sirve para verificar los contratos
 * (append-only, historia inmutable, concurrencia, idempotencia, reconstrucción).
 * No sustituye la prueba con PostgreSQL real (ADR-0002).
 */
export class InMemoryEventStore implements EventStore {
  private readonly streams = new Map<string, RecordedEvent[]>();

  constructor(private readonly clock: Clock = systemClock) {}

  private key(ctx: RequestContext, streamId: string): string {
    return `${ctx.organizationId}::${streamId}`;
  }

  async currentVersion(ctx: RequestContext, streamId: string): Promise<number> {
    requireScope(ctx, 'events:read');
    return (this.streams.get(this.key(ctx, streamId)) ?? []).length;
  }

  async append(
    ctx: RequestContext,
    streamId: string,
    expectedVersion: number,
    events: readonly EventInput[],
  ): Promise<AppendResult> {
    requireScope(ctx, 'events:append');
    if (events.length === 0) throw new SoecError('append vacío');

    const k = this.key(ctx, streamId);
    const existing = this.streams.get(k) ?? [];

    // Idempotencia: si todos los eventos del lote ya existen por su clave, es una
    // repetición — se devuelven los eventos previos sin duplicar ni exigir versión.
    const withKeys = events.filter((e) => e.idempotencyKey);
    if (withKeys.length === events.length && withKeys.length > 0) {
      const replay = existing.filter(
        (r) => r.idempotencyKey && events.some((e) => e.idempotencyKey === r.idempotencyKey),
      );
      if (replay.length === events.length) {
        return { events: replay, version: existing.length };
      }
    }

    // Concurrencia optimista.
    if (expectedVersion !== existing.length) {
      throw new ConcurrencyError(
        `Conflicto de versión en '${streamId}': esperado ${expectedVersion}, actual ${existing.length}`,
      );
    }

    const recorded: RecordedEvent[] = [];
    let seq = existing.length;
    for (const e of events) {
      assertAttribution(e.attribution);
      seq += 1;
      recorded.push({
        eventId: randomUUID(),
        streamId,
        sequence: seq,
        organizationId: ctx.organizationId,
        actor: ctx.actor,
        type: e.type,
        payload: e.payload,
        attribution: e.attribution,
        occurredAt: e.occurredAt,
        recordedAt: this.clock.now(),
        correlationId: ctx.correlationId,
        causationId: e.causationId ?? null,
        idempotencyKey: e.idempotencyKey ?? null,
      });
    }

    // Append-only: se crea una lista nueva; los eventos previos nunca se mutan.
    this.streams.set(k, [...existing, ...recorded]);
    return { events: recorded, version: existing.length + recorded.length };
  }

  async readStream(ctx: RequestContext, streamId: string): Promise<readonly RecordedEvent[]> {
    requireScope(ctx, 'events:read');
    return [...(this.streams.get(this.key(ctx, streamId)) ?? [])];
  }

  async reconstructAt(
    ctx: RequestContext,
    streamId: string,
    asOfRecordedAt: string,
  ): Promise<readonly RecordedEvent[]> {
    requireScope(ctx, 'events:read');
    const cutoff = new Date(asOfRecordedAt).getTime();
    return (this.streams.get(this.key(ctx, streamId)) ?? []).filter(
      (r) => new Date(r.recordedAt).getTime() <= cutoff,
    );
  }

  /**
   * Exporta el LOG completo (todas las streams, ya recordadas) como estructura serializable. Permite
   * demostrar replay FRÍO: serializar el log y reconstruirlo en una instancia NUEVA (ver `desdeInstantanea`),
   * sin reutilizar mapas ni referencias de objeto del proceso anterior.
   */
  exportar(): Record<string, readonly RecordedEvent[]> {
    const out: Record<string, readonly RecordedEvent[]> = {};
    for (const [k, v] of this.streams) out[k] = v;
    return out;
  }

  /**
   * Construye una instancia NUEVA a partir de un log exportado (idealmente tras un round-trip JSON, de modo
   * que no comparta referencias con el store original). Los eventos ya están recordados: se ingieren tal
   * cual, sin re-generar ids/tiempos. Sirve para replay frío en tests.
   */
  static desdeInstantanea(
    instantanea: Readonly<Record<string, readonly RecordedEvent[]>>,
    clock: Clock = systemClock,
  ): InMemoryEventStore {
    const s = new InMemoryEventStore(clock);
    for (const [k, evs] of Object.entries(instantanea)) s.streams.set(k, [...evs]);
    return s;
  }
}
