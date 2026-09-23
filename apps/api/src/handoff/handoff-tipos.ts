/**
 * apps/api · HANDOFF EXTERNO · «SOEC llegó hasta aquí; ahora Google necesita que hagas una cosa».
 *
 * Hasta ahora el sistema sabía decir que algo faltaba —`ACTION_REQUIRED` en los prerrequisitos, ítems del
 * informe de preparación—, pero todo eso son READ MODELS: se calculan al mirar y desaparecen al dejar de
 * mirar. No existía la otra mitad: una TAREA que vive, que se puede seguir, que sabe a qué proveedor pertenece
 * y que alguien —un verificador, no la persona— puede dar por cumplida para que el recorrido siga solo.
 *
 * Eso es lo que este módulo declara. Tres reglas que lo mantienen honesto:
 *
 *  1. UNA COSA A LA VEZ. Aunque haya siete bloqueos, a la persona se le pide uno, el primero por dependencia.
 *     Una lista de diez cosas pendientes no es transparencia: es abandonarla con más información.
 *  2. AQUÍ NO VIVE NINGÚN SECRETO. Ni tokens, ni contraseñas, ni datos de tarjeta. Sólo el estado de la tarea
 *     y, como mucho, una referencia opaca que el proveedor entienda.
 *  3. COMPLETAR UNA TAREA NO AUTORIZA NADA. Terminar el alta de una cuenta no enciende permisos, no crea
 *     mandato y no enciende campañas: sólo desbloquea el paso que estaba esperando.
 */

/** Qué está esperando SOEC. El orden de la lista es el orden en que se resuelven en la vida real. */
export type TipoHandoff =
  | 'LOGIN_REQUIRED'              // hay que iniciar sesión en el proveedor
  | 'TWO_FACTOR_REQUIRED'         // el proveedor pide su segundo factor
  | 'IDENTITY_VERIFICATION_REQUIRED' // el proveedor exige verificar identidad del negocio
  | 'OAUTH_CONSENT_REQUIRED'      // falta autorizar (o volver a autorizar) el acceso
  | 'ACCOUNT_PROVISIONING_REQUIRED' // no existe una cuenta de anuncios utilizable: hay que crearla
  | 'ACCOUNT_SELECTION_REQUIRED'  // hay cuentas y falta decir en cuál trabaja SOEC
  | 'TERMS_ACCEPTANCE_REQUIRED'   // faltan términos que sólo puede aceptar una persona
  | 'PAYMENT_SETUP_REQUIRED';     // falta el medio de pago, en el flujo del proveedor

export type EstadoHandoff =
  | 'OPEN'             // creada y esperando a que alguien la haga
  | 'WAITING_EXTERNAL' // la persona ya salió al proveedor; se espera que el mundo cambie
  | 'COMPLETED'        // un verificador comprobó que la condición se cumple
  | 'EXPIRED'          // venció sin cumplirse; se vuelve a abrir si la condición sigue
  | 'CANCELLED'        // dejó de tener sentido (p. ej. el negocio desconectó el canal)
  | 'BLOCKED_EXTERNAL'; // el proveedor no permite avanzar hoy; no es culpa de nadie ni se puede forzar

export const ESTADOS_ABIERTOS: readonly EstadoHandoff[] = ['OPEN', 'WAITING_EXTERNAL', 'BLOCKED_EXTERNAL'];

export type CanalHandoff = 'GOOGLE_ADS' | 'META_ADS' | 'SOEC';

/**
 * PRIORIDAD DETERMINISTA. No se ordena por fecha ni por «lo que parezca más urgente»: se ordena por la
 * dependencia real. No sirve de nada pedir el medio de pago a quien todavía no ha entrado en su cuenta.
 */
const ORDEN: Readonly<Record<TipoHandoff, number>> = {
  LOGIN_REQUIRED: 10,
  TWO_FACTOR_REQUIRED: 20,
  IDENTITY_VERIFICATION_REQUIRED: 30,
  OAUTH_CONSENT_REQUIRED: 40,
  ACCOUNT_PROVISIONING_REQUIRED: 50,
  ACCOUNT_SELECTION_REQUIRED: 60,
  TERMS_ACCEPTANCE_REQUIRED: 70,
  PAYMENT_SETUP_REQUIRED: 80,
};

export function prioridadDe(tipo: TipoHandoff): number {
  return ORDEN[tipo];
}

/** La tarea, tal como se persiste. Ningún campo de aquí puede contener un secreto. */
export interface Handoff {
  readonly id: string;
  readonly organizationId: string;
  readonly canal: CanalHandoff;
  readonly tipo: TipoHandoff;
  readonly estado: EstadoHandoff;
  /** Clave de la CAUSA: dos tareas con la misma causa son la misma tarea, no dos. */
  readonly causa: string;
  /** Qué falta, en una frase que se entiende sin saber nada de publicidad. */
  readonly instruccion: string;
  /** Por qué hace falta. Sin esto, pedir algo es dar una orden. */
  readonly motivo: string;
  /** A dónde lleva el botón. `null` cuando la acción ocurre dentro de SOEC. */
  readonly urlProveedor: string | null;
  /** Texto del único botón. */
  readonly etiquetaAccion: string;
  /** Referencia OPACA del proveedor (id de una solicitud, de un alta…). Nunca una credencial. */
  readonly referenciaProveedor: string | null;
  /** Datos de apoyo, públicos y verificados: nunca secretos. */
  readonly metadata: Record<string, unknown>;
  readonly creadoEn: string;
  readonly actualizadoEn: string;
  readonly expiraEn: string | null;
  readonly completadoEn: string | null;
}

export class HandoffInvalidoError extends Error {}

/** Anfitriones a los que SOEC puede mandar a una persona. Default-deny: lo que no está, no se abre. */
const HOSTS_PERMITIDOS: readonly string[] = [
  'accounts.google.com', 'ads.google.com', 'business.google.com', 'payments.google.com',
  'business.facebook.com', 'www.facebook.com', 'adsmanager.facebook.com',
];

/**
 * Valida a dónde se manda a la persona. Un handoff es, literalmente, un botón que la saca de SOEC: si esa
 * dirección pudiera fijarla cualquiera, sería una puerta de phishing con nuestro nombre encima. Sólo https,
 * sólo anfitriones conocidos, sin credenciales embebidas.
 */
export function urlDeProveedorValida(url: string | null | undefined): string | null {
  if (url === null || url === undefined || String(url).trim() === '') return null;
  let u: URL;
  try {
    u = new URL(String(url).trim());
  } catch {
    throw new HandoffInvalidoError('la dirección del proveedor no es válida');
  }
  if (u.protocol !== 'https:') throw new HandoffInvalidoError('la dirección del proveedor debe usar https');
  if (u.username !== '' || u.password !== '') throw new HandoffInvalidoError('la dirección del proveedor no puede llevar credenciales');
  const host = u.hostname.toLowerCase();
  if (!HOSTS_PERMITIDOS.includes(host)) throw new HandoffInvalidoError(`SOEC no envía a nadie a «${host}»`);
  return u.toString();
}

/** Nombres que jamás deben viajar en la metadata de una tarea. Se comprueba por clave y por valor. */
const PROHIBIDO = /(token|secret|password|contrase|refresh|authorization|api[_-]?key|pan\b|cvv|card[_-]?number)/i;

/**
 * Deja la metadata en lo que es seguro guardar. No sanea a escondidas: si alguien intenta meter un secreto,
 * falla. Un fallo ruidoso en desarrollo es infinitamente mejor que una credencial guardada en claro.
 */
export function metadataSegura(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const m = metadata ?? {};
  for (const [k, v] of Object.entries(m)) {
    if (PROHIBIDO.test(k)) throw new HandoffInvalidoError(`«${k}» no puede guardarse en una tarea pendiente`);
    if (typeof v === 'string' && (v.startsWith('secretstore:') || v.startsWith('Bearer ') || PROHIBIDO.test(v))) {
      throw new HandoffInvalidoError(`el valor de «${k}» parece un secreto y no puede guardarse`);
    }
  }
  return m;
}

/** Lo que la interfaz necesita para pintar UNA tarea. Sin ids internos ni nombres de estado. */
export interface TareaVisible {
  readonly id: string;
  readonly titulo: string;
  readonly motivo: string;
  readonly etiquetaAccion: string;
  readonly urlProveedor: string | null;
  /** `true` cuando la persona ya salió al proveedor y estamos esperando. */
  readonly esperando: boolean;
  /** `true` cuando hoy no se puede avanzar por una razón del proveedor. */
  readonly bloqueadaFuera: boolean;
}

export function aTareaVisible(h: Handoff): TareaVisible {
  return {
    id: h.id,
    titulo: h.instruccion,
    motivo: h.motivo,
    etiquetaAccion: h.etiquetaAccion,
    urlProveedor: h.urlProveedor,
    esperando: h.estado === 'WAITING_EXTERNAL',
    bloqueadaFuera: h.estado === 'BLOCKED_EXTERNAL',
  };
}

/** De todas las tareas abiertas, la que toca hacer AHORA. `null` si no hay ninguna. */
export function tareaPrincipal(handoffs: readonly Handoff[]): Handoff | null {
  const abiertas = handoffs.filter((h) => ESTADOS_ABIERTOS.includes(h.estado));
  if (abiertas.length === 0) return null;
  return [...abiertas].sort((a, b) => prioridadDe(a.tipo) - prioridadDe(b.tipo) || a.creadoEn.localeCompare(b.creadoEn))[0]!;
}

/**
 * CONTRATO DEL VERIFICADOR (Fase I.3 declara el puerto; los verificadores automáticos llegan después).
 *
 * La idea que sostiene todo el diseño: la persona NO marca la tarea como hecha. Sale, hace lo suyo en el
 * proveedor, y SOEC lo comprueba contra el mundo real. Decir «ya lo hice» no es lo mismo que haberlo hecho, y
 * el sistema no puede confundir las dos cosas sin volver a inventarse la realidad.
 */
export interface VerificadorHandoff {
  readonly nombre: string;
  /** ¿Este verificador sabe comprobar esta tarea? */
  soporta(h: Handoff): boolean;
  /**
   * Comprueba la condición EXTERNA. `cumplida: true` ⇒ el servicio cierra la tarea, recalcula la preparación
   * y el recorrido sigue. Nunca devuelve `true` por suposición: si no se puede comprobar, es `false` con motivo.
   */
  verificar(h: Handoff): Promise<{ readonly cumplida: boolean; readonly detalle: string; readonly referenciaProveedor?: string | null }>;
}
