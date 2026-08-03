/**
 * @soec/adaptadores · puerto · ADAPTADOR EXTERNO (M4-C, endurecido en M4-C-A-H, Art. 2/6/12).
 *
 * SEPARACIÓN DE AUTORIDAD (C-1): el adaptador NO es autoridad sobre identidad, tenant, modo, naturaleza ni
 * instante. Sólo aporta SALIDA FUNCIONAL no autoritativa (`SalidaAdaptador`). El `ResultadoAdaptador`
 * AUTORITATIVO lo construye SIEMPRE el sandbox a partir de datos confiables de entrada (RequestContext,
 * CapacidadState, SolicitudAdaptador, estado de frontera, adaptador registrado, instante inyectado).
 *
 * El instante lo inyecta el sandbox; la cancelación se propaga por `AbortSignal`. El valor de un secreto
 * jamás aparece aquí: el adaptador lo resolvería por dentro vía `SecretStore` (M4-B), sólo dentro de
 * `usar(fn)`, nunca lo devuelve ni lo registra.
 */
import type { RequestContext } from '@soec/contracts';
import type { ErrorNormalizado } from '../domain/errores-normalizados';
import type { ModoAdaptador } from '../domain/estado-adaptador';

export interface PeticionAdaptador {
  readonly operacion: string;
  readonly parametros: Readonly<Record<string, string>>;
  /** Plazo declarado en ms (metadato); el timer real es la capa opt-in `carreraConTimeout`. */
  readonly timeoutMs?: number;
}

/** Solicitud confiable: identidad de la solicitud y de la capacidad, más la petición funcional. */
export interface SolicitudAdaptador {
  readonly solicitudId: string;
  readonly capacidadId: string;
  readonly peticion: PeticionAdaptador;
}

export type EstadoResultado = 'OK' | 'ERROR';
export type EstadoSalud = 'SALUDABLE' | 'DEGRADADO' | 'NO_DISPONIBLE';
export type Naturaleza = 'SIMULADA' | 'REAL';

/** Uso técnico permitido que el adaptador PUEDE reportar (no autoritativo, sin costo comercial). */
export interface UsoAdaptador {
  readonly unidades: number;
}

/**
 * Lo ÚNICO que el adaptador puede aportar: salida funcional + estado + error normalizado + uso técnico.
 * NO lleva modo, adaptador, versión, instante, tenant ni solicitud: esos los fija el sandbox.
 */
export interface SalidaAdaptador {
  readonly estado: EstadoResultado;
  readonly salida: Readonly<Record<string, string>> | null;
  readonly error: ErrorNormalizado | null;
  readonly uso?: UsoAdaptador;
}

/** Reporte de salud del adaptador (sin instante; lo estampa el sandbox). */
export interface SaludReporte {
  readonly estado: EstadoSalud;
  readonly detalle: string;
}

/** Resultado AUTORITATIVO construido por el sandbox (nunca por el adaptador). */
export interface ResultadoAdaptador {
  readonly estado: EstadoResultado;
  readonly salida: Readonly<Record<string, string>> | null;
  readonly error: ErrorNormalizado | null;
  readonly organizationId: string;
  readonly requestId: string;
  readonly solicitudId: string;
  readonly capacidadId: string;
  readonly adaptador: string;
  readonly version: string;
  readonly modoSolicitado: ModoAdaptador;
  readonly modoEjecutado: ModoAdaptador;
  readonly naturaleza: Naturaleza;
  readonly observadoEn: string;
}

/**
 * Puerto reemplazable. El proveedor por defecto es fake/grabado (determinista). Un adaptador real sólo
 * puede existir DESACTIVADO/SIMULADO/SIN_CREDENCIAL/NO_CONSUMIBLE y avanzar por actos humanos auditados.
 * Recibe la SolicitudAdaptador confiable (para scoping por tenant/capacidad) pero NO decide su identidad.
 */
export interface AdaptadorExterno {
  readonly nombre: string;
  readonly capacidad: string;
  readonly version: string;
  /**
   * Declaración HONESTA de si el adaptador soporta ejecución REAL (Art. 9). Es un GATE obligatorio en la
   * composición: si está ausente se asume `false` (fail-closed). El adaptador declara su capacidad; jamás
   * la autoriza (la autorización vive en el RegistroAdaptador + gates canónicos).
   */
  soportaReal?(): boolean;
  salud(ctx: RequestContext, signal?: AbortSignal): Promise<SaludReporte>;
  ejecutar(ctx: RequestContext, solicitud: SolicitudAdaptador, signal?: AbortSignal): Promise<SalidaAdaptador>;
}
