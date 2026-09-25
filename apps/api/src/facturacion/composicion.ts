/**
 * apps/api · FACTURACIÓN · composición: de dónde sale el cliente y la cuenta sobre la que se pregunta.
 *
 * Se apoya entero en lo que ya existe —el cliente de LECTURA de Google Ads que usan medición y optimización,
 * con su credencial cifrada y su developer token— y en la cuenta elegida que vive en el SSOT operativo. No
 * añade credenciales, ni rutas nuevas hacia el proveedor, ni un segundo lugar donde mirar.
 *
 * Si falta cualquiera de las dos piezas, el adaptador responde «no se pudo consultar» y nadie concluye nada.
 */
import type { Pool } from 'pg';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { RepositorioConfirmacionDePago } from './facturacion-pg';
import { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import { obtenerAccessTokenDeOrg } from '../acquisition/google-ads-oauth-flow';
import type { ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';
import { FacturacionGoogleAds, type ClienteConsultaGoogle } from './facturacion-google';
import type { EstadoFacturacion, PuertoFacturacionPublicitaria } from './facturacion-tipos';

export interface OpcionesFacturacionGoogle {
  readonly env: Record<string, string | undefined>;
  readonly composicionGoogleAds: ComponentesFlujoGoogleAds | null;
  readonly log?: (info: Record<string, unknown>) => void;
  /** Gasto histórico observado, si algún día se puede leer de forma fiable. Contraprueba, nunca prueba. */
  readonly gastoHistoricoMinor?: (org: string) => Promise<number | null>;
}

/** La cuenta elegida por la empresa, tal como la escribió la Fase I.1. `null` ⇒ todavía no hay ninguna. */
export async function cuentaElegidaDe(pool: Pool, org: string): Promise<string | null> {
  const c = await new RepositorioConexiones(pool).buscar(org, 'GOOGLE_ADS').catch(() => null);
  if (c === null || c.estado !== 'CONNECTED') return null;
  const id = String((c.configuracion as { customerId?: string }).customerId ?? c.externalAccountId ?? '').replace(/\D/g, '');
  return id === '' ? null : id;
}

/**
 * CLIENTE DE SALUD DE LA CUENTA. Deliberadamente SIN la puerta de capacidades.
 *
 * La primera versión reutilizó `clienteDeLecturaGoogle`, que exige `MEDICION_REAL` o `AUTONOMIA_ADS`. Parecía
 * prudente y era un error de bulto: esas capacidades se encienden DESPUÉS, cuando ya se mide o se optimiza,
 * mientras que preguntar «¿esta cuenta puede pagar sus anuncios?» es parte de la incorporación —justo cuando
 * ninguna de las dos está encendida—. El resultado fue que el cliente siempre salía `null`, la lectura
 * respondía «no se pudo consultar», y el paso de pago no le aparecía a NADIE. Un fail-closed correcto puede
 * esconder un camino muerto: sólo se notó mirando una empresa real.
 *
 * Esto no concede nada nuevo: son dos consultas de lectura con la credencial que la empresa ya autorizó.
 */
async function clienteDeSaludDeCuenta(pool: Pool, org: string, o: OpcionesFacturacionGoogle): Promise<ClienteConsultaGoogle | null> {
  const developerToken = o.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!o.composicionGoogleAds || !developerToken) return null;
  const conexion = await new RepositorioConexiones(pool).buscar(org, 'GOOGLE_ADS').catch(() => null);
  if (conexion === null || conexion.estado !== 'CONNECTED') return null;
  const cfg = (conexion.configuracion ?? {}) as { customerId?: string; loginCustomerId?: string };
  const cuenta = String(cfg.customerId ?? conexion.externalAccountId ?? '').replace(/\D/g, '');
  if (cuenta === '') return null;
  const comp = o.composicionGoogleAds;
  return new GoogleAdsMutateHttpClient({
    resolverAccessToken: () => obtenerAccessTokenDeOrg(comp, org),
    developerToken,
    loginCustomerId: String(cfg.loginCustomerId ?? cuenta).replace(/\D/g, '') || cuenta,
    ...(o.log ? { logger: (i: unknown) => o.log?.({ googleAdsSaludDeCuenta: i }) } : {}),
  });
}

export function puertoFacturacionGoogle(pool: Pool, o: OpcionesFacturacionGoogle): PuertoFacturacionPublicitaria {
  return new FacturacionGoogleAds({
    cliente: async (org): Promise<ClienteConsultaGoogle | null> => clienteDeSaludDeCuenta(pool, org, o),
    cuenta: (org) => cuentaElegidaDe(pool, org),
    // Lo único observable cuando el pago es autoservicio: que una persona ya lo revisó y lo confirmó.
    confirmacionVigente: async (org, customerId) =>
      (await new RepositorioConfirmacionDePago(pool).vigente(org, customerId)) !== null,
    ...(o.gastoHistoricoMinor ? { gastoHistoricoMinor: o.gastoHistoricoMinor } : {}),
    ...(o.log ? { log: o.log } : {}),
  });
}

/** Lector listo para inyectar en el módulo de handoff: devuelve sólo el estado, que es lo único que necesita. */
export function lectorFacturacionGoogle(pool: Pool, o: OpcionesFacturacionGoogle): (org: string) => Promise<EstadoFacturacion | null> {
  const puerto = puertoFacturacionGoogle(pool, o);
  return async (org: string) => (await puerto.inspeccionar(org)).estado;
}
