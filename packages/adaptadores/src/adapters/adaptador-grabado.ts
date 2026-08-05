/**
 * @soec/adaptadores · adaptador GRABADO (reproduce evidencia — M4-C-A / endurecido en M4-C-A-H).
 *
 * Reproduce respuestas GRABADAS (Art. 6) indexadas por una clave determinista SCOPED por organización +
 * capacidad + versión del adaptador (C-2): una grabación de la Org A no puede ser encontrada ni reutilizada
 * por la Org B. Aporta sólo salida funcional no autoritativa. Si la clave no está grabada → `NO_DISPONIBLE`.
 * NO toca red, entorno, reloj ni SDKs. Respeta la cancelación.
 */
import type { RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, EstadoSalud, SalidaAdaptador, SaludReporte, SolicitudAdaptador } from '../port/adaptador-externo';
import { claveGrabacion } from '../domain/evidencia';
import { errorAborto, errorNormalizado } from '../domain/errores-normalizados';

/** Grabaciones indexadas por la clave scoped `claveGrabacion(org, capacidadId, version, peticion)`. */
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

  async salud(): Promise<SaludReporte> {
    return { estado: this.#salud, detalle: 'grabado' };
  }

  async ejecutar(ctx: RequestContext, solicitud: SolicitudAdaptador, signal?: AbortSignal): Promise<SalidaAdaptador> {
    if (signal?.aborted) return { estado: 'ERROR', salida: null, error: errorAborto(signal.reason) };
    const clave = claveGrabacion(String(ctx.organizationId), solicitud.capacidadId, this.version, solicitud.peticion);
    const salida = this.#grabaciones.get(clave);
    if (!salida) return { estado: 'ERROR', salida: null, error: errorNormalizado('NO_DISPONIBLE', 'no hay grabación para la solicitud (tenant/capacidad/versión)') };
    return { estado: 'OK', salida, error: null };
  }
}
