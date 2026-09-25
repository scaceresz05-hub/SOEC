/**
 * apps/api · VERIFICACIÓN DEL ANUNCIANTE · adaptador de Google Ads (SOLO LECTURA).
 *
 * Usa `GetIdentityVerification`, que es de sólo lectura por definición: devuelve en qué estado está el
 * programa de verificación de una cuenta. La API también permite INICIAR una verificación; ese verbo no se
 * implementa aquí a propósito. Empezar el trámite en nombre de alguien es el primer paso hacia declarar cosas
 * en su nombre, y esa línea no se cruza: SOEC detecta y explica, la persona declara.
 *
 * DOS CUIDADOS OPERATIVOS que vienen de la propia documentación:
 *
 *  · esta llamada tiene un límite de frecuencia MÁS ESTRICTO que el resto de la API, y Google recomienda
 *    cachear y consultar con intervalos largos. Por eso el adaptador se envuelve en una caché con vencimiento
 *    (ver la composición) y no se consulta en cada tick;
 *  · un fallo no es una respuesta: se traduce a `RETRY_LATER` y no cambia nada.
 */
import { evaluarVerificacion, type DiagnosticoVerificacion, type EstadoProgramaGoogle, type LecturaVerificacion, type PuertoVerificacionAnunciante } from './verificacion-tipos';

/** La llamada cruda al proveedor. Se inyecta para que las pruebas usen un doble y la red viva en un solo sitio. */
export type ConsultaVerificacion = (customerId: string) => Promise<RespuestaVerificacion>;

export type RespuestaVerificacion =
  | { readonly ok: true; readonly programas: readonly { readonly estado: EstadoProgramaGoogle; readonly fechaLimite?: string | null }[] }
  | {
    readonly ok: false;
    readonly motivo: string;
    /** Estado HTTP del proveedor, si llegó a haber respuesta. Nunca su cuerpo. */
    readonly httpStatus?: number | null;
    /** Código de error de Google, ya sanitizado por el transporte. */
    readonly errorCode?: string | null;
  };

/**
 * Del fallo del proveedor a un diagnóstico que se pueda leer sin abrir un depurador. Es todo lo que se
 * publica y se registra del error: el cuerpo crudo de Google no sale de aquí, porque puede traer datos de la
 * cuenta que nadie necesita en un log.
 */
export function diagnosticoDeFallo(httpStatus: number | null | undefined, errorCode: string | null | undefined): DiagnosticoVerificacion {
  if (httpStatus === 401 || httpStatus === 403) return 'PERMISSION_DENIED';
  if (httpStatus === 429) return 'RATE_LIMITED';
  if (typeof errorCode === 'string' && /PERMISSION|NOT_ADS_USER|CUSTOMER_NOT_ENABLED/i.test(errorCode)) return 'PERMISSION_DENIED';
  if (typeof errorCode === 'string' && /QUOTA|RATE/i.test(errorCode)) return 'RATE_LIMITED';
  if (typeof httpStatus === 'number') return 'PROVIDER_HTTP_ERROR';
  return 'UNKNOWN_PROVIDER_RESPONSE';
}

export interface DepsVerificacionGoogle {
  readonly cuenta: (org: string) => Promise<string | null>;
  /** Ausente ⇒ este despliegue no consulta la verificación: entonces no se afirma nada (`RETRY_LATER`). */
  readonly consultar?: ConsultaVerificacion;
  readonly log?: (info: Record<string, unknown>) => void;
}

export class VerificacionGoogleAds implements PuertoVerificacionAnunciante {
  readonly nombre = 'google-ads';

  constructor(private readonly deps: DepsVerificacionGoogle) {}

  /**
   * OBSERVABILIDAD SANITIZADA. Se registra qué se preguntó, a qué cuenta, qué contestó el proveedor y cuánto
   * tardó. Nunca el token, ni la cabecera de autorización, ni el developer token, ni el cuerpo de la
   * respuesta: de lo que Google devuelve sólo salen el estado HTTP, su código de error y los estados
   * normalizados de los programas.
   */
  async inspeccionar(org: string): Promise<LecturaVerificacion> {
    const t0 = Date.now();
    const cuenta = await this.deps.cuenta(org).catch(() => null);
    if (cuenta === null) {
      this.deps.log?.({ verificacion: 'sin-cuenta-elegida', org, operacion: 'GetIdentityVerification', duracionMs: Date.now() - t0 });
      return evaluarVerificacion({ programas: null, fallo: { diagnostico: 'NO_ACCOUNT_SELECTED' } });
    }
    if (this.deps.consultar === undefined) {
      this.deps.log?.({ verificacion: 'sin-camino-al-proveedor', org, cuenta, operacion: 'GetIdentityVerification' });
      return evaluarVerificacion({ programas: null, fallo: { diagnostico: 'NOT_QUERIED' } });
    }

    let r: RespuestaVerificacion;
    try {
      r = await this.deps.consultar(cuenta);
    } catch (e) {
      const d = e as { detalle?: { httpStatus?: number; code?: string | null } };
      const httpStatus = d.detalle?.httpStatus ?? null;
      const errorCode = d.detalle?.code ?? null;
      const diagnostico = diagnosticoDeFallo(httpStatus, errorCode);
      this.deps.log?.({
        verificacion: 'consulta-fallida', org, cuenta, operacion: 'GetIdentityVerification',
        httpStatus, errorCode, diagnostico, duracionMs: Date.now() - t0,
      });
      return evaluarVerificacion({ programas: null, fallo: { diagnostico, httpProveedor: httpStatus } });
    }

    if (!r.ok) {
      const diagnostico = diagnosticoDeFallo(r.httpStatus, r.errorCode);
      this.deps.log?.({
        verificacion: 'sin-respuesta-utilizable', org, cuenta, operacion: 'GetIdentityVerification',
        motivo: r.motivo, httpStatus: r.httpStatus ?? null, errorCode: r.errorCode ?? null, diagnostico,
        duracionMs: Date.now() - t0,
      });
      return evaluarVerificacion({ programas: null, fallo: { diagnostico, httpProveedor: r.httpStatus ?? null } });
    }

    const lectura = evaluarVerificacion({ programas: r.programas });
    this.deps.log?.({
      verificacion: 'consultada', org, cuenta, operacion: 'GetIdentityVerification', httpStatus: 200,
      programas: r.programas.length, estados: r.programas.map((p) => p.estado),
      diagnostico: lectura.diagnostico, estadoNormalizado: lectura.estado, duracionMs: Date.now() - t0,
    });
    return lectura;
  }
}

/**
 * CACHÉ CON VENCIMIENTO. Google pide explícitamente no golpear esta llamada: el scheduler pasa cada cinco
 * minutos por cada empresa, y sin esto la agotaríamos nosotros solos. Una verificación de identidad no cambia
 * en minutos; media hora de desfase no le cuesta nada a nadie.
 */
export function conCache(puerto: PuertoVerificacionAnunciante, ttlMs = 30 * 60 * 1000, ahora: () => number = Date.now): PuertoVerificacionAnunciante {
  const memoria = new Map<string, { readonly valor: LecturaVerificacion; readonly vence: number }>();
  return {
    nombre: puerto.nombre,
    inspeccionar: async (org: string): Promise<LecturaVerificacion> => {
      const guardado = memoria.get(org);
      if (guardado !== undefined && guardado.vence > ahora()) return guardado.valor;
      const valor = await puerto.inspeccionar(org);
      // Lo que no se pudo averiguar no se cachea: sería convertir un fallo pasajero en media hora de silencio.
      if (valor.estado !== 'RETRY_LATER') memoria.set(org, { valor, vence: ahora() + ttlMs });
      return valor;
    },
  };
}
