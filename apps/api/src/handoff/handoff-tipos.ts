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
 * QUIÉN exige la tarea, frente a DÓNDE se nota. No son lo mismo y la diferencia es útil: entrar en la cuenta
 * de Google o pasar su verificación de identidad son exigencias de GOOGLE, no de Google Ads, y sirven igual
 * para cualquier canal suyo. El proveedor se DERIVA del canal —no se recibe— para que no puedan discrepar.
 */
export type ProveedorHandoff = 'GOOGLE' | 'META' | 'SOEC';

const PROVEEDOR_DE_CANAL: Readonly<Record<CanalHandoff, ProveedorHandoff>> = {
  GOOGLE_ADS: 'GOOGLE',
  META_ADS: 'META',
  SOEC: 'SOEC',
};

export function proveedorDeCanal(canal: CanalHandoff): ProveedorHandoff {
  return PROVEEDOR_DE_CANAL[canal];
}

/**
 * PRIORIDAD DETERMINISTA. No se ordena por fecha ni por «lo que parezca más urgente»: se ordena por la
 * dependencia real. No sirve de nada pedir el medio de pago a quien todavía no ha entrado en su cuenta.
 */
const ORDEN: Readonly<Record<TipoHandoff, number>> = {
  LOGIN_REQUIRED: 10,
  IDENTITY_VERIFICATION_REQUIRED: 20,
  TWO_FACTOR_REQUIRED: 30,
  OAUTH_CONSENT_REQUIRED: 40,
  ACCOUNT_PROVISIONING_REQUIRED: 50,
  TERMS_ACCEPTANCE_REQUIRED: 60,
  PAYMENT_SETUP_REQUIRED: 70,
  // Elegir cuenta va al final a propósito: es lo único de esta lista que se hace DENTRO de SOEC, y sólo
  // tiene sentido cuando ya existe una cuenta, hay términos aceptados y hay con qué pagar.
  ACCOUNT_SELECTION_REQUIRED: 80,
};

export function prioridadDe(tipo: TipoHandoff): number {
  return ORDEN[tipo];
}

/** La tarea, tal como se persiste. Ningún campo de aquí puede contener un secreto. */
export interface Handoff {
  readonly id: string;
  readonly organizationId: string;
  /** Quién lo exige. Derivado del canal, nunca recibido de fuera. */
  readonly proveedor: ProveedorHandoff;
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
  readonly canceladoEn: string | null;
}

export class HandoffInvalidoError extends Error {}

/**
 * Anfitriones a los que SOEC puede mandar a una persona, POR PROVEEDOR. Default-deny en dos sentidos: lo que
 * no está en la lista no se abre, y una dirección de Meta no vale para una tarea de Google.
 */
const HOSTS_POR_PROVEEDOR: Readonly<Record<ProveedorHandoff, readonly string[]>> = {
  GOOGLE: ['accounts.google.com', 'ads.google.com', 'business.google.com', 'payments.google.com'],
  META: ['business.facebook.com', 'www.facebook.com', 'adsmanager.facebook.com'],
  SOEC: [], // dentro de SOEC no se sale a ninguna parte: la acción ocurre aquí
};

/** Anfitriones que jamás son un proveedor: la máquina de uno mismo y las redes internas. */
function esAnfitrionPrivado(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '0.0.0.0') return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4 === null) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/**
 * Valida a dónde se manda a la persona. Un handoff es, literalmente, un botón que la saca de SOEC: si esa
 * dirección pudiera fijarla cualquiera, sería una puerta de phishing con nuestro nombre encima. Sólo https,
 * sólo anfitriones conocidos DEL PROVEEDOR de la tarea, sin credenciales embebidas.
 *
 * `javascript:`, `data:`, `file:` y compañía mueren en el filtro de esquema; localhost y las redes privadas,
 * en el de anfitrión privado —que se comprueba aparte de la lista blanca justamente para que añadir una
 * entrada a esa lista no pueda abrir, de rebote, una puerta a la red interna.
 */
export function urlDeProveedorValida(url: string | null | undefined, proveedor: ProveedorHandoff = 'GOOGLE'): string | null {
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
  if (esAnfitrionPrivado(host)) throw new HandoffInvalidoError('la dirección del proveedor no puede apuntar a una red interna');
  if (!HOSTS_POR_PROVEEDOR[proveedor].includes(host)) throw new HandoffInvalidoError(`SOEC no envía a nadie a «${host}»`);
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
  /**
   * Canal al que pertenece la tarea. NO se pinta: sirve para que la pantalla sepa qué otra tarjeta debe
   * callarse mientras esta tarea es la próxima acción. Un dato para decidir, no para mostrar.
   */
  readonly canal: CanalHandoff;
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
    canal: h.canal,
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
 * CONTRATO DEL VERIFICADOR.
 *
 * La idea que sostiene todo el diseño: la persona NO marca la tarea como hecha. Sale, hace lo suyo en el
 * proveedor, y SOEC lo comprueba contra el mundo real. Decir «ya lo hice» no es lo mismo que haberlo hecho, y
 * el sistema no puede confundir las dos cosas sin volver a inventarse la realidad.
 *
 * Cuatro veredictos, y ninguno es «no sé, dalo por bueno»:
 *
 *   · `COMPLETED`        el mundo cambió y se puede comprobar ⇒ la tarea se cierra y el recorrido sigue.
 *   · `STILL_REQUIRED`   se comprobó y sigue faltando ⇒ la tarea se queda, sin ruido.
 *   · `BLOCKED_EXTERNAL` el proveedor no permite avanzar hoy ⇒ se dice, y no se le echa la culpa a nadie.
 *   · `RETRY_LATER`      NO se pudo comprobar ⇒ no se concluye nada. Éste es el veredicto de la ignorancia,
 *                        y existe para que «no pude preguntar» no se confunda nunca con «no está hecho».
 */
export type ResultadoVerificacion = 'COMPLETED' | 'STILL_REQUIRED' | 'BLOCKED_EXTERNAL' | 'RETRY_LATER';

export interface VeredictoHandoff {
  readonly resultado: ResultadoVerificacion;
  /** Por qué. Se audita, así que va en lenguaje entendible y sin secretos. */
  readonly detalle: string;
  readonly referenciaProveedor?: string | null;
}

export interface VerificadorHandoff {
  readonly nombre: string;
  /** ¿Este verificador sabe comprobar esta tarea? */
  soporta(h: Handoff): boolean;
  /** Comprueba la condición EXTERNA. Sólo `COMPLETED` cierra la tarea, y sólo si se pudo comprobar. */
  verificar(h: Handoff): Promise<VeredictoHandoff>;
}
