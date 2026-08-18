/**
 * apps/api · V2 PRE-REAL · RECONCILIATION del write path real. Garantiza que un retry NUNCA duplique una
 * campaña/ad. Two-phase por (organizationId, idempotencyKey):
 *   1) reservar(PENDING) atómico — si ya existe, devuelve el estado previo (COMPLETED ⇒ reusar externalRef;
 *      PENDING ⇒ otra ejecución en curso o resultado desconocido ⇒ AMBIGUO, NO recrear).
 *   2) tras respuesta del proveedor: completar(externalRef) o marcar fallido/ambiguo.
 * `externalRef` se persiste sólo de forma reconciliable (cuando el proveedor confirmó un id).
 */

export type EstadoReconciliacion = 'PENDING' | 'COMPLETED' | 'AMBIGUOUS' | 'FAILED';

export interface AsientoReconciliacion {
  readonly organizationId: string;
  readonly idempotencyKey: string;
  readonly operacion: string;
  readonly estado: EstadoReconciliacion;
  readonly externalRef: string | null;
}

export interface ReconciliacionRepo {
  /** Reserva atómica. Devuelve {creado:true} si insertó PENDING; si ya existía, {creado:false, previo}. */
  reservar(organizationId: string, idempotencyKey: string, operacion: string): Promise<{ creado: boolean; previo: AsientoReconciliacion | null }>;
  completar(organizationId: string, idempotencyKey: string, externalRef: string): Promise<void>;
  marcar(organizationId: string, idempotencyKey: string, estado: EstadoReconciliacion): Promise<void>;
  obtener(organizationId: string, idempotencyKey: string): Promise<AsientoReconciliacion | null>;
}

export class InMemoryReconciliacionRepo implements ReconciliacionRepo {
  private readonly m = new Map<string, AsientoReconciliacion>();
  private k(org: string, key: string): string {
    return `${org}:${key}`;
  }
  async reservar(org: string, key: string, operacion: string): Promise<{ creado: boolean; previo: AsientoReconciliacion | null }> {
    const k = this.k(org, key);
    const previo = this.m.get(k) ?? null;
    if (previo) return { creado: false, previo };
    this.m.set(k, { organizationId: org, idempotencyKey: key, operacion, estado: 'PENDING', externalRef: null });
    return { creado: true, previo: null };
  }
  async completar(org: string, key: string, externalRef: string): Promise<void> {
    const k = this.k(org, key);
    const prev = this.m.get(k);
    if (prev) this.m.set(k, { ...prev, estado: 'COMPLETED', externalRef });
  }
  async marcar(org: string, key: string, estado: EstadoReconciliacion): Promise<void> {
    const k = this.k(org, key);
    const prev = this.m.get(k);
    if (prev) this.m.set(k, { ...prev, estado });
  }
  async obtener(org: string, key: string): Promise<AsientoReconciliacion | null> {
    return this.m.get(this.k(org, key)) ?? null;
  }
}
