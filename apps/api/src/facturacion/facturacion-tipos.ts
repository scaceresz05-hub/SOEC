/**
 * apps/api · FACTURACIÓN DEL CANAL (Autonomy Fase I.6.1) · ¿puede esta cuenta pagar sus anuncios?
 *
 * ARQUITECTURA V1: la cuenta de Google Ads es **del cliente**, y su facturación también. SOEC obtiene el
 * acceso que necesita para trabajar y nada más. Nunca ve ni guarda un número de tarjeta: los datos de pago se
 * escriben sólo en Google.
 *
 * LA CORRECCIÓN QUE ORIGINA ESTE ARCHIVO. La versión anterior leía `billing_setup` y, al no encontrar filas,
 * concluía «falta configurar el pago». Es falso, y de una forma que habría hecho quedar mal al producto
 * delante de gente que tenía su tarjeta perfectamente puesta. La documentación de Google es explícita: los
 * flujos de facturación de la API exigen **facturación mensual** («monthly invoicing»), un régimen para el
 * que hace falta llevar un año como empresa y gastar unos 5.000 USD mensuales. Para todo lo demás —tarjeta,
 * PayPal, débito automático— `billing_setup` sencillamente **no existe**, y su ausencia no dice nada.
 *
 * De ahí la distinción que este módulo mantiene inequívoca:
 *
 *   · LO QUE SE OBSERVA (`ObservacionFacturacion`): qué vimos de verdad en la API.
 *   · LO QUE SIGNIFICA (`EstadoFacturacion`): qué implica para el recorrido de la persona.
 *
 * Y el hecho incómodo en el centro: **el método de pago autoservicio no es verificable por API**. No hay
 * señal oficial que lo exponga. Cuando eso pasa, la respuesta honesta no es inventar un diagnóstico técnico,
 * sino admitir el límite y pedir a la persona lo mínimo: que lo mire y nos lo confirme.
 */

/** Lo que de verdad se observó en el proveedor. Vocabulario técnico: no sale nunca a una pantalla. */
export type ObservacionFacturacion =
  | 'MONTHLY_INVOICING_READY'          // hay una configuración de facturación mensual aprobada
  | 'MONTHLY_INVOICING_PENDING'        // existe y Google la está aprobando
  | 'MONTHLY_INVOICING_BLOCKED'        // existió y quedó cancelada: ese camino no está disponible
  | 'SELF_SERVICE_PAYMENT_UNVERIFIABLE' // la cuenta no usa facturación mensual ⇒ la API no expone su pago
  | 'ACCOUNT_BLOCKED'                  // la cuenta no está operativa en Google
  | 'RETRY_LATER'                      // no se pudo consultar
  | 'UNKNOWN';                         // se consultó y no alcanza para concluir

/** Lo que significa para el recorrido. Es lo que consumen el handoff y la pantalla. */
export type EstadoFacturacion =
  | 'READY'                  // se puede publicar: o Google lo confirma, o la persona lo atestiguó
  | 'PAYMENT_SETUP_REQUIRED' // hace falta una acción humana irreducible (revisar y confirmar)
  | 'PENDING_PROVIDER'       // Google está aprobando; nadie tiene que hacer nada
  | 'BLOCKED_EXTERNAL'       // la cuenta no está operativa
  | 'RETRY_LATER'            // no se pudo consultar
  | 'UNKNOWN';               // no alcanza para concluir

export type MotivoFacturacion =
  | 'FACTURACION_MENSUAL_APROBADA'
  | 'APROBACION_EN_CURSO'
  | 'CONFIRMADO_POR_LA_PERSONA'
  | 'PAGO_NO_VERIFICABLE_POR_API'
  | 'CUENTA_NO_OPERATIVA'
  | 'NO_SE_PUDO_CONSULTAR'
  | 'SIN_EVIDENCIA_SUFICIENTE';

export interface LecturaFacturacion {
  readonly estado: EstadoFacturacion;
  /** Qué se observó exactamente. Sirve para auditar la decisión y para no volver a confundir los dos planos. */
  readonly observacion: ObservacionFacturacion;
  readonly motivo: MotivoFacturacion;
  /** Explicación en lenguaje de negocio. Nunca menciona identificadores ni jerga del proveedor. */
  readonly explicacion: string;
  /** `true` cuando lo único que falta es que una persona mire y confirme. */
  readonly requiereConfirmacionHumana: boolean;
}

/** Estados de `billing_setup` tal como los nombra Google. Sólo existen bajo facturación mensual. */
export type EstadoConfiguracionPago = 'PENDING' | 'APPROVED' | 'APPROVED_HELD' | 'CANCELLED' | 'UNKNOWN';

/** Señales leídas del proveedor y del propio SOEC. `null` significa siempre «no se pudo saber». */
export interface SenalesFacturacion {
  /** `customer.status`. `null` ⇒ no se pudo leer. */
  readonly estadoCuenta: string | null;
  /**
   * Configuraciones de facturación MENSUAL de la cuenta. `null` ⇒ la consulta falló. Una lista vacía NO
   * significa «no tiene forma de pago»: significa «esta cuenta no usa facturación mensual», que es el caso
   * normal de casi todo el mundo.
   */
  readonly configuraciones: readonly EstadoConfiguracionPago[] | null;
  /** ¿Existe una confirmación humana vigente para la cuenta que está elegida AHORA? */
  readonly confirmacionHumanaVigente: boolean;
  /**
   * Contexto, nunca prueba: que la cuenta haya gastado antes no dice que hoy tenga un medio de pago válido.
   * Sólo se usa para redactar mejor lo que se le pide a la persona.
   */
  readonly gastoHistoricoMinor?: number | null;
}

const CUENTA_NO_OPERATIVA = ['SUSPENDED', 'CANCELED', 'CANCELLED', 'CLOSED'];

/**
 * DE LAS SEÑALES AL ESTADO. Función pura, y con el orden de la honestidad:
 *
 *  1. si no se pudo consultar, no se decide nada;
 *  2. si la cuenta no puede operar, eso manda sobre cualquier otra cosa;
 *  3. si hay facturación mensual observable, se usa —ahí SÍ sabemos, y el sistema puede cerrar solo—;
 *  4. y si no la hay, se admite el límite: la API no expone el pago autoservicio. Entonces la única salida
 *     honesta es preguntarle a la persona, y la única que cierra el paso es su confirmación explícita.
 *
 * Ninguna rama convierte la falta de información en `READY`, y ninguna afirma que falte un método de pago
 * cuando lo único cierto es que no podemos verlo.
 */
export function evaluarFacturacion(s: SenalesFacturacion): LecturaFacturacion {
  const r = (
    estado: EstadoFacturacion, observacion: ObservacionFacturacion, motivo: MotivoFacturacion,
    explicacion: string, requiereConfirmacionHumana = false,
  ): LecturaFacturacion => ({ estado, observacion, motivo, explicacion, requiereConfirmacionHumana });

  if (s.configuraciones === null || s.estadoCuenta === null) {
    return r('RETRY_LATER', 'RETRY_LATER', 'NO_SE_PUDO_CONSULTAR',
      'Todavía no pudimos comprobar el estado de tu cuenta de anuncios. Lo reintentamos solos.');
  }

  const estadoCuenta = s.estadoCuenta.trim().toUpperCase();
  if (CUENTA_NO_OPERATIVA.includes(estadoCuenta)) {
    return r('BLOCKED_EXTERNAL', 'ACCOUNT_BLOCKED', 'CUENTA_NO_OPERATIVA',
      'Tu cuenta de anuncios no está activa en Google. Eso sólo puede resolverlo Google; te avisamos en cuanto cambie.');
  }
  if (estadoCuenta !== 'ENABLED') {
    // `ENABLED` sirve para DESCARTAR cuentas muertas, jamás para afirmar que hay con qué pagar.
    return r('UNKNOWN', 'UNKNOWN', 'SIN_EVIDENCIA_SUFICIENTE',
      'No pudimos confirmar el estado de tu cuenta de anuncios.');
  }

  // FACTURACIÓN MENSUAL: el único régimen que la API deja observar. Aquí sí se puede concluir.
  if (s.configuraciones.includes('APPROVED')) {
    return r('READY', 'MONTHLY_INVOICING_READY', 'FACTURACION_MENSUAL_APROBADA',
      'La facturación de tu cuenta está aprobada en Google.');
  }
  if (s.configuraciones.includes('PENDING') || s.configuraciones.includes('APPROVED_HELD')) {
    return r('PENDING_PROVIDER', 'MONTHLY_INVOICING_PENDING', 'APROBACION_EN_CURSO',
      'Google está terminando de aprobar la facturación de tu cuenta. No hace falta que hagas nada más.');
  }

  // AUTOSERVICIO (tarjeta, PayPal, débito): la API NO lo expone. Lo único honesto es decirlo.
  const observacion: ObservacionFacturacion = s.configuraciones.includes('CANCELLED')
    ? 'MONTHLY_INVOICING_BLOCKED'
    : 'SELF_SERVICE_PAYMENT_UNVERIFIABLE';

  if (s.confirmacionHumanaVigente) {
    return r('READY', observacion, 'CONFIRMADO_POR_LA_PERSONA',
      'Nos confirmaste que el pago de tus anuncios está configurado en Google.');
  }
  return r('PAYMENT_SETUP_REQUIRED', observacion, 'PAGO_NO_VERIFICABLE_POR_API',
    'Google no permite que SOEC compruebe tu tarjeta o método de pago, así que no podemos saberlo por nuestra cuenta.',
    true);
}

/**
 * PUERTO CANÓNICO de preparación para facturar. SÓLO LECTURA por definición: no existe un verbo para
 * «configurar el pago», porque eso ocurre en el proveedor y lo hace una persona.
 */
export interface PuertoFacturacionPublicitaria {
  readonly nombre: string;
  inspeccionar(org: string): Promise<LecturaFacturacion>;
}

/**
 * ATESTACIÓN HUMANA. Lo que una persona confirma cuando la API no puede comprobarlo: «sí, el pago está
 * puesto». No contiene ni un dígito de ninguna tarjeta —no se le pide, no se guarda, no se transmite—, no es
 * un mandato financiero y no autoriza gasto alguno. Es un hecho fechado, atribuible y auditable, y nada más.
 *
 * Va atada a la CUENTA concreta: si la empresa cambia de cuenta de anuncios, lo confirmado sobre la anterior
 * deja de valer, porque era sobre otra cosa.
 */
export interface ConfirmacionDePago {
  readonly id: string;
  readonly organizationId: string;
  readonly proveedor: 'GOOGLE_ADS';
  readonly customerId: string;
  readonly actor: string;
  readonly confirmadoEn: string;
}

/**
 * A dónde se manda a la persona: la página de facturación de la propia interfaz de Google Ads, en un
 * anfitrión que la lista blanca ya permite. No se fabrica un enlace profundo no soportado.
 */
export const URL_FACTURACION_GOOGLE = 'https://ads.google.com/aw/billing/summary';
