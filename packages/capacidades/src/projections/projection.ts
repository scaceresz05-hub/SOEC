/**
 * Proyecciones de capacidades: definiciones vigentes y ejecuciones.
 * Reconstruibles e idempotentes por secuencia; nunca fuente primaria.
 * Capacidades distintas no se fusionan; los productos intermedios no se pierden.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type CapDefState, aplicarCapDef, estadoInicialCapDef } from '../domain/aggregate-definition';
import { type CapExecState, aplicarCapExec, estadoInicialCapExec } from '../domain/aggregate-execution';

export interface CapDefSnapshot {
  readonly version: number;
  readonly state: CapDefState;
}
export interface CapExecSnapshot {
  readonly version: number;
  readonly state: CapExecState;
}

export interface CapDefProjectionStore {
  get(org: string, capabilityId: string): Promise<CapDefSnapshot | null>;
  save(org: string, capabilityId: string, snap: CapDefSnapshot): Promise<void>;
  list(org: string): Promise<readonly CapDefState[]>;
  deleteAll(): Promise<void>;
}
export interface CapExecProjectionStore {
  get(org: string, executionId: string): Promise<CapExecSnapshot | null>;
  save(org: string, executionId: string, snap: CapExecSnapshot): Promise<void>;
  list(org: string): Promise<readonly CapExecState[]>;
  deleteAll(): Promise<void>;
}

export interface CapProjectionStores {
  readonly def: CapDefProjectionStore;
  readonly exec: CapExecProjectionStore;
}

export function parseCapStream(streamId: string): { tipo: 'def' | 'exec'; id: string } | null {
  if (streamId.startsWith('capdef:')) return { tipo: 'def', id: streamId.slice('capdef:'.length) };
  if (streamId.startsWith('capexec:')) return { tipo: 'exec', id: streamId.slice('capexec:'.length) };
  return null;
}

export async function aplicarEventoAProyeccionCap(
  stores: CapProjectionStores,
  event: RecordedEvent,
): Promise<'applied' | 'skipped' | 'ignored'> {
  const ref = parseCapStream(event.streamId);
  if (!ref) return 'ignored';
  if (ref.tipo === 'def') {
    const snap = await stores.def.get(event.organizationId, ref.id);
    const version = snap?.version ?? 0;
    if (event.sequence <= version) return 'skipped';
    if (event.sequence !== version + 1) throw new Error(`Hueco en proyección capdef ${ref.id}`);
    const base = snap?.state ?? estadoInicialCapDef(ref.id, event.organizationId);
    await stores.def.save(event.organizationId, ref.id, { version: event.sequence, state: aplicarCapDef(base, event) });
    return 'applied';
  }
  const snap = await stores.exec.get(event.organizationId, ref.id);
  const version = snap?.version ?? 0;
  if (event.sequence <= version) return 'skipped';
  if (event.sequence !== version + 1) throw new Error(`Hueco en proyección capexec ${ref.id}`);
  const base = snap?.state ?? estadoInicialCapExec(ref.id, event.organizationId);
  await stores.exec.save(event.organizationId, ref.id, { version: event.sequence, state: aplicarCapExec(base, event) });
  return 'applied';
}

export class InMemoryCapDefProjectionStore implements CapDefProjectionStore {
  private readonly data = new Map<string, CapDefSnapshot>();
  private k(o: string, i: string): string {
    return `${o}::${i}`;
  }
  async get(o: string, i: string): Promise<CapDefSnapshot | null> {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: CapDefSnapshot): Promise<void> {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string): Promise<readonly CapDefState[]> {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
  }
}

export class InMemoryCapExecProjectionStore implements CapExecProjectionStore {
  private readonly data = new Map<string, CapExecSnapshot>();
  private k(o: string, i: string): string {
    return `${o}::${i}`;
  }
  async get(o: string, i: string): Promise<CapExecSnapshot | null> {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: CapExecSnapshot): Promise<void> {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string): Promise<readonly CapExecState[]> {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
  }
}
