/**
 * Proyecciones de objetivos y planes — reconstruibles e idempotentes.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type ObjetivoState, aplicarObjetivo, estadoInicialObjetivo } from '../domain/objetivo';
import { type PlanState, aplicarPlan, estadoInicialPlan } from '../domain/plan';

export interface ObjetivoSnapshot {
  readonly version: number;
  readonly state: ObjetivoState;
}
export interface PlanSnapshot {
  readonly version: number;
  readonly state: PlanState;
}

export interface ObjetivoProjectionStore {
  get(org: string, id: string): Promise<ObjetivoSnapshot | null>;
  save(org: string, id: string, snap: ObjetivoSnapshot): Promise<void>;
  list(org: string): Promise<readonly ObjetivoState[]>;
  deleteAll(): Promise<void>;
}
export interface PlanProjectionStore {
  get(org: string, id: string): Promise<PlanSnapshot | null>;
  save(org: string, id: string, snap: PlanSnapshot): Promise<void>;
  list(org: string): Promise<readonly PlanState[]>;
  deleteAll(): Promise<void>;
}
export interface MarketingProjectionStores {
  readonly objetivo: ObjetivoProjectionStore;
  readonly plan: PlanProjectionStore;
}

export function parseMarketingStream(streamId: string): { tipo: 'obj' | 'plan'; id: string } | null {
  if (streamId.startsWith('obj:')) return { tipo: 'obj', id: streamId.slice('obj:'.length) };
  if (streamId.startsWith('plan:')) return { tipo: 'plan', id: streamId.slice('plan:'.length) };
  return null;
}

export async function aplicarEventoAProyeccionMarketing(
  stores: MarketingProjectionStores,
  event: RecordedEvent,
): Promise<'applied' | 'skipped' | 'ignored'> {
  const ref = parseMarketingStream(event.streamId);
  if (!ref) return 'ignored';
  if (ref.tipo === 'obj') {
    const snap = await stores.objetivo.get(event.organizationId, ref.id);
    const version = snap?.version ?? 0;
    if (event.sequence <= version) return 'skipped';
    if (event.sequence !== version + 1) throw new Error(`Hueco en proyección obj ${ref.id}`);
    const base = snap?.state ?? estadoInicialObjetivo(ref.id, event.organizationId);
    await stores.objetivo.save(event.organizationId, ref.id, { version: event.sequence, state: aplicarObjetivo(base, event) });
    return 'applied';
  }
  const snap = await stores.plan.get(event.organizationId, ref.id);
  const version = snap?.version ?? 0;
  if (event.sequence <= version) return 'skipped';
  if (event.sequence !== version + 1) throw new Error(`Hueco en proyección plan ${ref.id}`);
  const base = snap?.state ?? estadoInicialPlan(ref.id, event.organizationId);
  await stores.plan.save(event.organizationId, ref.id, { version: event.sequence, state: aplicarPlan(base, event) });
  return 'applied';
}

class Mem<S> {
  protected readonly data = new Map<string, { version: number; state: S }>();
  protected k(o: string, i: string): string {
    return `${o}::${i}`;
  }
}
export class InMemoryObjetivoProjectionStore extends Mem<ObjetivoState> implements ObjetivoProjectionStore {
  async get(o: string, i: string) {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: ObjetivoSnapshot) {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string) {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll() {
    this.data.clear();
  }
}
export class InMemoryPlanProjectionStore extends Mem<PlanState> implements PlanProjectionStore {
  async get(o: string, i: string) {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: PlanSnapshot) {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string) {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll() {
    this.data.clear();
  }
}
