/**
 * Limitador de intentos en memoria (sin dependencias externas). Protege endpoints sensibles
 * (login, solicitud de restablecimiento) de fuerza bruta: N intentos por ventana → bloqueo temporal.
 *
 * Alcance declarado (honestidad de capacidades): el estado vive en el proceso. Es efectivo contra
 * fuerza bruta trivial en un despliegue de una instancia; un despliegue multi-instancia requeriría
 * un backend compartido (Redis) — integración futura. No sustituye WAF ni protección de red.
 */
export interface ResultadoLimite {
  readonly permitido: boolean;
  /** Segundos sugeridos de espera cuando `permitido` es false. */
  readonly retryAfterSeg: number;
}

interface Entrada {
  fails: number;
  ventanaDesde: number;
  bloqueadoHasta: number;
}

export interface RateLimiterOpts {
  /** Intentos fallidos permitidos dentro de la ventana antes de bloquear. */
  readonly maxIntentos: number;
  /** Ventana de conteo, en milisegundos. */
  readonly ventanaMs: number;
  /** Duración del bloqueo temporal, en milisegundos. */
  readonly bloqueoMs: number;
  /** Reloj inyectable (tests deterministas). */
  readonly now?: () => number;
}

export class RateLimiter {
  private readonly entradas = new Map<string, Entrada>();
  private readonly now: () => number;

  constructor(private readonly opts: RateLimiterOpts) {
    this.now = opts.now ?? Date.now;
  }

  /** Consulta si la clave puede intentar ahora (no consume intento). */
  revisar(clave: string): ResultadoLimite {
    const t = this.now();
    const e = this.entradas.get(clave);
    if (e && e.bloqueadoHasta > t) {
      return { permitido: false, retryAfterSeg: Math.ceil((e.bloqueadoHasta - t) / 1000) };
    }
    return { permitido: true, retryAfterSeg: 0 };
  }

  /** Registra un intento fallido; devuelve el estado resultante (puede quedar bloqueada). */
  registrarFallo(clave: string): ResultadoLimite {
    const t = this.now();
    this.podar(t);
    let e = this.entradas.get(clave);
    if (!e || t - e.ventanaDesde > this.opts.ventanaMs) {
      e = { fails: 0, ventanaDesde: t, bloqueadoHasta: 0 };
    }
    e.fails += 1;
    if (e.fails >= this.opts.maxIntentos) {
      e.bloqueadoHasta = t + this.opts.bloqueoMs;
    }
    this.entradas.set(clave, e);
    if (e.bloqueadoHasta > t) {
      return { permitido: false, retryAfterSeg: Math.ceil((e.bloqueadoHasta - t) / 1000) };
    }
    return { permitido: true, retryAfterSeg: 0 };
  }

  /** Éxito: limpia el contador de la clave. */
  registrarExito(clave: string): void {
    this.entradas.delete(clave);
  }

  /** Poda oportunista de entradas expiradas para acotar la memoria. */
  private podar(t: number): void {
    if (this.entradas.size < 10_000) return;
    for (const [k, e] of this.entradas) {
      if (e.bloqueadoHasta <= t && t - e.ventanaDesde > this.opts.ventanaMs) this.entradas.delete(k);
    }
  }
}
