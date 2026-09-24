/**
 * apps/api · HANDOFF EXTERNO · composición: de dónde sale el estado real de cada canal.
 *
 * El módulo de handoff no sabe hablar con Google —ni debe—: recibe hechos. Aquí se leen esos hechos con las
 * piezas que ya existen (el ciclo OAuth del proveedor y su descubrimiento de cuentas), sin abrir un segundo
 * camino hacia la API ni duplicar credenciales.
 *
 * Fail-soft a propósito: si no se puede preguntar por las cuentas, se devuelve `null` —«no lo sabemos»— y no
 * cero. La diferencia importa: cero cuentas dispara una tarea de alta de cuenta, y no vamos a pedirle a nadie
 * que cree una cuenta porque nuestra consulta falló.
 */
import type { Pool } from 'pg';
import { descubrirCuentas, type ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';
import { connectionIdDe } from '../acquisition/google-ads-connection';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { verificadoresDeGoogle, VERIFICADORES_PENDIENTES } from './handoff-verificadores';
import type { DepsHandoff } from './handoff-service';
import type { EstadoGoogleParaHandoff } from './handoff-google';

export async function estadoGoogleParaHandoff(
  org: string,
  composicion: ComponentesFlujoGoogleAds | null | undefined,
): Promise<{ estadoProveedor: string | null; cuentasAccesibles: number | null } | null> {
  if (!composicion) return null; // este despliegue no tiene Google configurado: no hay nada que sincronizar
  const conexion = await composicion.connRepo.obtener(org, connectionIdDe(org)).catch(() => null);
  const estadoProveedor = conexion?.estado ?? null;

  // Sólo se pregunta por las cuentas cuando tiene sentido: sin autorización válida, la respuesta no
  // significaría nada y además gastaría una llamada al proveedor.
  if (estadoProveedor !== 'ACCOUNT_SELECTION_PENDING' && estadoProveedor !== 'CONNECTED') {
    return { estadoProveedor, cuentasAccesibles: null };
  }
  const r = await descubrirCuentas(composicion, org).catch(() => null);
  return { estadoProveedor, cuentasAccesibles: r !== null && r.ok ? r.cuentas.length : null };
}

/** Estado del proveedor tal como lo entiende el módulo de handoff: ciclo OAuth + cuentas + SSOT operativo. */
export type EstadoGoogleCrudo = (org: string) => Promise<{ readonly estadoProveedor: string | null; readonly cuentasAccesibles: number | null } | null>;

/**
 * EL ÚNICO LECTOR del estado de Google para handoffs. Lo comparten la sincronización, los verificadores y el
 * scheduler: si la mitad que abre tareas y la que las cierra miraran a sitios distintos, tarde o temprano se
 * contradirían, y la persona lo notaría antes que nosotros.
 */
export function lectorEstadoGoogle(pool: Pool, estadoGoogle: EstadoGoogleCrudo | undefined): (org: string) => Promise<EstadoGoogleParaHandoff | null> {
  return async (org: string) => {
    if (estadoGoogle === undefined) return null;
    const estado = await estadoGoogle(org).catch(() => null);
    if (estado === null) return null;
    const conexion = await new RepositorioConexiones(pool).buscar(org, 'GOOGLE_ADS');
    return {
      estadoProveedor: estado.estadoProveedor,
      cuentasAccesibles: estado.cuentasAccesibles,
      cuentaEnElSsot: conexion !== null && conexion.estado === 'CONNECTED'
        && String((conexion.configuracion as { customerId?: string }).customerId ?? conexion.externalAccountId ?? '') !== '',
    };
  };
}

/**
 * Dependencias completas del servicio de handoff: el lector de arriba, los verificadores reales de Google y
 * los adaptadores pendientes de lo que todavía no sabemos observar. Rutas y scheduler construyen las suyas
 * desde aquí, de modo que reanudar por un clic y reanudar por un tick son literalmente lo mismo.
 */
export function depsDeHandoff(pool: Pool, opciones: Partial<DepsHandoff> & { readonly estadoGoogle?: EstadoGoogleCrudo } = {}): DepsHandoff {
  const leer = opciones.leerEstadoGoogle ?? lectorEstadoGoogle(pool, opciones.estadoGoogle);
  const base: DepsHandoff = {
    ...opciones,
    leerEstadoGoogle: leer,
    verificadores: opciones.verificadores ?? [...verificadoresDeGoogle(leer), ...VERIFICADORES_PENDIENTES],
  };
  return base;
}
