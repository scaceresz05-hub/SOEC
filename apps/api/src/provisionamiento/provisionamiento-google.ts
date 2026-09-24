/**
 * apps/api · PROVISIONAMIENTO · adaptador de Google Ads.
 *
 * Reutiliza lo que ya existe y nada más: el ciclo OAuth de `acquisition`, la credencial cifrada del depósito,
 * el mismo descubrimiento de cuentas que usan las Fases I.1–I.4 y el developer token del entorno. No hay un
 * segundo OAuth, ni un segundo almacén, ni un cliente paralelo.
 *
 * DOS HECHOS DEL PROVEEDOR que mandan sobre todo lo demás, comprobados en su documentación antes de escribir
 * una línea:
 *
 *  1. Una cuenta cliente se crea DESDE una administradora: el identificador de esa administradora va en la
 *     propia dirección de la llamada (`customers/{manager}:createCustomerClient`). Sin administradora
 *     accesible no hay operación posible — no es que sea difícil, es que no hay dónde llamar.
 *  2. Google restringe la función a anunciantes con historial de gasto y en regla con sus políticas. Eso no
 *     se puede saber antes de intentarlo, así que un rechazo por política se traduce a `BLOCKED_EXTERNAL` y
 *     se dice; nunca se reintenta a ciegas ni se disfraza de error temporal.
 *
 * LA ESCRITURA NACE APAGADA. Con la bandera en `false` —el valor por defecto— este adaptador JAMÁS llama a
 * `createCustomerClient`: ni siquiera construye la petición. Encenderla es una decisión humana y explícita.
 */
import type { ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';
import { descubrirCuentas } from '../acquisition/google-ads-oauth-flow';
import { connectionIdDe } from '../acquisition/google-ads-connection';
import {
  inspeccionarCapacidad, type CapacidadProvisionamiento, type CuentaAccesible, type DatosDeCuenta,
  type PuertoProvisionamientoCuenta, type ResultadoProvisionamiento, type ResultadoVerificacion,
  type SolicitudProvisionamiento,
} from './provisionamiento-tipos';

/** Bandera de escritura real. Sólo `'true'` exacto la enciende: cualquier otra cosa deja el camino cerrado. */
export function escriturasDeProvisionamientoHabilitadas(env: Record<string, string | undefined>): boolean {
  return env.GOOGLE_ADS_ACCOUNT_PROVISIONING_WRITES_ENABLED === 'true';
}

/** Lo que el adaptador necesita para mirar y (si alguna vez se autoriza) crear. */
export interface DepsProvisionamientoGoogle {
  readonly composicion: ComponentesFlujoGoogleAds | null;
  /** Datos del negocio para el alta. Se leen del SSOT; si faltan, `null` y nadie sigue. */
  readonly datosDeCuenta: (org: string) => Promise<DatosDeCuenta | null>;
  readonly env: Record<string, string | undefined>;
  /**
   * Llamada REAL a `customers/{manager}:createCustomerClient`. Se inyecta para que las pruebas usen un doble
   * y para que quede UN solo sitio donde ocurre la escritura. Ausente ⇒ no hay camino real en este despliegue.
   */
  readonly crearCuentaCliente?: (peticion: PeticionCrearCuenta) => Promise<RespuestaCrearCuenta>;
  readonly log?: (info: Record<string, unknown>) => void;
}

/** Petición de alta. Sin tokens: el adaptador de red resuelve la credencial por su cuenta. */
export interface PeticionCrearCuenta {
  readonly organizationId: string;
  readonly managerCustomerId: string;
  readonly nombre: string;
  readonly moneda: string;
  readonly zonaHoraria: string;
  /** Clave de idempotencia: la misma solicitud reintentada no puede convertirse en dos cuentas. */
  readonly claveIdempotencia: string;
}

export type RespuestaCrearCuenta =
  | { readonly ok: true; readonly customerId: string }
  | { readonly ok: false; readonly motivo: 'POLITICA' | 'TEMPORAL' | 'INCIERTO' | 'AUTORIZACION'; readonly detalle: string };

export class ProvisionamientoGoogleAds implements PuertoProvisionamientoCuenta {
  readonly nombre = 'google-ads';

  constructor(private readonly deps: DepsProvisionamientoGoogle) {}

  /** Mirar nunca escribe: ni una fila, ni una llamada de mutación. */
  async inspeccionar(org: string): Promise<CapacidadProvisionamiento> {
    const comp = this.deps.composicion;
    if (comp === null) {
      return inspeccionarCapacidad({ estadoProveedor: null, cuentas: [], accesoDeApi: false, datosDeCuenta: null });
    }

    const conexion = await comp.connRepo.obtener(org, connectionIdDe(org)).catch(() => null);
    const estadoProveedor = conexion?.estado ?? null;

    // `null` = «no lo pudimos mirar», y es distinto de «no hay ninguna». La diferencia decide entre esperar y
    // pedirle algo a una persona, así que no se colapsan nunca.
    let cuentas: readonly CuentaAccesible[] | null = null;
    if (estadoProveedor === 'ACCOUNT_SELECTION_PENDING' || estadoProveedor === 'CONNECTED') {
      const r = await descubrirCuentas(comp, org).catch(() => null);
      cuentas = r !== null && r.ok
        ? r.cuentas.map((c) => ({ customerId: c.customerId, manager: c.manager, testAccount: c.testAccount }))
        : null;
    } else {
      cuentas = []; // sin autorización vigente no hay nada accesible, y eso sí lo sabemos
    }

    return inspeccionarCapacidad({
      estadoProveedor,
      cuentas,
      accesoDeApi: (this.deps.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '').trim() !== '',
      datosDeCuenta: await this.deps.datosDeCuenta(org).catch(() => null),
    });
  }

  /**
   * Crea la cuenta en el proveedor. Dos puertas antes de la red: la bandera de escritura y una capacidad que
   * de verdad diga `AUTOMATABLE`. Con cualquiera de las dos cerrada no se construye ni la petición.
   */
  async provisionar(solicitud: SolicitudProvisionamiento): Promise<ResultadoProvisionamiento> {
    if (!escriturasDeProvisionamientoHabilitadas(this.deps.env)) {
      // Ni se mira la red: la bandera apagada significa que este camino no existe hoy.
      return { resultado: 'NO_INTENTADA', detalle: 'la creación automática de cuentas está apagada en este entorno' };
    }
    const capacidad = await this.inspeccionar(solicitud.organizationId);
    if (capacidad.estado !== 'AUTOMATABLE' || capacidad.managerCustomerId === null) {
      return { resultado: 'NO_INTENTADA', detalle: `no se puede crear la cuenta por API: ${capacidad.motivo}` };
    }
    if (this.deps.crearCuentaCliente === undefined) {
      return { resultado: 'NO_INTENTADA', detalle: 'este despliegue no tiene camino de escritura hacia el proveedor' };
    }

    let r: RespuestaCrearCuenta;
    try {
      r = await this.deps.crearCuentaCliente({
        organizationId: solicitud.organizationId,
        managerCustomerId: capacidad.managerCustomerId,
        nombre: solicitud.nombreDeseado,
        moneda: solicitud.moneda,
        zonaHoraria: solicitud.zonaHoraria,
        claveIdempotencia: solicitud.id,
      });
    } catch (e) {
      // Una excepción NO es un fracaso conocido: puede que la cuenta se haya creado y se cayera la respuesta.
      // Por eso es INCIERTO, y lo que sigue es reconciliar, no reintentar.
      return { resultado: 'INCIERTO', detalle: e instanceof Error ? e.message : 'la llamada no devolvió respuesta' };
    }

    if (r.ok) return { resultado: 'CREADA', customerId: r.customerId };
    if (r.motivo === 'POLITICA') return { resultado: 'RECHAZADA_POR_PROVEEDOR', detalle: r.detalle };
    if (r.motivo === 'INCIERTO') return { resultado: 'INCIERTO', detalle: r.detalle };
    return { resultado: 'REINTENTAR', detalle: r.detalle };
  }

  /**
   * RECONCILIACIÓN. La red de seguridad de toda operación externa que no se puede repetir a ciegas: si la
   * respuesta se perdió, se pregunta al proveedor si la cuenta ya existe antes de volver a crearla. Se
   * identifica por el nombre, la moneda y la zona horaria que pedimos — lo único que conocemos de ella.
   */
  async verificar(solicitud: SolicitudProvisionamiento): Promise<ResultadoVerificacion> {
    const comp = this.deps.composicion;
    if (comp === null) return { verificacion: 'INDETERMINADA', detalle: 'no hay conexión con el proveedor' };
    const r = await descubrirCuentas(comp, solicitud.organizationId).catch(() => null);
    if (r === null || !r.ok) return { verificacion: 'INDETERMINADA', detalle: 'no se pudo consultar al proveedor' };

    if (solicitud.referenciaProveedor !== null) {
      const porId = r.cuentas.find((c) => c.customerId === solicitud.referenciaProveedor);
      if (porId !== undefined) return { verificacion: 'EXISTE', customerId: porId.customerId };
    }
    const coincide = r.cuentas.find((c) => !c.manager
      && (c.descriptiveName ?? '').trim() === solicitud.nombreDeseado
      && (c.currencyCode ?? '') === solicitud.moneda
      && (c.timeZone ?? '') === solicitud.zonaHoraria);
    if (coincide !== undefined) return { verificacion: 'EXISTE', customerId: coincide.customerId };
    // Ninguna coincide y SÍ pudimos mirar: entonces de verdad no existe.
    return { verificacion: 'NO_EXISTE' };
  }
}
