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
 * Y aquí está el límite, dicho sin rodeos: **ninguna de las dos dice si la tarjeta funciona hoy**. Google no
 * expone la validez de un medio de pago, ni un rechazo reciente, ni el saldo. Lo que se puede saber es si la
 * cuenta está activa y si tiene una configuración de pago aprobada. Cuando eso no alcanza para afirmar que la
 * cuenta puede publicar, la respuesta es `UNKNOWN` — nunca `READY`.
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
  /** Gasto histórico observado, si se conoce. Contraprueba para no molestar a quien ya publicó. */
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
      return evaluarFacturacion({ estadoCuenta: null, configuraciones: null, gastoHistoricoMinor: null });
    }

    let estadoCuenta: string | null = null;
    let configuraciones: readonly EstadoConfiguracionPago[] | null = null;
    try {
      const filasCuenta = await cliente.buscar(cuenta, CONSULTA_CUENTA);
      estadoCuenta = filasCuenta.length > 0 ? valor(filasCuenta[0]!, 'customer', 'status') : null;

      const filasPago = await cliente.buscar(cuenta, CONSULTA_PAGO);
      configuraciones = filasPago
        .map((f) => (valor(f, 'billingSetup', 'status') ?? valor(f, 'billing_setup', 'status') ?? 'UNKNOWN') as EstadoConfiguracionPago);
    } catch (e) {
      // Un proveedor que no responde no es una respuesta: se reintenta, no se concluye.
      this.deps.log?.({ facturacion: 'consulta-fallida', org, error: e instanceof Error ? e.message : 'error' });
      return evaluarFacturacion({ estadoCuenta: null, configuraciones: null, gastoHistoricoMinor: null });
    }

    const gasto = this.deps.gastoHistoricoMinor === undefined ? null : await this.deps.gastoHistoricoMinor(org).catch(() => null);
    return evaluarFacturacion({ estadoCuenta, configuraciones, gastoHistoricoMinor: gasto });
  }
}
