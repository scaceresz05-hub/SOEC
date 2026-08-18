/**
 * apps/api · SAFE ACTION PLANE (V2-A) · ACTION LEDGER append-only.
 * Registro inmutable y AUDITABLE de toda decisión de acción (simulada/ejecutada/rechazada). Idempotente por
 * (organizationId, idempotencyKey): reintentos no duplican ni doble-cobran. Tenant-scoped.
 */

import type { Veredicto } from './budget-guard';

export type EstadoAsiento = 'SIMULADA' | 'EJECUTADA' | 'RECHAZADA';

export interface AsientoAccion {
  readonly id: string;
  readonly organizationId: string;
  readonly mandatoId: string;
  readonly idempotencyKey: string;
  readonly actionType: string;
  readonly assetId: string;
  readonly costMinor: number;
  readonly currency: string;
  readonly estado: EstadoAsiento;
  readonly modo: 'DRY_RUN' | 'REAL';
  readonly bloqueos: readonly string[];
  readonly propuestaPor: string;
  readonly decidedAt: string;
  readonly effectRef: string | null; // referencia externa (id de campaña real) cuando EJECUTADA real
}

export interface ActionLedgerRepo {
  /** Inserta si es nuevo; devuelve true si insertó, false si ya existía (idempotencia atómica). */
  registrarSiNuevo(a: AsientoAccion): Promise<boolean>;
  obtener(organizationId: string, idempotencyKey: string): Promise<AsientoAccion | null>;
  listar(organizationId: string, mandatoId: string): Promise<readonly AsientoAccion[]>;
}

export class InMemoryActionLedgerRepo implements ActionLedgerRepo {
  private readonly m = new Map<string, AsientoAccion>();
  private k(org: string, key: string): string {
    return `${org}:${key}`;
  }
  async registrarSiNuevo(a: AsientoAccion): Promise<boolean> {
    const k = this.k(a.organizationId, a.idempotencyKey);
    if (this.m.has(k)) return false;
    this.m.set(k, a);
    return true;
  }
  async obtener(org: string, key: string): Promise<AsientoAccion | null> {
    return this.m.get(this.k(org, key)) ?? null;
  }
  async listar(org: string, mandatoId: string): Promise<readonly AsientoAccion[]> {
    return [...this.m.values()].filter((x) => x.organizationId === org && x.mandatoId === mandatoId).sort((x, y) => Date.parse(x.decidedAt) - Date.parse(y.decidedAt));
  }
}

/** Construye un asiento a partir del veredicto (para auditoría completa). */
export function asientoDesdeVeredicto(id: string, accion: { organizationId: string; mandatoId: string; idempotencyKey: string; actionType: string; assetId: string; costMinor: number; currency: string; propuestaPor: string }, v: Veredicto, ahora: string, effectRef: string | null = null): AsientoAccion {
  const estado: EstadoAsiento = !v.permitido ? 'RECHAZADA' : v.modo === 'REAL' ? 'EJECUTADA' : 'SIMULADA';
  return {
    id,
    organizationId: accion.organizationId,
    mandatoId: accion.mandatoId,
    idempotencyKey: accion.idempotencyKey,
    actionType: accion.actionType,
    assetId: accion.assetId,
    costMinor: accion.costMinor,
    currency: accion.currency,
    estado,
    modo: v.modo,
    bloqueos: v.bloqueos,
    propuestaPor: accion.propuestaPor,
    decidedAt: ahora,
    effectRef,
  };
}
