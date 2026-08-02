/**
 * @soec/adaptadores · adaptador GRABADO (reproduce evidencia — M4-C-A).
 *
 * Reproduce respuestas GRABADAS (evidencia reproducible, Art. 6) indexadas por la clave determinista de la
 * petición. Permite smoke tests estables y reproducibles sin proveedor real. Si la clave no está grabada,
 * devuelve un fallo normalizado `NO_DISPONIBLE`. NO toca red, entorno, reloj ni SDKs. Respeta la cancelación.
 */
import type { RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, EstadoSalud, PeticionAdaptador, ResultadoAdaptador, SaludAdaptador } from '../port/adaptador-externo';
import { claveEvidencia } from '../domain/evidencia';
import { errorNormalizado } from '../domain/errores-normalizados';

/** Una grabación: la salida estructurada esperada para una clave de petición. */
export type Grabaciones = Readonly<Record<string, Readonly<Record<string, string>>>>;

export class AdaptadorGrabado implements AdaptadorExterno {
  readonly nombre = 'grabado';
  readonly capacidad: string;
  readonly version: string;
  readonly #grabaciones: Map<string, Readonly<Record<string, string>>>;
  readonly #salud: EstadoSalud;

  constructor(grabaciones: Grabaciones, opciones: { capacidad?: string; version?: string; salud?: EstadoSalud } = {}) {
    this.capacidad = opciones.capacidad ?? 'capacidad-grabada';
    this.version = opciones.version ?? '0.0.0';
    this.#grabaciones = new Map(Object.entries(grabaciones));
    this.#salud = opciones.salud ?? 'SALUDABLE';
  }

  async salud(_ctx: RequestContext, observadoEn: string): Promise<SaludAdaptador> {
    return { estado: this.#salud, detalle: 'grabado', observadoEn };
  }

  async ejecutar(_ctx: RequestContext, peticion: PeticionAdaptador, observadoEn: string, signal?: AbortSignal): Promise<ResultadoAdaptador> {
    const base = { modo: 'SIMULADO' as const, adaptador: this.nombre, version: this.version, observadoEn };
    if (signal?.aborted) {
      const err = signal.reason === 'timeout' ? errorNormalizado('TIMEOUT', 'se agotó el plazo de ejecución') : errorNormalizado('CANCELADO', 'ejecución cancelada');
      return { estado: 'ERROR', salida: null, error: err, ...base };
    }
    const salida = this.#grabaciones.get(claveEvidencia(peticion));
    if (!salida) return { estado: 'ERROR', salida: null, error: errorNormalizado('NO_DISPONIBLE', 'no hay grabación para la petición'), ...base };
    return { estado: 'OK', salida, error: null, ...base };
  }
}
