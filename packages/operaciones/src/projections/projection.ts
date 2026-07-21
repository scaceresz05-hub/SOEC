/**
 * Proyección actual de las ejecuciones de operaciones intelectuales.
 * Reconstruible e idempotente por secuencia; nunca es fuente primaria.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type OiState, aplicarOi, estadoInicialOi } from '../domain/aggregate';

export interface OiSnapshot {
  readonly version: number;
  readonly state: OiState;
}

export interface OiProjectionStore {
  get(organizationId: string, executionId: string): Promise<OiSnapshot | null>;
  save(organizationId: string, executionId: string, snapshot: OiSnapshot): Promise<void>;
  list(organizationId: string): Promise<readonly OiState[]>;
  deleteAll(): Promise<void>;
}

export function parseOiStream(streamId: string): string | null {
  return streamId.startsWith('oi:') ? streamId.slice('oi:'.length) : null;
}

/** Aplica un evento de operación a su proyección, idempotente por secuencia. */
export async function proyectarEventoOi(
  store: OiProjectionStore,
  event: RecordedEvent,
): Promise<'applied' | 'skipped' | 'ignored'> {
  const executionId = parseOiStream(event.streamId);
  if (!executionId) return 'ignored';
  const snap = await store.get(event.organizationId, executionId);
  const version = snap?.version ?? 0;
  if (event.sequence <= version) return 'skipped';
  if (event.sequence !== version + 1) {
    throw new Error(`Hueco de secuencia en proyección OI ${executionId}: esperado ${version + 1}, recibido ${event.sequence}`);
  }
  const base = snap?.state ?? estadoInicialOi(executionId, event.organizationId);
  const next = aplicarOi(base, event);
  await store.save(event.organizationId, executionId, { version: event.sequence, state: next });
  return 'applied';
}

export class InMemoryOiProjectionStore implements OiProjectionStore {
  private readonly data = new Map<string, OiSnapshot>();
  private key(org: string, id: string): string {
    return `${org}::${id}`;
  }
  async get(org: string, id: string): Promise<OiSnapshot | null> {
    return this.data.get(this.key(org, id)) ?? null;
  }
  async save(org: string, id: string, snapshot: OiSnapshot): Promise<void> {
    this.data.set(this.key(org, id), snapshot);
  }
  async list(org: string): Promise<readonly OiState[]> {
    const prefix = `${org}::`;
    return [...this.data.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v.state);
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
  }
}
