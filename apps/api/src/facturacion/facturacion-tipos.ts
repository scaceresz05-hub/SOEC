/**
 * apps/api · FACTURACIÓN DEL CANAL (Autonomy Fase I.6) · ¿puede esta cuenta pagar sus anuncios?
 *
 * ARQUITECTURA V1, ya decidida: la cuenta de Google Ads es **del cliente**, y su facturación también. SOEC
 * obtiene el acceso que necesita para trabajar y nada más: no es el pagador, ni el dueño administrativo, y
 * jamás ve —ni guarda— un número de tarjeta. Los datos de pago se introducen sólo en Google.
 *
 * LO QUE LA API PERMITE SABER, comprobado en la documentación antes de escribir esto:
 *
 *   · `customer.status` → ENABLED / CANCELED / SUSPENDED / CLOSED. Una cuenta suspendida sólo la reactiva
 *     el soporte de Google: eso es un bloqueo externo, no una tarea para nadie.
 *   · `billing_setup.status` → PENDING / APPROVED / APPROVED_HELD / CANCELLED. Es el vínculo entre la cuenta
 *     y un perfil de pagos.
 *
 * LO QUE NO PERMITE SABER, y conviene decirlo sin adornos: si la tarjeta es válida hoy, si acaba de ser
 * rechazada, o si el saldo alcanza. Eso no se expone por API. Por eso el resultado NO es un booleano: hay
 * estados intermedios reales, y la ausencia de información nunca se convierte en «listo».
 */

export type EstadoFacturacion =
  | 'READY'                  // la cuenta tiene una configuración de pago aprobada
  | 'PAYMENT_SETUP_REQUIRED' // falta configurarla, y sólo puede hacerlo una persona en Google
  | 'PENDING_PROVIDER'       // la persona ya la configuró y Google todavía la está aprobando
  | 'BLOCKED_EXTERNAL'       // la cuenta no puede operar (suspendida, cancelada o cerrada)
  | 'RETRY_LATER'            // no se pudo consultar: no se concluye nada
  | 'UNKNOWN';               // se consultó, y aun así no se puede afirmar que esté lista

export type MotivoFacturacion =
  | 'CONFIGURACION_APROBADA'
  | 'SIN_CONFIGURACION_DE_PAGO'
  | 'APROBACION_EN_CURSO'
  | 'CUENTA_NO_OPERATIVA'
  | 'NO_SE_PUDO_CONSULTAR'
  | 'SIN_EVIDENCIA_SUFICIENTE';

export interface LecturaFacturacion {
  readonly estado: EstadoFacturacion;
  readonly motivo: MotivoFacturacion;
  /** Explicación en lenguaje de negocio. Nunca menciona identificadores ni jerga del proveedor. */
  readonly explicacion: string;
}

/** Estados de `billing_setup` tal como los nombra Google. Se reciben crudos y se interpretan aquí. */
export type EstadoConfiguracionPago = 'PENDING' | 'APPROVED' | 'APPROVED_HELD' | 'CANCELLED' | 'UNKNOWN';

/** Señales leídas del proveedor. `null` en cualquiera de ellas significa «no se pudo saber». */
export interface SenalesFacturacion {
  /** `customer.status`. `null` ⇒ no se pudo leer. */
  readonly estadoCuenta: string | null;
  /** Configuraciones de pago de la cuenta. `null` ⇒ la consulta falló (que no es «no hay ninguna»). */
  readonly configuraciones: readonly EstadoConfiguracionPago[] | null;
  /**
   * ¿Esta cuenta ha gastado alguna vez? Contraprueba: una cuenta que ya sirvió anuncios tuvo facturación
   * funcionando, así que no se le pide a nadie que la configure. No alcanza para declararla lista —una
   * tarjeta puede haber caducado ayer— pero sí para no molestar con algo que probablemente está hecho.
   */
  readonly gastoHistoricoMinor: number | null;
}

const CUENTA_NO_OPERATIVA = ['SUSPENDED', 'CANCELED', 'CANCELLED', 'CLOSED'];

/**
 * DE LAS SEÑALES AL ESTADO. Función pura, y con el orden de la honestidad:
 *
 *  1. si no se pudo consultar, no se decide nada;
 *  2. si la cuenta no puede operar, eso manda sobre cualquier configuración de pago;
 *  3. una configuración aprobada es lo único que justifica decir `READY`;
 *  4. y cuando no hay ninguna, se pide configurarla… salvo que la cuenta ya haya gastado, en cuyo caso lo
 *     honesto es reconocer que no lo sabemos en vez de mandar a alguien a arreglar lo que quizá funciona.
 *
 * Ninguna rama convierte la falta de información en «listo». Ésa es la única regla innegociable del archivo.
 */
export function evaluarFacturacion(s: SenalesFacturacion): LecturaFacturacion {
  const r = (estado: EstadoFacturacion, motivo: MotivoFacturacion, explicacion: string): LecturaFacturacion =>
    ({ estado, motivo, explicacion });

  if (s.configuraciones === null || s.estadoCuenta === null) {
    return r('RETRY_LATER', 'NO_SE_PUDO_CONSULTAR', 'Todavía no pudimos comprobar cómo se pagan tus anuncios. Lo reintentamos solos.');
  }

  const estado = s.estadoCuenta.trim().toUpperCase();
  if (CUENTA_NO_OPERATIVA.includes(estado)) {
    return r('BLOCKED_EXTERNAL', 'CUENTA_NO_OPERATIVA', 'Tu cuenta de anuncios no está activa en Google. Eso sólo puede resolverlo Google; te avisamos en cuanto cambie.');
  }
  if (estado !== 'ENABLED') {
    return r('UNKNOWN', 'SIN_EVIDENCIA_SUFICIENTE', 'No pudimos confirmar que tu cuenta de anuncios esté lista para publicar.');
  }

  if (s.configuraciones.includes('APPROVED')) {
    return r('READY', 'CONFIGURACION_APROBADA', 'Tu forma de pago está configurada en Google.');
  }
  if (s.configuraciones.includes('PENDING') || s.configuraciones.includes('APPROVED_HELD')) {
    return r('PENDING_PROVIDER', 'APROBACION_EN_CURSO', 'Google está revisando la forma de pago que configuraste. No hace falta que hagas nada más.');
  }

  // Sin configuración utilizable. Antes de pedir nada, se mira si la cuenta ya gastó alguna vez.
  if ((s.gastoHistoricoMinor ?? 0) > 0) {
    return r('UNKNOWN', 'SIN_EVIDENCIA_SUFICIENTE', 'Tu cuenta ya ha publicado antes, así que no te pedimos nada; aun así no podemos confirmar que la forma de pago siga vigente.');
  }
  return r('PAYMENT_SETUP_REQUIRED', 'SIN_CONFIGURACION_DE_PAGO', 'Falta decirle a Google cómo se pagan tus anuncios.');
}

/**
 * PUERTO CANÓNICO de preparación para facturar. Independiente de Google: es SÓLO LECTURA por definición —no
 * existe un verbo para «configurar el pago», porque eso ocurre en el proveedor y lo hace una persona.
 */
export interface PuertoFacturacionPublicitaria {
  readonly nombre: string;
  /** ¿Puede esta empresa pagar sus anuncios? Nunca escribe, nunca toca datos de pago. */
  inspeccionar(org: string): Promise<LecturaFacturacion>;
}

/**
 * A dónde se manda a la persona. Es la página de facturación de la propia interfaz de Google Ads —la misma
 * que su ayuda indica para revisar cómo se paga—, en un host que la lista blanca ya permite. No se fabrica un
 * enlace profundo no soportado: si Google cambia su interfaz, esto sigue llevando al sitio correcto.
 */
export const URL_FACTURACION_GOOGLE = 'https://ads.google.com/aw/billing/summary';
