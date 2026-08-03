/**
 * @soec/adaptadores · aplicación · PROGRAMADOR DE ESPERA (M4-C-C, F-CB-3). Abstracción NEUTRAL del backoff
 * temporal entre reintentos. El núcleo NO usa `setTimeout`: usa una implementación inyectable. Las permitidas
 * en M4-C-C son deterministas (inmediata/controlada/grabada); el timer real vive en un archivo-frontera
 * opt-in aparte. La espera respeta la cancelación por `AbortSignal`.
 */
export interface ProgramadorEspera {
  esperar(ms: number, signal?: AbortSignal): Promise<void>;
}

/** No espera (determinista): resuelve de inmediato. Default del orquestador. */
export class ProgramadorEsperaInmediato implements ProgramadorEspera {
  async esperar(): Promise<void> {
    /* sin espera */
  }
}

/** Registra las esperas solicitadas y no bloquea (determinista, para aserciones de backoff). */
export class ProgramadorEsperaGrabado implements ProgramadorEspera {
  readonly esperas: number[] = [];
  async esperar(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    this.esperas.push(ms);
  }
}

/** Espera hasta que el test la libere manualmente (`avanzar`). Útil para probar cancelación durante backoff. */
export class ProgramadorEsperaControlado implements ProgramadorEspera {
  #pendientes: Array<() => void> = [];
  esperar(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise<void>((resolver) => {
      const cerrar = (): void => resolver();
      signal?.addEventListener('abort', cerrar, { once: true });
      this.#pendientes.push(cerrar);
    });
  }
  avanzar(): void {
    const p = this.#pendientes;
    this.#pendientes = [];
    for (const resolver of p) resolver();
  }
}

/** Suma milisegundos a un instante ISO de forma determinista (sin reloj del sistema). */
export function isoSumarMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}
