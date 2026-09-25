/**
 * apps/api · VERIFICACIÓN DEL ANUNCIANTE · «Google necesita saber quién está detrás de estos anuncios».
 *
 * Google exige a los anunciantes completar programas de verificación —identidad, organización, anuncios
 * electorales en la UE— y, mientras no se cierran, la cuenta no sirve con normalidad. Es un bloqueo humano
 * puro: lo resuelve una persona con sus documentos, en el sitio de Google, y SOEC no puede ni debe hacerlo
 * por ella.
 *
 * ESO ÚLTIMO NO ES UNA LIMITACIÓN TÉCNICA, ES UNA LÍNEA. SOEC puede detectar, preparar, explicar y reanudar;
 * no puede **afirmar por otro**. Declarar una identidad, una afiliación legal, una representación de empresa
 * o la naturaleza política de un anuncio son actos con consecuencias jurídicas para quien los firma. Un
 * sistema que los automatice está falsificando una firma, por muy cómodo que resulte.
 *
 * Lo que sí se puede es MIRAR… cuando Google deja. Y resulta que en las cuentas de autoservicio no deja:
 * `GetIdentityVerification` responde `BILLING_NOT_ON_MONTHLY_INVOICING`, es decir, esa consulta está detrás
 * del mismo muro que la facturación por API. No es un fallo pasajero ni una negativa de permisos: es una
 * propiedad estable del régimen de pago de la cuenta, y hay que tratarla como tal —clasificarla, recordarla
 * y dejar de preguntar— en vez de reintentar cada cinco minutos contra una puerta cerrada.
 *
 * Cuando no se puede mirar, queda la única salida honesta: pedirle a la persona que lo haga y que nos lo
 * confirme. Su confirmación dice «completé lo que Google me pidió», y en ningún sitio se traduce a «Google
 * aprobó la empresa», porque eso no lo sabemos.
 */

export type EstadoVerificacionAnunciante =
  | 'ADVERTISER_VERIFICATION_READY'    // Google dice que está completa
  | 'ADVERTISER_VERIFICATION_REQUIRED' // Google dice que falta, y sólo puede hacerlo una persona
  | 'PENDING_PROVIDER'                 // la persona ya la envió y Google la está revisando
  | 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE' // Google NO deja consultarlo en esta cuenta: hace falta una persona
  | 'CONFIRMED_BY_USER'                // la persona confirmó que la completó. NO es «Google la aprobó»
  | 'RETRY_LATER'                      // no se pudo consultar por algo que puede pasarse
  | 'UNKNOWN';                         // se consultó y no alcanza para concluir

/** Estados del programa tal como los nombra Google. Vocabulario del proveedor: no sale a ninguna pantalla. */
export type EstadoProgramaGoogle = 'PENDING_USER_ACTION' | 'UNVERIFIED' | 'SUCCESS' | 'FAILED' | 'UNSPECIFIED' | 'UNKNOWN';

/**
 * POR QUÉ el estado es el que es. Existe porque su ausencia costó dos vueltas: `RETRY_LATER` no distinguía
 * entre «Google respondió una lista vacía», «devolvió 403» y «nos pasamos de cuota», y sin esa diferencia no
 * se puede ni arreglar ni explicar nada. Es vocabulario TÉCNICO y sanitizado: ni cuerpos crudos, ni
 * credenciales, ni identificadores del proveedor.
 */
export type DiagnosticoVerificacion =
  | 'PROVIDER_HTTP_ERROR'
  | 'EMPTY_PROGRAM_LIST'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'PROGRAM_PENDING_USER_ACTION'
  | 'PROGRAM_SUCCESS'
  | 'PROGRAM_FAILED'
  | 'NO_ACCOUNT_SELECTED'
  | 'NOT_QUERIED'
  /** Google rechaza la consulta por el régimen de facturación de la cuenta. Estable: no se reintenta. */
  | 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE'
  /** La persona confirmó que completó lo que Google le pidió. */
  | 'CONFIRMED_BY_USER'
  | 'UNKNOWN_PROVIDER_RESPONSE';

export interface LecturaVerificacion {
  readonly estado: EstadoVerificacionAnunciante;
  readonly explicacion: string;
  /** Fecha límite que impone Google, si la informó. Se muestra porque cambia la urgencia para la persona. */
  readonly fechaLimite: string | null;
  /** Diagnóstico técnico sanitizado. No se muestra a la persona; se publica para quien opera. */
  readonly diagnostico: DiagnosticoVerificacion;
  /** Cuántos programas devolvió el proveedor. `null` ⇒ no hubo respuesta utilizable. */
  readonly programas: number | null;
  /** Estado HTTP del proveedor, cuando lo hubo. Nunca su cuerpo. */
  readonly httpProveedor: number | null;
}

/** Lo observado. `null` en `programas` ⇒ no se pudo consultar (que no es «no hace falta nada»). */
export interface SenalesVerificacion {
  readonly programas: readonly { readonly estado: EstadoProgramaGoogle; readonly fechaLimite?: string | null }[] | null;
  /** Por qué no hubo programas, cuando fue por un fallo y no por una respuesta vacía. */
  readonly fallo?: { readonly diagnostico: DiagnosticoVerificacion; readonly httpProveedor?: number | null };
  /** `true` cuando Google no permite consultar la verificación en esta cuenta (régimen de facturación). */
  readonly noObservableEnEstaCuenta?: boolean;
  /** `true` cuando una persona confirmó que completó lo que Google le pidió PARA ESTA CUENTA. */
  readonly confirmadaPorLaPersona?: boolean;
}

/**
 * DE LO OBSERVADO AL ESTADO. Función pura.
 *
 * Sin programas devueltos, la cuenta no está sujeta a ninguna verificación pendiente: eso SÍ es una respuesta,
 * y distinta de no haber podido preguntar. La diferencia decide entre seguir el recorrido y quedarse quieto.
 */
export function evaluarVerificacion(s: SenalesVerificacion): LecturaVerificacion {
  /**
   * NO OBSERVABLE EN ESTA CUENTA. Manda sobre todo lo demás: si Google no deja preguntar, ningún otro dato
   * de esta lectura viene de Google. Lo único que puede cerrar el paso es que la persona lo confirme, y eso
   * se dice con su nombre —`CONFIRMED_BY_USER`— para que nadie lo lea nunca como una aprobación del proveedor.
   */
  if (s.noObservableEnEstaCuenta === true) {
    if (s.confirmadaPorLaPersona === true) {
      return {
        estado: 'CONFIRMED_BY_USER', fechaLimite: null, diagnostico: 'CONFIRMED_BY_USER', programas: null, httpProveedor: null,
        explicacion: 'Nos confirmaste que completaste la verificación que Google te pidió para esta cuenta.',
      };
    }
    return {
      estado: 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE', fechaLimite: null,
      diagnostico: 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE', programas: null, httpProveedor: null,
      explicacion: 'En este tipo de cuenta Google no permite que SOEC compruebe el estado de la verificación.',
    };
  }

  if (s.programas === null) {
    return {
      estado: 'RETRY_LATER', fechaLimite: null,
      explicacion: 'Todavía no pudimos comprobar si Google te pide verificar tu empresa. Lo reintentamos solos.',
      diagnostico: s.fallo?.diagnostico ?? 'NOT_QUERIED',
      programas: null,
      httpProveedor: s.fallo?.httpProveedor ?? null,
    };
  }
  /**
   * LISTA VACÍA ≠ VERIFICADO. La API sólo devuelve los programas que conoce para esa cuenta, y una cuenta
   * puede estar detenida en la interfaz de Google por una verificación que esta llamada no enumera. Leer el
   * silencio como un visto bueno sería inventar un `SUCCESS` que nadie dio — justo lo que no se puede hacer
   * cuando lo que viene después es gastar dinero. Se dice que no se sabe.
   */
  if (s.programas.length === 0) {
    return {
      estado: 'UNKNOWN', fechaLimite: null,
      explicacion: 'Google no nos informa de ninguna verificación pendiente, pero tampoco podemos confirmar que esté todo en regla.',
      diagnostico: 'EMPTY_PROGRAM_LIST', programas: 0, httpProveedor: 200,
    };
  }

  const limite = s.programas.map((p) => p.fechaLimite ?? null).find((f) => f !== null) ?? null;
  // Basta con que UNO esté pendiente para que la cuenta esté bloqueada: se manda lo peor, no el promedio.
  const comun = { programas: s.programas.length, httpProveedor: 200 as number | null };
  if (s.programas.some((p) => p.estado === 'PENDING_USER_ACTION' || p.estado === 'UNVERIFIED' || p.estado === 'FAILED')) {
    return {
      estado: 'ADVERTISER_VERIFICATION_REQUIRED', fechaLimite: limite, ...comun,
      explicacion: 'Google necesita verificar quién está detrás de los anuncios antes de que la cuenta funcione con normalidad.',
      diagnostico: s.programas.some((p) => p.estado === 'FAILED') ? 'PROGRAM_FAILED' : 'PROGRAM_PENDING_USER_ACTION',
    };
  }
  if (s.programas.every((p) => p.estado === 'SUCCESS')) {
    return {
      estado: 'ADVERTISER_VERIFICATION_READY', fechaLimite: null, ...comun,
      explicacion: 'Tu verificación con Google está completa.', diagnostico: 'PROGRAM_SUCCESS',
    };
  }
  // Estados que no sabemos interpretar: no se inventa ni un bloqueo ni un visto bueno.
  return {
    estado: 'UNKNOWN', fechaLimite: limite, ...comun,
    explicacion: 'No pudimos interpretar el estado de tu verificación con Google.', diagnostico: 'UNKNOWN_PROVIDER_RESPONSE',
  };
}

/**
 * ¿Sigue bloqueando la identidad el recorrido? Se pregunta así —y no con una lista de estados repartida por
 * el código— para que añadir un estado nuevo obligue a decidir aquí de qué lado cae.
 */
export function identidadBloquea(estado: EstadoVerificacionAnunciante): boolean {
  return estado === 'ADVERTISER_VERIFICATION_REQUIRED' || estado === 'SELF_SERVICE_VERIFICATION_UNOBSERVABLE';
}

/** Puerto de SÓLO LECTURA. No existe un verbo para «verificar»: eso lo hace una persona, en Google. */
export interface PuertoVerificacionAnunciante {
  readonly nombre: string;
  inspeccionar(org: string): Promise<LecturaVerificacion>;
}

/**
 * A dónde se manda a la persona. Google no publica un enlace profundo estable a la verificación, así que se
 * usa la superficie más cercana y estable de su interfaz —el resumen de la cuenta—, en un anfitrión que la
 * lista blanca ya permite. Inventar una URL no soportada sería peor que una de más.
 */
export const URL_VERIFICACION_GOOGLE = 'https://ads.google.com/aw/overview';
