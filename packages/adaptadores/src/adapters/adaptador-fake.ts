/**
 * @soec/adaptadores · adaptador FAKE (determinista, sólo dev/test — M4-C-A / endurecido en M4-C-A-H).
 *
 * Aporta SÓLO salida funcional no autoritativa (`SalidaAdaptador`): no decide modo, naturaleza, tenant,
 * identidad ni instante — eso lo fija el sandbox. Responde de forma determinista según un mapa
 * `operacion → salida`, con salud configurable y, opcional, un fallo normalizado forzado. NO toca red,
 * entorno, reloj ni SDKs. Respeta la cancelación por `AbortSignal`.
 */
import type { RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, EstadoSalud, SalidaAdaptador, SaludReporte, SolicitudAdaptador } from '../port/adaptador-externo';
import { type ErrorNormalizado, errorAborto, errorNormalizado } from '../domain/errores-normalizados';

export interface ConfigFake {
  readonly capacidad?: string;
  readonly version?: string;
  readonly respuestas?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly salud?: EstadoSalud;
  readonly errorForzado?: ErrorNormalizado;
}

export class AdaptadorFake implements AdaptadorExterno {
  readonly nombre = 'fake';
  readonly capacidad: string;
  readonly version: string;
  readonly #respuestas: Map<string, Readonly<Record<string, string>>>;
  readonly #salud: EstadoSalud;
  readonly #errorForzado: ErrorNormalizado | null;

  constructor(config: ConfigFake = {}) {
    this.capacidad = config.capacidad ?? 'capacidad-fake';
    this.version = config.version ?? '0.0.0';
    this.#respuestas = new Map(Object.entries(config.respuestas ?? {}));
    this.#salud = config.salud ?? 'SALUDABLE';
    this.#errorForzado = config.errorForzado ?? null;
  }

  async salud(): Promise<SaludReporte> {
    return { estado: this.#salud, detalle: 'fake' };
  }

  async ejecutar(_ctx: RequestContext, solicitud: SolicitudAdaptador, signal?: AbortSignal): Promise<SalidaAdaptador> {
    if (signal?.aborted) return { estado: 'ERROR', salida: null, error: errorAborto(signal.reason) };
    if (this.#errorForzado) return { estado: 'ERROR', salida: null, error: this.#errorForzado };
    const salida = this.#respuestas.get(solicitud.peticion.operacion);
    if (!salida) return { estado: 'ERROR', salida: null, error: errorNormalizado('INVALIDO', `operación no soportada: ${solicitud.peticion.operacion}`) };
    return { estado: 'OK', salida, error: null };
  }
}
