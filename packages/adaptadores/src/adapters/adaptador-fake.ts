/**
 * @soec/adaptadores · adaptador FAKE (determinista, sólo dev/test — M4-C-A).
 *
 * Responde de forma determinista según un mapa `operacion → salida`, más una salud configurable y, opcional,
 * un fallo normalizado forzado para probar la frontera. NO toca red, entorno, reloj ni SDKs. Respeta la
 * cancelación por `AbortSignal`. Es el proveedor por defecto de la frontera mientras no exista uno real.
 */
import type { RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, EstadoSalud, PeticionAdaptador, ResultadoAdaptador, SaludAdaptador } from '../port/adaptador-externo';
import { type ErrorNormalizado, errorNormalizado } from '../domain/errores-normalizados';

export interface ConfigFake {
  readonly capacidad?: string;
  readonly version?: string;
  /** Mapa operación → salida estructurada determinista. */
  readonly respuestas?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly salud?: EstadoSalud;
  /** Si se define, toda ejecución devuelve este error normalizado (para probar la frontera). */
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

  private abortado(signal?: AbortSignal): boolean {
    return signal?.aborted === true;
  }

  async salud(_ctx: RequestContext, observadoEn: string): Promise<SaludAdaptador> {
    return { estado: this.#salud, detalle: 'fake', observadoEn };
  }

  async ejecutar(_ctx: RequestContext, peticion: PeticionAdaptador, observadoEn: string, signal?: AbortSignal): Promise<ResultadoAdaptador> {
    const base = { modo: 'SIMULADO' as const, adaptador: this.nombre, version: this.version, observadoEn };
    if (this.abortado(signal)) {
      const razon = signal?.reason;
      const err = razon === 'timeout' ? errorNormalizado('TIMEOUT', 'se agotó el plazo de ejecución') : errorNormalizado('CANCELADO', 'ejecución cancelada');
      return { estado: 'ERROR', salida: null, error: err, ...base };
    }
    if (this.#errorForzado) return { estado: 'ERROR', salida: null, error: this.#errorForzado, ...base };
    const salida = this.#respuestas.get(peticion.operacion);
    if (!salida) return { estado: 'ERROR', salida: null, error: errorNormalizado('INVALIDO', `operación no soportada: ${peticion.operacion}`), ...base };
    return { estado: 'OK', salida, error: null, ...base };
  }
}
