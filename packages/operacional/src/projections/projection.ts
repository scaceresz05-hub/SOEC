/**
 * Proyecciones de políticas y acciones operativas — reconstruibles e idempotentes.
 * Base de la auditoría del departamento autónomo.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type PolicyState, aplicarPolicy, estadoInicialPolicy } from '../domain/policy';
import { type AccionState, aplicarAccion, estadoInicialAccion } from '../domain/action';

export interface PolicySnapshot {
  readonly version: number;
  readonly state: PolicyState;
}
export interface AccionSnapshot {
  readonly version: number;
  readonly state: AccionState;
}

export interface PolicyProjectionStore {
  get(org: string, policyId: string): Promise<PolicySnapshot | null>;
  save(org: string, policyId: string, snap: PolicySnapshot): Promise<void>;
  list(org: string): Promise<readonly PolicyState[]>;
  deleteAll(): Promise<void>;
}
export interface AccionProjectionStore {
  get(org: string, executionId: string): Promise<AccionSnapshot | null>;
  save(org: string, executionId: string, snap: AccionSnapshot): Promise<void>;
  list(org: string): Promise<readonly AccionState[]>;
  deleteAll(): Promise<void>;
}
export interface OperationalProjectionStores {
  readonly policy: PolicyProjectionStore;
  readonly accion: AccionProjectionStore;
}

export function parseOperacionalStream(streamId: string): { tipo: 'pol' | 'acc'; id: string } | null {
  if (streamId.startsWith('pol:')) return { tipo: 'pol', id: streamId.slice('pol:'.length) };
  if (streamId.startsWith('acc:')) return { tipo: 'acc', id: streamId.slice('acc:'.length) };
  return null;
}

export async function aplicarEventoAProyeccionOperacional(
  stores: OperationalProjectionStores,
  event: RecordedEvent,
): Promise<'applied' | 'skipped' | 'ignored'> {
  const ref = parseOperacionalStream(event.streamId);
  if (!ref) return 'ignored';
  if (ref.tipo === 'pol') {
    const snap = await stores.policy.get(event.organizationId, ref.id);
    const version = snap?.version ?? 0;
    if (event.sequence <= version) return 'skipped';
    if (event.sequence !== version + 1) throw new Error(`Hueco en proyección pol ${ref.id}`);
    const base = snap?.state ?? estadoInicialPolicy(ref.id, event.organizationId);
    await stores.policy.save(event.organizationId, ref.id, { version: event.sequence, state: aplicarPolicy(base, event) });
    return 'applied';
  }
  const snap = await stores.accion.get(event.organizationId, ref.id);
  const version = snap?.version ?? 0;
  if (event.sequence <= version) return 'skipped';
  if (event.sequence !== version + 1) throw new Error(`Hueco en proyección acc ${ref.id}`);
  const base = snap?.state ?? estadoInicialAccion(ref.id, event.organizationId);
  await stores.accion.save(event.organizationId, ref.id, { version: event.sequence, state: aplicarAccion(base, event) });
  return 'applied';
}

class MemStore<S> {
  protected readonly data = new Map<string, { version: number; state: S }>();
  protected k(o: string, i: string): string {
    return `${o}::${i}`;
  }
}
export class InMemoryPolicyProjectionStore extends MemStore<PolicyState> implements PolicyProjectionStore {
  async get(o: string, i: string): Promise<PolicySnapshot | null> {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: PolicySnapshot): Promise<void> {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string): Promise<readonly PolicyState[]> {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
  }
}
export class InMemoryAccionProjectionStore extends MemStore<AccionState> implements AccionProjectionStore {
  async get(o: string, i: string): Promise<AccionSnapshot | null> {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: AccionSnapshot): Promise<void> {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string): Promise<readonly AccionState[]> {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
  }
}
