/**
 * Proyecciones de la fábrica de contenido — reconstruibles e idempotentes.
 * Permiten consultar trabajo pendiente, paquetes bloqueados/listos, adaptaciones
 * por canal, versiones, hallazgos, procedencia, actividad de origen y estado de
 * publicación simulada, sin recorrer el event store en caliente.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type BriefState, aplicarBrief, estadoInicialBrief } from '../domain/brief';
import { type PaqueteState, aplicarPaquete, estadoInicialPaquete } from '../domain/paquete';

export interface BriefSnapshot {
  readonly version: number;
  readonly state: BriefState;
}
export interface PaqueteSnapshot {
  readonly version: number;
  readonly state: PaqueteState;
}

export interface BriefProjectionStore {
  get(org: string, id: string): Promise<BriefSnapshot | null>;
  save(org: string, id: string, snap: BriefSnapshot): Promise<void>;
  list(org: string): Promise<readonly BriefState[]>;
  deleteAll(): Promise<void>;
}
export interface PaqueteProjectionStore {
  get(org: string, id: string): Promise<PaqueteSnapshot | null>;
  save(org: string, id: string, snap: PaqueteSnapshot): Promise<void>;
  list(org: string): Promise<readonly PaqueteState[]>;
  deleteAll(): Promise<void>;
}
export interface ContenidoProjectionStores {
  readonly brief: BriefProjectionStore;
  readonly paquete: PaqueteProjectionStore;
}

export function parseContenidoStream(streamId: string): { tipo: 'brief' | 'paquete'; id: string } | null {
  if (streamId.startsWith('brief:')) return { tipo: 'brief', id: streamId.slice('brief:'.length) };
  if (streamId.startsWith('paquete:')) return { tipo: 'paquete', id: streamId.slice('paquete:'.length) };
  return null;
}

export async function aplicarEventoAProyeccionContenido(
  stores: ContenidoProjectionStores,
  event: RecordedEvent,
): Promise<'applied' | 'skipped' | 'ignored'> {
  const ref = parseContenidoStream(event.streamId);
  if (!ref) return 'ignored';
  if (ref.tipo === 'brief') {
    const snap = await stores.brief.get(event.organizationId, ref.id);
    const version = snap?.version ?? 0;
    if (event.sequence <= version) return 'skipped';
    if (event.sequence !== version + 1) throw new Error(`Hueco en proyección brief ${ref.id}`);
    const base = snap?.state ?? estadoInicialBrief(ref.id, event.organizationId);
    await stores.brief.save(event.organizationId, ref.id, { version: event.sequence, state: aplicarBrief(base, event) });
    return 'applied';
  }
  const snap = await stores.paquete.get(event.organizationId, ref.id);
  const version = snap?.version ?? 0;
  if (event.sequence <= version) return 'skipped';
  if (event.sequence !== version + 1) throw new Error(`Hueco en proyección paquete ${ref.id}`);
  const base = snap?.state ?? estadoInicialPaquete(ref.id, event.organizationId);
  await stores.paquete.save(event.organizationId, ref.id, { version: event.sequence, state: aplicarPaquete(base, event) });
  return 'applied';
}

class Mem<S> {
  protected readonly data = new Map<string, { version: number; state: S }>();
  protected k(o: string, i: string): string {
    return `${o}::${i}`;
  }
}
export class InMemoryBriefProjectionStore extends Mem<BriefState> implements BriefProjectionStore {
  async get(o: string, i: string) {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: BriefSnapshot) {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string) {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll() {
    this.data.clear();
  }
}
export class InMemoryPaqueteProjectionStore extends Mem<PaqueteState> implements PaqueteProjectionStore {
  async get(o: string, i: string) {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: PaqueteSnapshot) {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string) {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll() {
    this.data.clear();
  }
}
