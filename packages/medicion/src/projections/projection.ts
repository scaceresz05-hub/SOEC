/**
 * Proyecciones de medición y optimización — reconstruibles e idempotentes.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type MedState, aplicarMed, estadoInicialMed } from '../domain/med';
import { type OptimizacionState, aplicarOpt, estadoInicialOpt } from '../domain/optimization';

export interface MedSnapshot {
  readonly version: number;
  readonly state: MedState;
}
export interface OptSnapshot {
  readonly version: number;
  readonly state: OptimizacionState;
}
export interface MedProjectionStore {
  get(org: string, id: string): Promise<MedSnapshot | null>;
  save(org: string, id: string, snap: MedSnapshot): Promise<void>;
  list(org: string): Promise<readonly MedState[]>;
  deleteAll(): Promise<void>;
}
export interface OptProjectionStore {
  get(org: string, id: string): Promise<OptSnapshot | null>;
  save(org: string, id: string, snap: OptSnapshot): Promise<void>;
  list(org: string): Promise<readonly OptimizacionState[]>;
  deleteAll(): Promise<void>;
}
export interface MedicionProjectionStores {
  readonly medicion: MedProjectionStore;
  readonly optimizacion: OptProjectionStore;
}

export function parseMedicionStream(streamId: string): { tipo: 'med' | 'opt'; id: string } | null {
  if (streamId.startsWith('med:')) return { tipo: 'med', id: streamId.slice('med:'.length) };
  if (streamId.startsWith('opt:')) return { tipo: 'opt', id: streamId.slice('opt:'.length) };
  return null;
}

export async function aplicarEventoAProyeccionMedicion(stores: MedicionProjectionStores, event: RecordedEvent): Promise<'applied' | 'skipped' | 'ignored'> {
  const ref = parseMedicionStream(event.streamId);
  if (!ref) return 'ignored';
  if (ref.tipo === 'med') {
    const snap = await stores.medicion.get(event.organizationId, ref.id);
    const version = snap?.version ?? 0;
    if (event.sequence <= version) return 'skipped';
    if (event.sequence !== version + 1) throw new Error(`Hueco en proyección med ${ref.id}`);
    const base = snap?.state ?? estadoInicialMed(ref.id, event.organizationId);
    await stores.medicion.save(event.organizationId, ref.id, { version: event.sequence, state: aplicarMed(base, event) });
    return 'applied';
  }
  const snap = await stores.optimizacion.get(event.organizationId, ref.id);
  const version = snap?.version ?? 0;
  if (event.sequence <= version) return 'skipped';
  if (event.sequence !== version + 1) throw new Error(`Hueco en proyección opt ${ref.id}`);
  const base = snap?.state ?? estadoInicialOpt(ref.id, event.organizationId);
  await stores.optimizacion.save(event.organizationId, ref.id, { version: event.sequence, state: aplicarOpt(base, event) });
  return 'applied';
}

class Mem<S> {
  protected readonly data = new Map<string, { version: number; state: S }>();
  protected k(o: string, i: string): string {
    return `${o}::${i}`;
  }
}
export class InMemoryMedProjectionStore extends Mem<MedState> implements MedProjectionStore {
  async get(o: string, i: string) {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: MedSnapshot) {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string) {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll() {
    this.data.clear();
  }
}
export class InMemoryOptProjectionStore extends Mem<OptimizacionState> implements OptProjectionStore {
  async get(o: string, i: string) {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: OptSnapshot) {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string) {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll() {
    this.data.clear();
  }
}
