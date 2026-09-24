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
import { clienteDeLecturaGoogle } from '../ejecucion/composicion';
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

export function puertoFacturacionGoogle(pool: Pool, o: OpcionesFacturacionGoogle): PuertoFacturacionPublicitaria {
  return new FacturacionGoogleAds({
    cliente: async (org): Promise<ClienteConsultaGoogle | null> => clienteDeLecturaGoogle(org, {
      pool, env: o.env, composicionGoogleAds: o.composicionGoogleAds, ...(o.log ? { log: o.log } : {}),
    }),
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
