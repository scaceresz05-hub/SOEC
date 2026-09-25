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
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { datosDeCuentaDesdeNegocio, inspeccionarCapacidad, type CuentaAccesible } from '../provisionamiento/provisionamiento-tipos';
import { verificadorDeAnunciante, verificadorDeFacturacion } from './handoff-verificadores';
import type { EstadoFacturacion } from '../facturacion/facturacion-tipos';
import type { EstadoVerificacionAnunciante } from '../verificacion/verificacion-tipos';
import { verificadoresDeGoogle, VERIFICADORES_PENDIENTES } from './handoff-verificadores';
import type { DepsHandoff } from './handoff-service';
import type { EstadoGoogleParaHandoff } from './handoff-google';

export async function estadoGoogleParaHandoff(
  org: string,
  composicion: ComponentesFlujoGoogleAds | null | undefined,
): Promise<EstadoGoogleCrudoLeido | null> {
  if (!composicion) return null; // este despliegue no tiene Google configurado: no hay nada que sincronizar
  const conexion = await composicion.connRepo.obtener(org, connectionIdDe(org)).catch(() => null);
  const estadoProveedor = conexion?.estado ?? null;

  // Sólo se pregunta por las cuentas cuando tiene sentido: sin autorización válida, la respuesta no
  // significaría nada y además gastaría una llamada al proveedor.
  if (estadoProveedor !== 'ACCOUNT_SELECTION_PENDING' && estadoProveedor !== 'CONNECTED') {
    return { estadoProveedor, cuentasAccesibles: null, cuentas: [] };
  }
  const r = await descubrirCuentas(composicion, org).catch(() => null);
  if (r === null || !r.ok) return { estadoProveedor, cuentasAccesibles: null, cuentas: null };
  // Se devuelve la LISTA, no sólo cuántas: saber si alguna es administradora es lo que decide si SOEC puede
  // crear la cuenta o hay que pedírselo a una persona. Una sola llamada al proveedor responde ambas cosas.
  return {
    estadoProveedor,
    cuentasAccesibles: r.cuentas.length,
    cuentas: r.cuentas.map((c) => ({ customerId: c.customerId, manager: c.manager, testAccount: c.testAccount })),
  };
}

/** Lo que se sabe del proveedor tras mirarlo una vez. `cuentas` va aparte del conteo a propósito. */
export interface EstadoGoogleCrudoLeido {
  readonly estadoProveedor: string | null;
  readonly cuentasAccesibles: number | null;
  /** Cuentas accesibles. `null` ⇒ no se pudo mirar; ausente ⇒ este lector no las trae. */
  readonly cuentas?: readonly CuentaAccesible[] | null;
}

/** Estado del proveedor tal como lo entiende el módulo de handoff: ciclo OAuth + cuentas + SSOT operativo. */
export type EstadoGoogleCrudo = (org: string) => Promise<EstadoGoogleCrudoLeido | null>;

/**
 * EL ÚNICO LECTOR del estado de Google para handoffs. Lo comparten la sincronización, los verificadores y el
 * scheduler: si la mitad que abre tareas y la que las cierra miraran a sitios distintos, tarde o temprano se
 * contradirían, y la persona lo notaría antes que nosotros.
 */
export function lectorEstadoGoogle(
  pool: Pool,
  estadoGoogle: EstadoGoogleCrudo | undefined,
  env: Record<string, string | undefined> = process.env,
  /** Estado de facturación del canal (Fase I.6). Ausente ⇒ no se evalúa y no se pide nada. */
  leerFacturacion?: (org: string) => Promise<EstadoFacturacion | null>,
  /** Verificación del anunciante. Ausente ⇒ no se evalúa y no se pide nada. */
  leerVerificacion?: (org: string) => Promise<EstadoVerificacionAnunciante | null>,
): (org: string) => Promise<EstadoGoogleParaHandoff | null> {
  return async (org: string) => {
    if (estadoGoogle === undefined) return null;
    const estado = await estadoGoogle(org).catch(() => null);
    if (estado === null) return null;
    const conexion = await new RepositorioConexiones(pool).buscar(org, 'GOOGLE_ADS');

    /**
     * CAPACIDAD DE PROVISIONAMIENTO (Fase I.5), calculada con los MISMOS hechos que ya se leyeron: si entre
     * las cuentas accesibles hay una administradora utilizable, SOEC podría crear la cuenta y no tiene
     * sentido pedírselo a nadie. Si este lector no trae la lista, la capacidad queda sin evaluar y todo se
     * comporta como antes: no saber nunca debe ahorrarle un paso a nadie.
     */
    const capacidad = estado.cuentas === undefined ? undefined : inspeccionarCapacidad({
      estadoProveedor: estado.estadoProveedor,
      cuentas: estado.cuentas,
      accesoDeApi: (env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '').trim() !== '',
      datosDeCuenta: datosDeCuentaDesdeNegocio(await new RepositorioNegocios(pool).perfil(org).catch(() => null)),
    }).estado;

    const cuentaEnElSsot = conexion !== null && conexion.estado === 'CONNECTED'
      && String((conexion.configuracion as { customerId?: string }).customerId ?? conexion.externalAccountId ?? '') !== '';

    /**
     * FACTURACIÓN (Fase I.6). Sólo se pregunta cuando YA hay cuenta elegida: antes de eso el recorrido ni
     * siquiera ha llegado a este paso, y preguntarlo gastaría dos consultas al proveedor para nada.
     */
    const facturacion = cuentaEnElSsot && leerFacturacion !== undefined
      ? await leerFacturacion(org).catch(() => null)
      : null;

    /**
     * VERIFICACIÓN DEL ANUNCIANTE. También sólo con cuenta elegida, y va cacheada en su composición porque
     * Google limita esa llamada más que el resto: preguntarla en cada tick nos dejaría sin cuota nosotros
     * solos.
     */
    const verificacion = cuentaEnElSsot && leerVerificacion !== undefined
      ? await leerVerificacion(org).catch(() => null)
      : null;

    return {
      estadoProveedor: estado.estadoProveedor,
      cuentasAccesibles: estado.cuentasAccesibles,
      cuentaEnElSsot,
      ...(capacidad === undefined ? {} : { capacidadProvisionamiento: capacidad }),
      ...(facturacion === null ? {} : { facturacion }),
      ...(verificacion === null ? {} : { verificacionAnunciante: verificacion }),
    };
  };
}

/**
 * Dependencias completas del servicio de handoff: el lector de arriba, los verificadores reales de Google y
 * los adaptadores pendientes de lo que todavía no sabemos observar. Rutas y scheduler construyen las suyas
 * desde aquí, de modo que reanudar por un clic y reanudar por un tick son literalmente lo mismo.
 */
export function depsDeHandoff(
  pool: Pool,
  opciones: Partial<DepsHandoff> & {
    readonly estadoGoogle?: EstadoGoogleCrudo;
    /** Lector de facturación del canal (Fase I.6). Ausente ⇒ nunca se pide configurar una forma de pago. */
    readonly facturacion?: (org: string) => Promise<EstadoFacturacion | null>;
    /** Lector de la verificación del anunciante. Ausente ⇒ nunca se pide verificar nada. */
    readonly verificacionAnunciante?: (org: string) => Promise<EstadoVerificacionAnunciante | null>;
  } = {},
): DepsHandoff {
  const leer = opciones.leerEstadoGoogle
    ?? lectorEstadoGoogle(pool, opciones.estadoGoogle, process.env, opciones.facturacion, opciones.verificacionAnunciante);
  const base: DepsHandoff = {
    ...opciones,
    leerEstadoGoogle: leer,
    verificadores: opciones.verificadores ?? [
      ...verificadoresDeGoogle(leer),
      // El verificador de la forma de pago cierra la tarea SIN que nadie pulse nada, en cuanto Google la
      // refleja aprobada. Sin lector de facturación no existe, y entonces nada se cierra solo: el sesgo seguro.
      ...(opciones.facturacion === undefined ? [] : [verificadorDeFacturacion(opciones.facturacion)]),
      ...(opciones.verificacionAnunciante === undefined ? [] : [verificadorDeAnunciante(opciones.verificacionAnunciante)]),
      ...VERIFICADORES_PENDIENTES,
    ],
  };
  return base;
}
