/**
 * apps/api · EJECUCIÓN DE CAMPAÑAS · composición por organización.
 *
 * Aquí se decide si una empresa tiene, HOY, un camino real de escritura hacia Google Ads. Fail-closed en cada
 * eslabón: sin configuración de plataforma, sin token de desarrollador, sin conexión conectada, sin cuenta
 * declarada o sin la capacidad `ESCRITURA_ADS` encendida, el cliente NO se construye. Un cliente ausente no
 * produce un error críptico: el motor de requisitos ya explicó cuál de esos eslabones falta.
 *
 * El interruptor del despliegue se comprueba ANTES que nada: con las mutaciones externas apagadas no se
 * construye ni el transporte.
 */
import type { Pool } from 'pg';
import { obtenerAccessTokenDeOrg } from '../acquisition/google-ads-oauth-flow';
import type { ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';
import { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { mutacionesExternasHabilitadas } from '../gobierno/kill-switch';

export interface OpcionesComposicionEjecucion {
  readonly pool: Pool;
  readonly env: NodeJS.ProcessEnv;
  readonly composicionGoogleAds: ComponentesFlujoGoogleAds | null | undefined;
  readonly log?: (info: Record<string, unknown>) => void;
}

/** Cuenta de Google Ads declarada en la conexión persistida (Fase B). `null` ⇒ no hay dónde crear. */
async function cuentaDe(pool: Pool, org: string): Promise<{ customerId: string; loginCustomerId: string } | null> {
  const conexion = await new RepositorioConexiones(pool).buscar(org, 'GOOGLE_ADS');
  if (conexion === null || conexion.estado !== 'CONNECTED') return null;
  const cfg = conexion.configuracion as { customerId?: string; loginCustomerId?: string };
  const customerId = (cfg.customerId ?? conexion.externalAccountId ?? '').replace(/\D/g, '');
  if (customerId === '') return null;
  const login = (cfg.loginCustomerId ?? conexion.loginAccountId ?? customerId).replace(/\D/g, '');
  return { customerId, loginCustomerId: login === '' ? customerId : login };
}

/**
 * Cliente de ESCRITURA para una organización, o `null` si algún eslabón falta. Exige explícitamente la
 * capacidad `ESCRITURA_ADS`: leer la cuenta (Fase E) y crear en ella son permisos distintos.
 */
export async function clienteDeEscrituraGoogle(org: string, o: OpcionesComposicionEjecucion): Promise<GoogleAdsMutateHttpClient | null> {
  if (!mutacionesExternasHabilitadas(o.env)) return null;
  const developerToken = o.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!o.composicionGoogleAds || !developerToken) return null;

  const capacidades = await new RepositorioConexiones(o.pool).capacidades(org);
  if (!capacidades.some((c) => c.capacidad === 'ESCRITURA_ADS' && c.habilitada)) return null;

  const cuenta = await cuentaDe(o.pool, org);
  if (cuenta === null) return null;

  return new GoogleAdsMutateHttpClient({
    resolverAccessToken: () => obtenerAccessTokenDeOrg(o.composicionGoogleAds!, org),
    developerToken,
    loginCustomerId: cuenta.loginCustomerId,
    ...(o.log ? { logger: (i: unknown) => o.log?.({ googleAdsEjecucion: i }) } : {}),
  });
}

/**
 * Cliente de LECTURA para una organización. Exige capacidad de MEDICIÓN o de AUTONOMÍA, no la de escritura:
 * observar una campaña no es cambiarla. Es lo que permite correr el ciclo en modo SOMBRA sobre cuentas reales
 * sin concederle a SOEC ningún permiso de escritura.
 */
export async function clienteDeLecturaGoogle(org: string, o: OpcionesComposicionEjecucion): Promise<GoogleAdsMutateHttpClient | null> {
  const developerToken = o.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!o.composicionGoogleAds || !developerToken) return null;
  const capacidades = await new RepositorioConexiones(o.pool).capacidades(org);
  const habilitadas = new Set(capacidades.filter((c) => c.habilitada).map((c) => c.capacidad));
  if (!habilitadas.has('MEDICION_REAL') && !habilitadas.has('AUTONOMIA_ADS')) return null;
  const cuenta = await cuentaDe(o.pool, org);
  if (cuenta === null) return null;
  return new GoogleAdsMutateHttpClient({
    resolverAccessToken: () => obtenerAccessTokenDeOrg(o.composicionGoogleAds!, org),
    developerToken,
    loginCustomerId: cuenta.loginCustomerId,
    ...(o.log ? { logger: (i: unknown) => o.log?.({ googleAdsLecturaOptimizacion: i }) } : {}),
  });
}

/**
 * Señal observada de una conversión: cuántos eventos de ese tipo ha visto SOEC. Es lo ÚNICO que convierte
 * «medición instalada» en «medición verificada». Si no hay nada observado, devuelve cero — nunca un supuesto.
 */
export function crearObservadorDeEventos(pool: Pool): (org: string, eventKey: string) => Promise<{ observados: number; desde: string | null }> {
  return async (org, eventKey) => {
    try {
      const { rows } = await pool.query(
        `select count(*)::int as n, min(occurred_at) as desde
         from events
         where organization_id = $1
           and occurred_at > now() - interval '90 days'
           and (payload::text ilike $2 or type ilike $2)`,
        [org, `%${eventKey}%`],
      );
      const r = rows[0] as { n: number; desde: Date | null } | undefined;
      return { observados: Number(r?.n ?? 0), desde: r?.desde ? new Date(r.desde).toISOString() : null };
    } catch {
      return { observados: 0, desde: null };
    }
  };
}
