/**
 * apps/api · FACTURACIÓN · adaptador de Google Ads (SOLO LECTURA).
 *
 * Reutiliza el cliente que ya existe —el mismo `buscar(customerId, query)` que usan las fases de medición y
 * optimización, con la misma credencial cifrada y el mismo developer token— para hacer dos consultas y nada
 * más. No hay un segundo cliente, ni un segundo OAuth, ni una sola escritura.
 *
 * Las dos consultas son exactamente las que la API permite hacer sobre esto:
 *
 *   SELECT customer.status FROM customer
 *   SELECT billing_setup.status FROM billing_setup
 *
 * Y aquí está el límite, dicho sin rodeos. `billing_setup` **sólo existe bajo facturación mensual**: la
 * documentación de Google lo exige para manejar facturación por API, y ese régimen pide un año de empresa y
 * unos 5.000 USD mensuales de gasto. Para una cuenta con tarjeta —es decir, para casi todo el mundo— la
 * consulta devuelve cero filas, y eso NO significa que falte una forma de pago: significa que no la podemos
 * ver. Confundir ambas cosas era el defecto de la versión anterior de este archivo.
 *
 * Tampoco `customer.status = ENABLED` sirve como prueba de pago: sirve para descartar cuentas canceladas,
 * suspendidas o cerradas, y para nada más.
 */
import { evaluarFacturacion, type LecturaFacturacion, type EstadoConfiguracionPago, type PuertoFacturacionPublicitaria } from './facturacion-tipos';

/** Lo mínimo del cliente de Google que hace falta: una consulta GAQL. */
export interface ClienteConsultaGoogle {
  buscar(customerId: string, query: string): Promise<Array<Record<string, unknown>>>;
}

export interface DepsFacturacionGoogle {
  /** Cliente de lectura ya compuesto para esta empresa. `null` ⇒ no hay camino hacia el proveedor. */
  readonly cliente: (org: string) => Promise<ClienteConsultaGoogle | null>;
  /** Cuenta sobre la que preguntar: la elegida y escrita en el SSOT. `null` ⇒ todavía no hay ninguna. */
  readonly cuenta: (org: string) => Promise<string | null>;
  /**
   * ¿Hay confirmación humana vigente para ESA cuenta? Es lo único que puede cerrar el paso cuando el pago es
   * autoservicio, porque es lo único observable: la API no expone la tarjeta de nadie.
   */
  readonly confirmacionVigente?: (org: string, customerId: string) => Promise<boolean>;
  /** Contexto, nunca prueba: que la cuenta haya publicado antes no dice que hoy pueda cobrarse. */
  readonly gastoHistoricoMinor?: (org: string) => Promise<number | null>;
  readonly log?: (info: Record<string, unknown>) => void;
}

const CONSULTA_CUENTA = 'SELECT customer.status FROM customer LIMIT 1';
const CONSULTA_PAGO = 'SELECT billing_setup.status FROM billing_setup';

/** Lee un valor anidado tolerando las dos formas en que la API devuelve los campos. */
function valor(fila: Record<string, unknown>, recurso: string, campo: string): string | null {
  const plano = fila[`${recurso}.${campo}`];
  if (typeof plano === 'string') return plano;
  const anidado = fila[recurso];
  if (anidado !== null && typeof anidado === 'object') {
    const v = (anidado as Record<string, unknown>)[campo];
    if (typeof v === 'string') return v;
  }
  return null;
}

export class FacturacionGoogleAds implements PuertoFacturacionPublicitaria {
  readonly nombre = 'google-ads';

  constructor(private readonly deps: DepsFacturacionGoogle) {}

  async inspeccionar(org: string): Promise<LecturaFacturacion> {
    const cuenta = await this.deps.cuenta(org).catch(() => null);
    const cliente = cuenta === null ? null : await this.deps.cliente(org).catch(() => null);
    if (cuenta === null || cliente === null) {
      // Sin cuenta elegida o sin camino al proveedor no se afirma nada: este paso del recorrido ni siquiera
      // ha llegado. Devolver RETRY_LATER evita que alguien vea una tarea de pago antes de tener cuenta.
      return evaluarFacturacion({ estadoCuenta: null, configuraciones: null, confirmacionHumanaVigente: false });
    }

    // PRIMERO el estado de la cuenta. Si esta consulta funciona, el proveedor está ahí y las credenciales
    // sirven: eso convierte cualquier fallo POSTERIOR en información, no en ruido.
    let estadoCuenta: string | null = null;
    try {
      const filasCuenta = await cliente.buscar(cuenta, CONSULTA_CUENTA);
      estadoCuenta = filasCuenta.length > 0 ? valor(filasCuenta[0]!, 'customer', 'status') : null;
    } catch (e) {
      // Ni siquiera se pudo hablar con Google: no se concluye nada.
      this.deps.log?.({ facturacion: 'cuenta-no-consultable', org, error: e instanceof Error ? e.message : 'error' });
      return evaluarFacturacion({ estadoCuenta: null, configuraciones: null, confirmacionHumanaVigente: false });
    }

    /**
     * AHORA la facturación mensual. Que esta consulta falle con el proveedor alcanzable es exactamente lo que
     * le pasa a una cuenta autoservicio: no hay facturación mensual que leer. Devolver lista vacía —en vez de
     * `null`— es lo que mantiene vivo ese camino; tratarlo como «no se pudo consultar» dejaba el paso de pago
     * invisible para todo el mundo.
     */
    let configuraciones: readonly EstadoConfiguracionPago[] = [];
    try {
      const filasPago = await cliente.buscar(cuenta, CONSULTA_PAGO);
      configuraciones = filasPago
        .map((f) => (valor(f, 'billingSetup', 'status') ?? valor(f, 'billing_setup', 'status') ?? 'UNKNOWN') as EstadoConfiguracionPago);
    } catch (e) {
      this.deps.log?.({ facturacion: 'sin-facturacion-mensual-legible', org, detalle: e instanceof Error ? e.message : 'error' });
      configuraciones = [];
    }

    const confirmacionHumanaVigente = this.deps.confirmacionVigente === undefined
      ? false
      : await this.deps.confirmacionVigente(org, cuenta).catch(() => false);
    const gasto = this.deps.gastoHistoricoMinor === undefined ? null : await this.deps.gastoHistoricoMinor(org).catch(() => null);
    return evaluarFacturacion({ estadoCuenta, configuraciones, confirmacionHumanaVigente, gastoHistoricoMinor: gasto });
  }
}
