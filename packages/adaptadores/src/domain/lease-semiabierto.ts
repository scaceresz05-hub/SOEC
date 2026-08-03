/**
 * @soec/adaptadores · dominio · COORDINADOR SEMIABIERTO (M4-C-C, F-CB-4). Otorga un LEASE ÚNICO por
 * `organizationId + adaptadorId` para la prueba gobernada de un circuit breaker en SEMIABIERTO: un segundo
 * intento concurrente no obtiene lease. Es garantía de PROCESO ÚNICO (no distribuida). El lease expira y es
 * recuperable; la liberación es idempotente; aislado por organización. Sin reloj interno (instantes ISO
 * inyectados; comparación con `Date.parse`, función pura).
 */
export interface LeaseSemiabierto {
  readonly organizationId: string;
  readonly adaptadorId: string;
  readonly adquiridoEn: string;
  readonly expiraEn: string;
  readonly leaseId: string;
}

export type ResultadoLease = { readonly ok: true; readonly lease: LeaseSemiabierto } | { readonly ok: false; readonly motivo: string };

export class CoordinadorSemiabierto {
  readonly #leases = new Map<string, LeaseSemiabierto>();

  private clave(org: string, adaptadorId: string): string {
    return `${org}::${adaptadorId}`;
  }

  /** Intenta adquirir el lease único. Falla si hay uno vigente (no expirado) para el mismo org+adaptador. */
  intentarAdquirir(org: string, adaptadorId: string, leaseId: string, ahora: string, expiraEn: string): ResultadoLease {
    const k = this.clave(org, adaptadorId);
    const actual = this.#leases.get(k);
    if (actual && Date.parse(actual.expiraEn) > Date.parse(ahora)) return { ok: false, motivo: 'ya hay una prueba SEMIABIERTO en curso' };
    const lease: LeaseSemiabierto = { organizationId: org, adaptadorId, adquiridoEn: ahora, expiraEn, leaseId };
    this.#leases.set(k, lease);
    return { ok: true, lease };
  }

  /** Libera el lease. Idempotente: sólo libera si el leaseId coincide con el vigente. */
  liberar(lease: LeaseSemiabierto): void {
    const k = this.clave(lease.organizationId, lease.adaptadorId);
    const actual = this.#leases.get(k);
    if (actual && actual.leaseId === lease.leaseId) this.#leases.delete(k);
  }

  /** ¿Hay un lease vigente? (diagnóstico/test). */
  vigente(org: string, adaptadorId: string, ahora: string): boolean {
    const a = this.#leases.get(this.clave(org, adaptadorId));
    return a !== undefined && Date.parse(a.expiraEn) > Date.parse(ahora);
  }
}
