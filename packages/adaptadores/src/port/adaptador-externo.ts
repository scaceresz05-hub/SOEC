/**
 * @soec/adaptadores · puerto · ADAPTADOR EXTERNO (M4-C, Art. 2/6/12 de la Directiva PCE).
 *
 * Puerto NEUTRAL: el adaptador conoce su CAPACIDAD LÓGICA, nunca un proveedor concreto ni un costo. El
 * instante (`observadoEn`) se inyecta (convención SOEC: sin reloj interno → determinismo, Art. 12). La
 * cancelación se propaga por `AbortSignal`. Toda respuesta es ESTRUCTURADA; un fallo esperado se devuelve
 * como `ResultadoAdaptador` con `error` normalizado, no como excepción. El valor de un secreto jamás
 * aparece aquí: el adaptador, si lo necesita, lo resuelve por dentro vía `SecretStore` (M4-B) y sólo dentro
 * de `usar(fn)` — nunca lo devuelve ni lo registra.
 */
import type { RequestContext } from '@soec/contracts';
import type { ErrorNormalizado } from '../domain/errores-normalizados';
import type { ModoAdaptador } from '../domain/estado-adaptador';

export interface PeticionAdaptador {
  /** Operación lógica del adaptador (p. ej. 'generar', 'enviar', 'consultar'). */
  readonly operacion: string;
  /** Parámetros estructurados (nunca prosa cruda confiable, nunca secretos). */
  readonly parametros: Readonly<Record<string, string>>;
  /** Plazo declarado en ms (0 o ausente = sin plazo). Metadato; el timer real es capa opt-in (M4-C-B). */
  readonly timeoutMs?: number;
}

export type EstadoResultado = 'OK' | 'ERROR';

export interface ResultadoAdaptador {
  readonly estado: EstadoResultado;
  /** Salida estructurada si OK; null si ERROR. Nunca contiene secretos. */
  readonly salida: Readonly<Record<string, string>> | null;
  readonly error: ErrorNormalizado | null;
  readonly modo: ModoAdaptador;
  readonly adaptador: string;
  readonly version: string;
  /** Instante lógico inyectado (ISO). */
  readonly observadoEn: string;
}

export type EstadoSalud = 'SALUDABLE' | 'DEGRADADO' | 'NO_DISPONIBLE';

export interface SaludAdaptador {
  readonly estado: EstadoSalud;
  readonly detalle: string;
  readonly observadoEn: string;
}

/**
 * Puerto reemplazable. El proveedor por defecto es fake/grabado (determinista). Un adaptador real sólo
 * puede existir DESACTIVADO/SIMULADO/SIN_CREDENCIAL/NO_CONSUMIBLE y avanzar por actos humanos auditados.
 */
export interface AdaptadorExterno {
  readonly nombre: string;
  /** Capacidad lógica que sirve (no un proveedor). */
  readonly capacidad: string;
  readonly version: string;
  salud(ctx: RequestContext, observadoEn: string, signal?: AbortSignal): Promise<SaludAdaptador>;
  ejecutar(ctx: RequestContext, peticion: PeticionAdaptador, observadoEn: string, signal?: AbortSignal): Promise<ResultadoAdaptador>;
}
