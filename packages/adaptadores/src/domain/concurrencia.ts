/**
 * @soec/adaptadores · dominio · LÍMITE DE CONCURRENCIA (M4-C-B). En memoria, NO distribuido (deuda de
 * M4-C-C). Cuenta ejecuciones en curso por organización, adaptador y capacidad, con AISLAMIENTO por
 * organización. La liberación está GARANTIZADA (usar `ejecutarConLimite`, que libera ante éxito/error/
 * cancelación/timeout). No usa reloj ni aleatoriedad.
 */
import type { LimiteConcurrencia } from './operativo-tipos';

export class LimitadorConcurrencia {
  readonly #enCurso = new Map<string, number>();

  private inc(k: string): void {
    this.#enCurso.set(k, (this.#enCurso.get(k) ?? 0) + 1);
  }
  private dec(k: string): void {
    const n = (this.#enCurso.get(k) ?? 0) - 1;
    if (n <= 0) this.#enCurso.delete(k);
    else this.#enCurso.set(k, n);
  }
  private cuenta(k: string): number {
    return this.#enCurso.get(k) ?? 0;
  }

  /** Intenta adquirir un permiso. Devuelve una función de liberación, o null si se excede algún límite. */
  adquirir(org: string, adaptadorId: string, capacidadId: string, limite: LimiteConcurrencia): (() => void) | null {
    const kOrg = `o:${org}`;
    const kAd = `a:${org}:${adaptadorId}`;
    const kCap = `c:${org}:${capacidadId}`;
    if (this.cuenta(kOrg) >= limite.maxConcurrentesPorOrganizacion) return null;
    if (this.cuenta(kAd) >= limite.maxConcurrentesPorAdaptador) return null;
    if (this.cuenta(kCap) >= limite.maxConcurrentesPorCapacidad) return null;
    this.inc(kOrg);
    this.inc(kAd);
    this.inc(kCap);
    let liberado = false;
    return () => {
      if (liberado) return; // idempotente
      liberado = true;
      this.dec(kOrg);
      this.dec(kAd);
      this.dec(kCap);
    };
  }

  /** Cuenta actual en curso para una clave (diagnóstico/test). */
  enCursoOrg(org: string): number {
    return this.cuenta(`o:${org}`);
  }

  /**
   * Ejecuta `fn` bajo el límite, LIBERANDO SIEMPRE (éxito/error/cancelación). Devuelve `null` de permiso si
   * se excede el límite (el llamador debe normalizar a `LIMITE`).
   */
  async ejecutarConLimite<T>(org: string, adaptadorId: string, capacidadId: string, limite: LimiteConcurrencia, fn: () => Promise<T>): Promise<{ ejecutado: true; valor: T } | { ejecutado: false }> {
    const liberar = this.adquirir(org, adaptadorId, capacidadId, limite);
    if (!liberar) return { ejecutado: false };
    try {
      return { ejecutado: true, valor: await fn() };
    } finally {
      liberar();
    }
  }
}
