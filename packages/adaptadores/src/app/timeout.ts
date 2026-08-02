/**
 * @soec/adaptadores · aplicación · TIMEOUT WALL-CLOCK OPT-IN (M4-C-A-H, C-7).
 *
 * Capa de infraestructura EXPLÍCITA y OPT-IN, separada del núcleo determinista del sandbox. Deshabilitada
 * por defecto. Cuando se habilita, corre una carrera entre (a) la ejecución del adaptador, (b) la
 * cancelación por `AbortSignal` y (c) el vencimiento del plazo. Precedencia DETERMINISTA y documentada:
 *
 *   1. señal ya abortada           → CANCELADO (sin ejecutar)
 *   2. abort durante la espera      → CANCELADO
 *   3. timeout antes de la respuesta→ TIMEOUT
 *   4. respuesta antes              → OK (se valida aguas arriba)
 *
 * Una resolución TARDÍA (posterior a timeout/cancelación) se DESCARTA (guarda `resuelto`). El timer se
 * limpia SIEMPRE. Nunca hay retry automático. El `programador` es inyectable para pruebas deterministas;
 * en producción usa `setTimeout` (único lugar sancionado para un timer en el paquete).
 */
export interface PoliticaTimeout {
  readonly habilitado: boolean;
  readonly timeoutMs: number;
}

/** Programa un callback tras `ms`; devuelve una función para cancelarlo. Inyectable para tests. */
export type Programador = (ms: number, cb: () => void) => () => void;

export const programadorReal: Programador = (ms, cb) => {
  const t = setTimeout(cb, ms);
  return () => clearTimeout(t);
};

export type SalidaCarrera<T> =
  | { readonly tipo: 'OK'; readonly valor: T }
  | { readonly tipo: 'TIMEOUT' }
  | { readonly tipo: 'CANCELADO' }
  | { readonly tipo: 'ERROR'; readonly error: unknown };

export function carreraConTimeout<T>(
  ejecutar: (signal?: AbortSignal) => Promise<T>,
  politica: PoliticaTimeout,
  signal?: AbortSignal,
  programador: Programador = programadorReal,
): Promise<SalidaCarrera<T>> {
  if (signal?.aborted) return Promise.resolve({ tipo: 'CANCELADO' });

  return new Promise<SalidaCarrera<T>>((resolve) => {
    let resuelto = false;
    let cancelarTimer: (() => void) | undefined;
    const onAbort = () => cerrar({ tipo: 'CANCELADO' });

    const cerrar = (r: SalidaCarrera<T>): void => {
      if (resuelto) return; // descarta resoluciones tardías
      resuelto = true;
      cancelarTimer?.();
      signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (politica.habilitado) cancelarTimer = programador(politica.timeoutMs, () => cerrar({ tipo: 'TIMEOUT' }));

    // La ejecución se lanza al final: si el programador inyectado dispara de forma síncrona (tests),
    // el timeout/cancelación gana con precedencia determinista y la respuesta tardía se descarta.
    ejecutar(signal).then(
      (valor) => cerrar({ tipo: 'OK', valor }),
      (error) => cerrar({ tipo: 'ERROR', error }),
    );
  });
}
