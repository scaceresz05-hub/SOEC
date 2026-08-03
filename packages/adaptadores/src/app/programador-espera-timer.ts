/**
 * @soec/adaptadores · aplicación · PROGRAMADOR DE ESPERA con TIMER REAL (M4-C-C, F-CB-3). Archivo-FRONTERA
 * opt-in: es el ÚNICO lugar del paquete (junto a `timeout.ts`) donde se usa un timer de wall-clock. NO se
 * usa en las pruebas deterministas principales ni por defecto en el orquestador. Respeta la cancelación:
 * un `AbortSignal` abortado resuelve de inmediato y limpia el timer. Sin red.
 */
import type { ProgramadorEspera } from './programador-espera';

export class ProgramadorEsperaTimer implements ProgramadorEspera {
  esperar(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise<void>((resolver) => {
      const t = setTimeout(resolver, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolver();
        },
        { once: true },
      );
    });
  }
}
