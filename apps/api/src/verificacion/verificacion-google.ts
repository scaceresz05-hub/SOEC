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
import { evaluarVerificacion, type EstadoProgramaGoogle, type LecturaVerificacion, type PuertoVerificacionAnunciante } from './verificacion-tipos';

/** La llamada cruda al proveedor. Se inyecta para que las pruebas usen un doble y la red viva en un solo sitio. */
export type ConsultaVerificacion = (customerId: string) => Promise<RespuestaVerificacion>;

export type RespuestaVerificacion =
  | { readonly ok: true; readonly programas: readonly { readonly estado: EstadoProgramaGoogle; readonly fechaLimite?: string | null }[] }
  | { readonly ok: false; readonly motivo: string };

export interface DepsVerificacionGoogle {
  readonly cuenta: (org: string) => Promise<string | null>;
  /** Ausente ⇒ este despliegue no consulta la verificación: entonces no se afirma nada (`RETRY_LATER`). */
  readonly consultar?: ConsultaVerificacion;
  readonly log?: (info: Record<string, unknown>) => void;
}

export class VerificacionGoogleAds implements PuertoVerificacionAnunciante {
  readonly nombre = 'google-ads';

  constructor(private readonly deps: DepsVerificacionGoogle) {}

  async inspeccionar(org: string): Promise<LecturaVerificacion> {
    const cuenta = await this.deps.cuenta(org).catch(() => null);
    if (cuenta === null || this.deps.consultar === undefined) {
      // Sin cuenta elegida, o sin camino para preguntar, no se concluye: ni se pide nada ni se da por hecho.
      return evaluarVerificacion({ programas: null });
    }
    let r: RespuestaVerificacion;
    try {
      r = await this.deps.consultar(cuenta);
    } catch (e) {
      this.deps.log?.({ verificacion: 'consulta-fallida', org, error: e instanceof Error ? e.message : 'error' });
      return evaluarVerificacion({ programas: null });
    }
    if (!r.ok) {
      this.deps.log?.({ verificacion: 'sin-respuesta-utilizable', org, motivo: r.motivo });
      return evaluarVerificacion({ programas: null });
    }
    return evaluarVerificacion({ programas: r.programas });
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
