/**
 * Proyección de publicaciones — reconstruible e idempotente. Permite consultar la
 * publicación actual, intentos, estado externo, errores, referencias,
 * reconciliaciones, retiros y webhooks sin recorrer el event store en caliente.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type PublicationState, aplicarPub, estadoInicialPub } from '../domain/publication';

export interface PublicationSnapshot {
  readonly version: number;
  readonly state: PublicationState;
}

export interface PublicationProjectionStore {
  get(org: string, id: string): Promise<PublicationSnapshot | null>;
  save(org: string, id: string, snap: PublicationSnapshot): Promise<void>;
  list(org: string): Promise<readonly PublicationState[]>;
  deleteAll(): Promise<void>;
}
export interface CanalesProjectionStores {
  readonly publicacion: PublicationProjectionStore;
}

export function parseCanalesStream(streamId: string): { tipo: 'pub'; id: string } | null {
  if (streamId.startsWith('pub:')) return { tipo: 'pub', id: streamId.slice('pub:'.length) };
  return null;
}

export async function aplicarEventoAProyeccionCanales(stores: CanalesProjectionStores, event: RecordedEvent): Promise<'applied' | 'skipped' | 'ignored'> {
  const ref = parseCanalesStream(event.streamId);
  if (!ref) return 'ignored';
  const snap = await stores.publicacion.get(event.organizationId, ref.id);
  const version = snap?.version ?? 0;
  if (event.sequence <= version) return 'skipped';
  if (event.sequence !== version + 1) throw new Error(`Hueco en proyección pub ${ref.id}`);
  const base = snap?.state ?? estadoInicialPub(ref.id, event.organizationId);
  await stores.publicacion.save(event.organizationId, ref.id, { version: event.sequence, state: aplicarPub(base, event) });
  return 'applied';
}

export class InMemoryPublicationProjectionStore implements PublicationProjectionStore {
  private readonly data = new Map<string, PublicationSnapshot>();
  private k(o: string, i: string): string {
    return `${o}::${i}`;
  }
  async get(o: string, i: string) {
    return this.data.get(this.k(o, i)) ?? null;
  }
  async save(o: string, i: string, s: PublicationSnapshot) {
    this.data.set(this.k(o, i), s);
  }
  async list(o: string) {
    return [...this.data.entries()].filter(([k]) => k.startsWith(`${o}::`)).map(([, v]) => v.state);
  }
  async deleteAll() {
    this.data.clear();
  }
}
