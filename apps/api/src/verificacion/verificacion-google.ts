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
/**
 * El código que Google devuelve cuando la consulta no existe para el régimen de pago de la cuenta. Es la
 * respuesta que recibimos de una cuenta de autoservicio real, y la razón de todo este fallback.
 */
export const CODIGO_NO_OBSERVABLE = 'BILLING_NOT_ON_MONTHLY_INVOICING';

/** ¿Este fallo significa «aquí no se puede consultar, y no va a cambiar»? */
export function esNoObservable(errorCode: string | null | undefined): boolean {
  return typeof errorCode === 'string' && errorCode.includes(CODIGO_NO_OBSERVABLE);
}

export function diagnosticoDeFallo(httpStatus: number | null | undefined, errorCode: string | null | undefined): DiagnosticoVerificacion {
  // Primero lo estable: no es un permiso denegado ni un límite de cuota, es un régimen distinto.
  if (esNoObservable(errorCode)) return 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE';
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
  /**
   * ¿Ya sabemos que en esta cuenta no se puede consultar? Si sí, NO se vuelve a llamar al proveedor: es una
   * propiedad del régimen de facturación, no un fallo que se cure esperando, y esa llamada tiene cuota
   * estricta. Se vuelve a preguntar solo cuando cambia la cuenta.
   */
  readonly observabilidadConocida?: (org: string, customerId: string) => Promise<'OBSERVABLE' | 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE' | null>;
  readonly recordarNoObservable?: (org: string, customerId: string, detalle: string) => Promise<void>;
  /** ¿Confirmó una persona que completó lo que Google le pidió PARA ESTA CUENTA? */
  readonly confirmadaPorLaPersona?: (org: string, customerId: string) => Promise<boolean>;
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

    const confirmada = this.deps.confirmadaPorLaPersona === undefined
      ? false
      : await this.deps.confirmadaPorLaPersona(org, cuenta).catch(() => false);

    // ¿Ya sabíamos que aquí no se puede preguntar? Entonces no se pregunta. Una puerta cerrada no se vuelve
    // a empujar cada cinco minutos, y menos cuando el proveedor limita especialmente esa llamada.
    if (this.deps.observabilidadConocida !== undefined) {
      const conocida = await this.deps.observabilidadConocida(org, cuenta).catch(() => null);
      if (conocida === 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE') {
        return evaluarVerificacion({ programas: null, noObservableEnEstaCuenta: true, confirmadaPorLaPersona: confirmada });
      }
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
      if (diagnostico === 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE') {
        await this.deps.recordarNoObservable?.(org, cuenta, `${httpStatus ?? ''} ${errorCode ?? ''}`.trim()).catch(() => undefined);
        return evaluarVerificacion({ programas: null, noObservableEnEstaCuenta: true, confirmadaPorLaPersona: confirmada });
      }
      return evaluarVerificacion({ programas: null, fallo: { diagnostico, httpProveedor: httpStatus } });
    }

    if (!r.ok) {
      const diagnostico = diagnosticoDeFallo(r.httpStatus, r.errorCode);
      this.deps.log?.({
        verificacion: 'sin-respuesta-utilizable', org, cuenta, operacion: 'GetIdentityVerification',
        motivo: r.motivo, httpStatus: r.httpStatus ?? null, errorCode: r.errorCode ?? null, diagnostico,
        duracionMs: Date.now() - t0,
      });

      // NO OBSERVABLE: se anota para no volver a preguntarlo, y el paso pasa a depender de una persona.
      if (diagnostico === 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE') {
        await this.deps.recordarNoObservable?.(org, cuenta, `${r.httpStatus ?? ''} ${r.errorCode ?? ''}`.trim()).catch(() => undefined);
        return evaluarVerificacion({ programas: null, noObservableEnEstaCuenta: true, confirmadaPorLaPersona: confirmada });
      }
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
 * CACHÉ DE LA LLAMADA AL PROVEEDOR. Y sólo de eso.
 *
 * La versión anterior cacheaba la LECTURA COMPLETA durante media hora, y ahí estaba el defecto: esa lectura
 * mezcla lo que dice Google con lo que dice nuestra propia base —si una persona ya confirmó la verificación—.
 * Cachear nuestro propio dato no ahorra nada y cuesta caro: alguien confirmaba, el scheduler seguía viendo el
 * estado viejo durante media hora, volvía a abrir la tarea que la persona acababa de resolver, y al vencer la
 * caché la cerraba otra vez. Un bucle que le pedía dos veces lo mismo a quien ya lo había hecho.
 *
 * Ahora se cachea únicamente la respuesta del proveedor, que es lo que hay que proteger: Google limita esta
 * llamada más que el resto y pide consultarla con calma. Lo nuestro se lee siempre fresco.
 */
export function conCacheDeConsulta(consulta: ConsultaVerificacion, ttlMs = 30 * 60 * 1000, ahora: () => number = Date.now): ConsultaVerificacion {
  const memoria = new Map<string, { readonly valor: RespuestaVerificacion; readonly vence: number }>();
  return async (customerId: string): Promise<RespuestaVerificacion> => {
    const guardado = memoria.get(customerId);
    if (guardado !== undefined && guardado.vence > ahora()) return guardado.valor;
    const valor = await consulta(customerId);
    // Un fallo pasajero no se cachea: sería convertir un 429 de un segundo en media hora de ceguera.
    const pasajero = !valor.ok && !esNoObservable(valor.errorCode);
    if (!pasajero) memoria.set(customerId, { valor, vence: ahora() + ttlMs });
    return valor;
  };
}
