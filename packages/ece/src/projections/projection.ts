/**
 * Proyección actual del ECE: estado reconstruible a partir de la historia.
 * Reemplazable, reconstruible e idempotente (por secuencia).
 */
import type { RecordedEvent } from '@soec/contracts';
import { type EceState, aplicarEce, estadoInicialEce } from '../domain/ece';

export interface EceSnapshot {
  readonly version: number;
  readonly state: EceState;
}

export interface EceAfectado {
  readonly eceId: string;
  readonly corteVersion: number;
}

export interface EceProjectionStore {
  get(organizationId: string, eceId: string): Promise<EceSnapshot | null>;
  save(organizationId: string, eceId: string, snapshot: EceSnapshot): Promise<void>;
  list(organizationId: string): Promise<readonly EceState[]>;
  /** ECEs vigentes cuyo corte de MED/MDM quedó por debajo de una nueva secuencia. */
  afectadosPorModelo(
    organizationId: string,
    modelo: 'MED' | 'MDM',
    instanceId: string,
    sequence: number,
  ): Promise<readonly EceAfectado[]>;
  deleteAll(): Promise<void>;
}

/** ¿El stream es de un ECE? Devuelve el eceId o null. */
export function parseEceStream(streamId: string): string | null {
  return streamId.startsWith('ece:') ? streamId.slice('ece:'.length) : null;
}

/** Aplica un evento del ECE a su proyección, idempotente por secuencia. */
export async function aplicarEventoAProyeccionEce(
  store: EceProjectionStore,
  event: RecordedEvent,
): Promise<'applied' | 'skipped' | 'ignored'> {
  const eceId = parseEceStream(event.streamId);
  if (!eceId) return 'ignored';
  const snap = await store.get(event.organizationId, eceId);
  const version = snap?.version ?? 0;
  if (event.sequence <= version) return 'skipped';
  if (event.sequence !== version + 1) {
    throw new Error(`Hueco de secuencia en proyección ECE ${eceId}: esperado ${version + 1}, recibido ${event.sequence}`);
  }
  const base = snap?.state ?? estadoInicialEce(eceId, event.organizationId);
  const nextState = aplicarEce(base, event);
  await store.save(event.organizationId, eceId, { version: event.sequence, state: nextState });
  return 'applied';
}

export class InMemoryEceProjectionStore implements EceProjectionStore {
  private readonly data = new Map<string, EceSnapshot>();
  private key(org: string, eceId: string): string {
    return `${org}::${eceId}`;
  }
  async get(org: string, eceId: string): Promise<EceSnapshot | null> {
    return this.data.get(this.key(org, eceId)) ?? null;
  }
  async save(org: string, eceId: string, snapshot: EceSnapshot): Promise<void> {
    this.data.set(this.key(org, eceId), snapshot);
  }
  async list(org: string): Promise<readonly EceState[]> {
    const prefix = `${org}::`;
    return [...this.data.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v.state);
  }
  async afectadosPorModelo(
    org: string,
    modelo: 'MED' | 'MDM',
    instanceId: string,
    sequence: number,
  ): Promise<readonly EceAfectado[]> {
    const salida: EceAfectado[] = [];
    for (const snap of (await this.list(org))) {
      const corte = modelo === 'MED' ? snap.medCorte : snap.mdmCorte;
      if (corte && corte.instanceId === instanceId && corte.version < sequence && snap.vigente && !snap.requiereReconstruccion) {
        salida.push({ eceId: snap.eceId, corteVersion: corte.version });
      }
    }
    return salida;
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
  }
}
