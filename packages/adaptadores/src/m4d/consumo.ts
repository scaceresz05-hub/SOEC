/**
 * @soec/adaptadores · M4-D (neutral) · LEDGER DE CONSUMO (Eje 4). Registra el consumo (unidades lógicas)
 * por organización + capacidad dentro de una ventana temporal, para que el presupuesto pueda evaluarse
 * ANTES de la llamada. En memoria, NO distribuido (deuda posterior). Multi-tenant (aislado por org).
 * Determinista: los instantes se inyectan (ISO) y se comparan con `Date.parse` (función pura). Sin red/SDK.
 * Las UNIDADES son magnitudes lógicas, nunca el precio comercial concreto (que no pertenece al dominio).
 */
export class RegistroConsumo {
  readonly #eventos = new Map<string, Array<{ readonly en: string; readonly unidades: number }>>();

  private clave(org: string, capacidadId: string): string {
    return `${org}::${capacidadId}`;
  }

  /** Registra un consumo ya ocurrido (p. ej. tras una ejecución REAL). `en` es el instante inyectado (ISO). */
  registrar(org: string, capacidadId: string, unidades: number, en: string): void {
    if (!(unidades >= 0) || !Number.isFinite(unidades)) return; // ignora magnitudes inválidas (fail-safe)
    const k = this.clave(org, capacidadId);
    const lista = this.#eventos.get(k) ?? [];
    lista.push({ en, unidades });
    this.#eventos.set(k, lista);
  }

  /** Suma de unidades consumidas en la ventana `[ahora - ventanaMs, ahora]` para org+capacidad. */
  consumidoEnVentana(org: string, capacidadId: string, ahora: string, ventanaMs: number): number {
    const lista = this.#eventos.get(this.clave(org, capacidadId));
    if (!lista) return 0;
    const t = Date.parse(ahora);
    let suma = 0;
    for (const ev of lista) {
      const dt = t - Date.parse(ev.en);
      if (dt >= 0 && dt <= ventanaMs) suma += ev.unidades;
    }
    return suma;
  }
}
