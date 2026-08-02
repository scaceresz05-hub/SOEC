/**
 * @soec/adaptadores · dominio · EVIDENCIA REPRODUCIBLE Y AUTORITATIVA (M4-C-A-H, Art. 6).
 *
 * La evidencia la construye SIEMPRE el sandbox (nunca el adaptador) a partir de datos confiables. Permite
 * responder: qué organización, qué capacidad/versión, qué solicitud/request, qué adaptador lógico/versión,
 * qué modo (solicitado y ejecutado), qué naturaleza, qué política/directiva de degradación, qué instante,
 * qué resultado y qué error normalizado. NO contiene secretos, stacks, mensajes originales, payloads
 * sensibles ni proveedor concreto. La clave de grabación está scoped por tenant + capacidad + versión.
 */
import type { EstadoSalud, Naturaleza, PeticionAdaptador, ResultadoAdaptador } from '../port/adaptador-externo';
import type { ModoAdaptador } from './estado-adaptador';
import type { ErrorNormalizado } from './errores-normalizados';
import type { DirectivaDegradacion } from './degradacion';

/** Versión del esquema de evidencia (trazabilidad/compatibilidad, Art. 7/14). */
export const EVIDENCIA_VERSION = 1;

export interface EvidenciaEjecucion {
  readonly evidenciaVersion: number;
  readonly organizationId: string;
  readonly requestId: string;
  readonly solicitudId: string;
  readonly capacidadId: string;
  readonly capacidadVersion: number;
  readonly adaptadorIdLogico: string;
  readonly adaptadorVersion: string;
  readonly modoSolicitado: ModoAdaptador;
  readonly modoEjecutado: ModoAdaptador;
  readonly naturaleza: Naturaleza;
  readonly observadoEn: string;
  readonly politicaVersion: number;
  readonly degradacion: DirectivaDegradacion | null;
  readonly salud: EstadoSalud;
  readonly resultado: ResultadoAdaptador;
  readonly error: ErrorNormalizado | null;
}

/**
 * Clave de grabación determinista, SCOPED por organización + capacidad + versión del adaptador. Así una
 * grabación de la Org A no puede ser encontrada ni reutilizada por la Org B (C-2). Parámetros ordenados.
 */
export function claveGrabacion(organizationId: string, capacidadId: string, adaptadorVersion: string, peticion: PeticionAdaptador): string {
  const pares = Object.keys(peticion.parametros)
    .sort()
    .map((k) => `${k}=${peticion.parametros[k] ?? ''}`)
    .join('&');
  return `${organizationId}::${capacidadId}::${adaptadorVersion}::${peticion.operacion}(${pares})`;
}
