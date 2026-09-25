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
import { conCache, VerificacionGoogleAds, type RespuestaVerificacion } from './verificacion-google';
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
    return { ok: true, programas: programasDe(await cliente.verificacionDeIdentidad(customerId)) };
  };

  const base: PuertoVerificacionAnunciante = {
    nombre: 'google-ads',
    inspeccionar: async (org: string) => new VerificacionGoogleAds({
      cuenta: async () => (await cuentaYManager(pool, org))?.cuenta ?? null,
      consultar: consultarPara(org),
      ...(o.log ? { log: o.log } : {}),
    }).inspeccionar(org),
  };
  return conCache(base, o.ttlMs);
}

/** Lector listo para el módulo de handoff: sólo el estado, que es lo único que necesita para decidir. */
export function lectorVerificacionGoogle(pool: Pool, o: OpcionesVerificacionGoogle): (org: string) => Promise<EstadoVerificacionAnunciante | null> {
  const puerto = puertoVerificacionGoogle(pool, o);
  return async (org: string) => (await puerto.inspeccionar(org)).estado;
}
