/**
 * apps/api · VERIFICACIÓN DEL ANUNCIANTE · composición.
 *
 * Igual que la facturación: la credencial y el developer token son los que la empresa ya autorizó, y la
 * cuenta es la que eligió. Sin puerta de capacidades —preguntar si Google exige verificar la empresa es parte
 * de la incorporación, no de la medición—, y con caché, porque esta llamada está limitada más que el resto.
 */
import type { Pool } from 'pg';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import { obtenerAccessTokenDeOrg } from '../acquisition/google-ads-oauth-flow';
import type { ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';
import { conCacheDeConsulta, VerificacionGoogleAds, type RespuestaVerificacion } from './verificacion-google';
import { RepositorioConfirmacionDeVerificacion, RepositorioObservabilidadVerificacion } from './verificacion-pg';
import type { EstadoProgramaGoogle, EstadoVerificacionAnunciante, PuertoVerificacionAnunciante } from './verificacion-tipos';

export interface OpcionesVerificacionGoogle {
  readonly env: Record<string, string | undefined>;
  readonly composicionGoogleAds: ComponentesFlujoGoogleAds | null;
  readonly log?: (info: Record<string, unknown>) => void;
  /** Vencimiento de la caché. Por defecto media hora: una verificación de identidad no cambia en minutos. */
  readonly ttlMs?: number;
  /** Transporte HTTP, para poder probar ESTA composición contra un proveedor de mentira. */
  readonly fetchFn?: typeof fetch;
}

/** Cuenta elegida y su manager, tal como las escribió la Fase I.1. */
async function cuentaYManager(pool: Pool, org: string): Promise<{ cuenta: string; login: string } | null> {
  const c = await new RepositorioConexiones(pool).buscar(org, 'GOOGLE_ADS').catch(() => null);
  if (c === null || c.estado !== 'CONNECTED') return null;
  const cfg = (c.configuracion ?? {}) as { customerId?: string; loginCustomerId?: string };
  const cuenta = String(cfg.customerId ?? c.externalAccountId ?? '').replace(/\D/g, '');
  if (cuenta === '') return null;
  return { cuenta, login: String(cfg.loginCustomerId ?? cuenta).replace(/\D/g, '') || cuenta };
}

/** Lee el estado del programa tal como lo devuelve la API, tolerando las dos formas de anidar los campos. */
function programasDe(filas: Array<Record<string, unknown>>): readonly { estado: EstadoProgramaGoogle; fechaLimite?: string | null }[] {
  return filas.map((f) => {
    const progreso = (f.verificationProgress ?? {}) as Record<string, unknown>;
    const requisito = (f.identityVerificationRequirement ?? {}) as Record<string, unknown>;
    const estado = String(progreso.programStatus ?? f.programStatus ?? 'UNKNOWN') as EstadoProgramaGoogle;
    const limite = requisito.verificationCompletionDeadlineTime ?? requisito.verificationStartDeadlineTime ?? null;
    return { estado, fechaLimite: limite === null ? null : String(limite) };
  });
}

export function puertoVerificacionGoogle(pool: Pool, o: OpcionesVerificacionGoogle): PuertoVerificacionAnunciante {
  /** La consulta real. El token vive atado a la ORGANIZACIÓN, así que la llamada se construye por empresa. */
  const consultarPara = (org: string) => async (customerId: string): Promise<RespuestaVerificacion> => {
    const developerToken = o.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const datos = await cuentaYManager(pool, org);
    if (!o.composicionGoogleAds || !developerToken || datos === null) return { ok: false, motivo: 'sin acceso de API' };
    const comp = o.composicionGoogleAds;
    const cliente = new GoogleAdsMutateHttpClient({
      resolverAccessToken: () => obtenerAccessTokenDeOrg(comp, org),
      developerToken,
      loginCustomerId: datos.login,
      ...(o.fetchFn ? { fetchFn: o.fetchFn } : {}),
      ...(o.log ? { logger: (i: unknown) => o.log?.({ googleAdsVerificacion: i }) } : {}),
    });
    try {
      return { ok: true, programas: programasDe(await cliente.verificacionDeIdentidad(customerId)) };
    } catch (e) {
      // El transporte ya sanitiza: de aquí sólo salen el estado HTTP y el código de error de Google.
      const d = e as { detalle?: { httpStatus?: number; code?: string | null; status?: string | null } };
      return {
        ok: false,
        motivo: d.detalle?.status ?? (e instanceof Error ? e.name : 'error'),
        httpStatus: d.detalle?.httpStatus ?? null,
        errorCode: d.detalle?.code ?? null,
      };
    }
  };

  const observabilidad = new RepositorioObservabilidadVerificacion(pool);
  const confirmaciones = new RepositorioConfirmacionDeVerificacion(pool);
  /**
   * La caché vive AQUÍ, sobre la llamada al proveedor y compartida entre organizaciones por cuenta. Lo que
   * sale de nuestra base —la confirmación de la persona, la observabilidad ya anotada— se lee fresco en cada
   * inspección: cachearlo fue lo que hizo que el sistema volviera a pedir algo ya resuelto.
   */
  const consultarConCache = new Map<string, ReturnType<typeof conCacheDeConsulta>>();
  const consultaDe = (org: string): ReturnType<typeof conCacheDeConsulta> => {
    const guardada = consultarConCache.get(org);
    if (guardada !== undefined) return guardada;
    const nueva = conCacheDeConsulta(consultarPara(org), o.ttlMs);
    consultarConCache.set(org, nueva);
    return nueva;
  };

  const base: PuertoVerificacionAnunciante = {
    nombre: 'google-ads',
    inspeccionar: async (org: string) => new VerificacionGoogleAds({
      cuenta: async () => (await cuentaYManager(pool, org))?.cuenta ?? null,
      consultar: consultaDe(org),
      // Lo que Google ya dijo sobre ESTA cuenta se recuerda: no se le vuelve a preguntar cada tick.
      observabilidadConocida: (o2, customerId) => observabilidad.de(o2, customerId),
      recordarNoObservable: async (o2, customerId, detalle) => {
        await observabilidad.registrar(pool, o2, customerId, 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE', detalle);
      },
      confirmadaPorLaPersona: async (o2, customerId) => (await confirmaciones.vigente(o2, customerId)) !== null,
      ...(o.log ? { log: o.log } : {}),
    }).inspeccionar(org),
  };
  return base;
}

/** Lector listo para el módulo de handoff: sólo el estado, que es lo único que necesita para decidir. */
export function lectorVerificacionGoogle(pool: Pool, o: OpcionesVerificacionGoogle): (org: string) => Promise<EstadoVerificacionAnunciante | null> {
  const puerto = puertoVerificacionGoogle(pool, o);
  return async (org: string) => (await puerto.inspeccionar(org)).estado;
}
