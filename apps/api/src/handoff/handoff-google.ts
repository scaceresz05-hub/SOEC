/**
 * apps/api · HANDOFF EXTERNO · qué le falta a una empresa para tener publicidad en Google, dicho como tarea.
 *
 * Función PURA: recibe el estado real —conexión del proveedor, cuentas descubiertas, conexión en el SSOT— y
 * devuelve la tarea que corresponde, o ninguna. No consulta, no escribe y no adivina: si no sabe cuántas
 * cuentas hay, no inventa que no hay ninguna.
 *
 * Aquí se decide también el idioma. Lo que la persona lee no menciona `ACCOUNT_SELECTION_PENDING`, ni el
 * identificador de cliente, ni el MCC, ni el token de desarrollador. Menciona lo que le falta y lo que puede
 * hacer al respecto. Todo lo demás es asunto nuestro.
 */
import type { CanalHandoff, TipoHandoff } from './handoff-tipos';
import type { EstadoCapacidad } from '../provisionamiento/provisionamiento-tipos';

/** Lo que este módulo pide abrir. El servicio le pone id, fechas y estado. */
export interface IntencionHandoff {
  readonly canal: CanalHandoff;
  readonly tipo: TipoHandoff;
  readonly causa: string;
  readonly instruccion: string;
  readonly motivo: string;
  readonly etiquetaAccion: string;
  readonly urlProveedor: string | null;
  readonly metadata?: Record<string, unknown>;
  /** `true` ⇒ hoy no se puede avanzar por una razón del proveedor, no por desidia de nadie. */
  readonly bloqueadaFuera?: boolean;
}

export interface EstadoGoogleParaHandoff {
  /** Estado del ciclo OAuth del proveedor. `null` ⇒ la empresa nunca empezó. */
  readonly estadoProveedor: string | null;
  /** Cuentas accesibles descubiertas en la última consulta. `null` ⇒ todavía no se ha mirado. */
  readonly cuentasAccesibles: number | null;
  /** ¿Hay ya una cuenta elegida y escrita en el SSOT operativo? */
  readonly cuentaEnElSsot: boolean;
  /**
   * ¿Puede SOEC crear la cuenta por su cuenta? (Fase I.5.) Ausente ⇒ no se evaluó, y entonces se conserva el
   * comportamiento anterior: pedirle a la persona que la cree. No saber nunca debe ahorrar un paso.
   */
  readonly capacidadProvisionamiento?: EstadoCapacidad;
}

/**
 * QUÉ HACER con las tareas del canal. Tres respuestas, no dos, porque «no falta nada» y «no lo sé» no pueden
 * compartir valor: la primera cierra la tarea abierta, la segunda NO puede tocarla. Cuando el proveedor no
 * contesta, la conclusión correcta es ninguna.
 */
export type DecisionGoogle =
  | { readonly accion: 'ABRIR'; readonly intencion: IntencionHandoff }
  | { readonly accion: 'CERRAR' }
  | { readonly accion: 'ESPERAR' };

/** URL oficial donde se crea una cuenta de Google Ads. Es la única salida honesta mientras no haya MCC. */
const ALTA_DE_CUENTA = 'https://ads.google.com/nav/selectaccount';

/**
 * Traduce el estado de Google a UNA tarea. El orden de las ramas es el de la dependencia real: sin
 * autorización no tiene sentido hablar de cuentas, y sin cuenta no tiene sentido hablar de elegir una.
 */
export function handoffDeGoogle(e: EstadoGoogleParaHandoff): IntencionHandoff | null {
  const canal: CanalHandoff = 'GOOGLE_ADS';

  // 1. NO HAY AUTORIZACIÓN, o la que había dejó de servir.
  if (e.estadoProveedor === null || e.estadoProveedor === 'NOT_CONNECTED' || e.estadoProveedor === 'DISCONNECTED') {
    return {
      canal, tipo: 'OAUTH_CONSENT_REQUIRED', causa: 'sin-autorizacion',
      instruccion: 'Autoriza a SOEC a ver tu publicidad en Google',
      motivo: 'Sin ese permiso no podemos mirar tus campañas ni preparar nada. Autorizar no le permite a SOEC cambiar nada ni gastar.',
      etiquetaAccion: 'Conectar con Google', urlProveedor: null, // la inicia SOEC, no se sale a una URL fija
    };
  }
  if (e.estadoProveedor === 'NEEDS_REAUTH') {
    return {
      canal, tipo: 'OAUTH_CONSENT_REQUIRED', causa: 'autorizacion-caducada',
      instruccion: 'Google necesita que vuelvas a autorizar el acceso',
      motivo: 'La autorización anterior dejó de ser válida. Tus datos históricos están conservados.',
      etiquetaAccion: 'Volver a autorizar', urlProveedor: null,
    };
  }
  if (e.estadoProveedor === 'OAUTH_PENDING') {
    return {
      canal, tipo: 'OAUTH_CONSENT_REQUIRED', causa: 'autorizacion-a-medias',
      instruccion: 'Termina de autorizar el acceso con Google',
      motivo: 'La conexión quedó a medias. Se puede retomar cuando quieras.',
      etiquetaAccion: 'Continuar con Google', urlProveedor: null,
    };
  }

  // 2. HAY AUTORIZACIÓN. Si la cuenta ya está elegida y escrita, no falta nada por este lado.
  if (e.cuentaEnElSsot) return null;

  // Todavía no se han mirado las cuentas: no se afirma que no existan.
  if (e.cuentasAccesibles === null) {
    return {
      canal, tipo: 'ACCOUNT_SELECTION_REQUIRED', causa: 'cuenta-sin-elegir',
      instruccion: 'Elige en qué cuenta de publicidad debe trabajar SOEC',
      motivo: 'Tu cuenta de Google ya está autorizada. Falta decir dónde queremos trabajar.',
      etiquetaAccion: 'Elegir cuenta', urlProveedor: null,
    };
  }

  // 3. AUTORIZADO Y SIN NINGUNA CUENTA: hay que crear una, y hoy eso ocurre en Google.
  if (e.cuentasAccesibles === 0) {
    return {
      canal, tipo: 'ACCOUNT_PROVISIONING_REQUIRED', causa: 'sin-cuenta-de-anuncios',
      instruccion: 'Crea tu cuenta de anuncios en Google',
      motivo: 'Google ya está autorizado, pero todavía no encontramos una cuenta de anuncios donde SOEC pueda trabajar. Se crea una vez, en Google, y después seguimos nosotros.',
      etiquetaAccion: 'Continuar con Google', urlProveedor: ALTA_DE_CUENTA,
      metadata: { cuentasAccesibles: 0 },
    };
  }

  // 4. HAY CUENTAS Y NINGUNA ELEGIDA.
  return {
    canal, tipo: 'ACCOUNT_SELECTION_REQUIRED', causa: 'cuenta-sin-elegir',
    instruccion: 'Elige en qué cuenta de publicidad debe trabajar SOEC',
    motivo: `Tu cuenta de Google está autorizada y encontramos ${e.cuentasAccesibles} cuenta(s). Falta decir en cuál trabajamos.`,
    etiquetaAccion: 'Elegir cuenta', urlProveedor: null,
    metadata: { cuentasAccesibles: e.cuentasAccesibles },
  };
}

/**
 * DECISIÓN COMPLETA del canal, ya con la capacidad de provisionamiento de la Fase I.5 encima.
 *
 * La regla nueva y la razón de toda la fase: si SOEC puede crear la cuenta, **no se le pide a nadie que la
 * cree**. Pedir algo que uno mismo puede hacer es la forma educada de no hacerlo. Y al revés: si no se pudo
 * averiguar si podemos, no se toca nada — la tarea que hubiera sigue donde está.
 */
export function decidirHandoffGoogle(e: EstadoGoogleParaHandoff): DecisionGoogle {
  const capacidad = e.capacidadProvisionamiento;
  const sinCuentas = e.cuentasAccesibles === 0 && !e.cuentaEnElSsot
    && (e.estadoProveedor === 'ACCOUNT_SELECTION_PENDING' || e.estadoProveedor === 'CONNECTED');

  if (sinCuentas && capacidad !== undefined) {
    // No se sabe si podemos: no se concluye nada. Ni se abre una tarea, ni se cierra la que hubiera.
    if (capacidad === 'RETRY_LATER') return { accion: 'ESPERAR' };

    // Podemos crearla: la persona no tiene nada que hacer aquí.
    if (capacidad === 'AUTOMATABLE') return { accion: 'CERRAR' };

    if (capacidad === 'BLOCKED_EXTERNAL') {
      return {
        accion: 'ABRIR',
        intencion: {
          canal: 'GOOGLE_ADS', tipo: 'ACCOUNT_PROVISIONING_REQUIRED', causa: 'sin-cuenta-de-anuncios',
          instruccion: 'Falta una cuenta de anuncios y hoy no podemos crearla',
          motivo: 'Google no nos permite crear la cuenta por ahora y tampoco encontramos ninguna disponible. No es algo que puedas resolver tú: te avisamos en cuanto se pueda.',
          etiquetaAccion: 'Entendido', urlProveedor: null, bloqueadaFuera: true,
          metadata: { cuentasAccesibles: 0 },
        },
      };
    }
  }

  const intencion = handoffDeGoogle(e);
  return intencion === null ? { accion: 'CERRAR' } : { accion: 'ABRIR', intencion };
}

/** Tipos que este canal gestiona: al cambiar el estado, lo que ya no aplica se cancela en bloque. */
export const TIPOS_DE_GOOGLE: readonly TipoHandoff[] = [
  'OAUTH_CONSENT_REQUIRED', 'ACCOUNT_PROVISIONING_REQUIRED', 'ACCOUNT_SELECTION_REQUIRED',
];
