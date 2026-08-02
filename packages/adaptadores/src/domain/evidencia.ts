/**
 * @soec/adaptadores · dominio · EVIDENCIA REPRODUCIBLE (M4-C, Art. 6 de la Directiva PCE).
 *
 * Cada ejecución de un adaptador produce una evidencia estructurada y REPRODUCIBLE: describe qué se pidió
 * (operación + clave determinista de parámetros), qué se obtuvo (resultado normalizado) y la salud, sin
 * transportar secretos ni valores sensibles. La `clave` es determinista (parámetros ordenados) para poder
 * grabar/reproducir sin depender de aleatoriedad ni reloj.
 */
import type { EstadoSalud, PeticionAdaptador, ResultadoAdaptador } from '../port/adaptador-externo';

export interface EvidenciaEjecucion {
  readonly adaptador: string;
  readonly version: string;
  readonly capacidad: string;
  readonly operacion: string;
  readonly clave: string;
  readonly resultado: ResultadoAdaptador;
  readonly salud: EstadoSalud;
  readonly observadoEn: string;
}

/** Clave determinista de una petición: operación + parámetros ordenados. Sin aleatoriedad ni reloj. */
export function claveEvidencia(peticion: PeticionAdaptador): string {
  const pares = Object.keys(peticion.parametros)
    .sort()
    .map((k) => `${k}=${peticion.parametros[k] ?? ''}`)
    .join('&');
  return `${peticion.operacion}(${pares})`;
}
