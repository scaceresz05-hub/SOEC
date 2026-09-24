/**
 * apps/api · HANDOFF EXTERNO · los verificadores: quién decide que una tarea ya está hecha.
 *
 * La regla que sostiene esta fase: **la persona no cierra la tarea; el mundo la cierra**. Aquí viven los
 * comprobadores que preguntan al estado real y devuelven uno de cuatro veredictos. El único que cierra es
 * `COMPLETED`, y sólo se emite cuando se pudo mirar y lo que se vio lo confirma.
 *
 * El veredicto que de verdad protege es `RETRY_LATER`: significa «no pude preguntar». Sin él, la tentación es
 * tratar la falta de respuesta como «no está hecho» —y hacer repetir a la persona algo que ya hizo— o como
 * «está hecho», y seguir adelante sobre una suposición. Ninguna de las dos es aceptable.
 *
 * Para los tipos que todavía no sabemos observar —pago, términos, identidad, login, segundo factor— hay un
 * adaptador PENDIENTE explícito: responde `RETRY_LATER` con su motivo. Deja constancia de que el hueco existe
 * y garantiza que nada se cierra por descuido mientras el hueco siga ahí.
 */
import type { EstadoGoogleParaHandoff } from './handoff-google';
import type { Handoff, TipoHandoff, VerificadorHandoff, VeredictoHandoff } from './handoff-tipos';

/** Estados del ciclo OAuth en los que la autorización ya sirve para trabajar. */
const AUTORIZACION_VIVA = ['ACCOUNT_SELECTION_PENDING', 'CONNECTED'];

/** Lee el estado real del proveedor para UNA empresa. `null` ⇒ no se pudo saber (no «no hay»). */
export type LectorEstadoGoogle = (org: string) => Promise<EstadoGoogleParaHandoff | null>;

/**
 * Verificadores del canal de Google, construidos sobre el MISMO lector de estado que usa la sincronización.
 * Una sola fuente: si algún día discrepan la tarea que se abre y el veredicto que la cierra, será porque el
 * mundo cambió en medio, no porque cada mitad mire a un sitio distinto.
 */
export function verificadoresDeGoogle(leer: LectorEstadoGoogle): readonly VerificadorHandoff[] {
  /** Sin poder leer el estado no se concluye nada: ni cerrar, ni insistir. */
  const conEstado = async (org: string, fn: (e: EstadoGoogleParaHandoff) => VeredictoHandoff): Promise<VeredictoHandoff> => {
    let estado: EstadoGoogleParaHandoff | null;
    try {
      estado = await leer(org);
    } catch {
      return { resultado: 'RETRY_LATER', detalle: 'no se pudo leer el estado del proveedor' };
    }
    if (estado === null) return { resultado: 'RETRY_LATER', detalle: 'el estado del proveedor no está disponible' };
    return fn(estado);
  };

  const deGoogle = (tipo: TipoHandoff) => (h: Handoff): boolean => h.canal === 'GOOGLE_ADS' && h.tipo === tipo;
  const autorizada = (e: EstadoGoogleParaHandoff): boolean => e.estadoProveedor !== null && AUTORIZACION_VIVA.includes(e.estadoProveedor);

  return [
    {
      nombre: 'google-autorizacion',
      soporta: deGoogle('OAUTH_CONSENT_REQUIRED'),
      verificar: async (h) => conEstado(h.organizationId, (e) => (autorizada(e)
        ? { resultado: 'COMPLETED', detalle: 'la autorización con Google está vigente' }
        : { resultado: 'STILL_REQUIRED', detalle: 'la autorización con Google no está vigente' })),
    },
    {
      nombre: 'google-alta-de-cuenta',
      soporta: deGoogle('ACCOUNT_PROVISIONING_REQUIRED'),
      verificar: async (h) => conEstado(h.organizationId, (e) => {
        // Sin autorización no se puede afirmar nada sobre las cuentas: se vuelve a mirar más tarde.
        if (!autorizada(e)) return { resultado: 'RETRY_LATER', detalle: 'sin autorización vigente no se pueden ver las cuentas' };
        // `null` es «no lo hemos mirado», no «no hay»: cerrar o insistir aquí sería inventar.
        if (e.cuentasAccesibles === null) return { resultado: 'RETRY_LATER', detalle: 'todavía no se pudo consultar cuántas cuentas hay' };
        if (e.cuentasAccesibles > 0) return { resultado: 'COMPLETED', detalle: `ya existe al menos una cuenta de anuncios (${e.cuentasAccesibles})` };
        return { resultado: 'STILL_REQUIRED', detalle: 'sigue sin haber ninguna cuenta de anuncios accesible' };
      }),
    },
    {
      nombre: 'google-cuenta-elegida',
      soporta: deGoogle('ACCOUNT_SELECTION_REQUIRED'),
      verificar: async (h) => conEstado(h.organizationId, (e) => {
        if (e.cuentaEnElSsot) return { resultado: 'COMPLETED', detalle: 'la cuenta elegida ya está escrita donde el motor la lee' };
        if (!autorizada(e)) return { resultado: 'RETRY_LATER', detalle: 'sin autorización vigente no hay nada que elegir todavía' };
        return { resultado: 'STILL_REQUIRED', detalle: 'falta decir en qué cuenta debe trabajar SOEC' };
      }),
    },
  ];
}

/**
 * ADAPTADOR PENDIENTE. Para los tipos que todavía no sabemos observar. No miente en ninguna dirección: no
 * cierra la tarea y tampoco afirma que siga faltando. Cuando exista el verificador de verdad, se sustituye.
 */
export function verificadorPendiente(tipos: readonly TipoHandoff[], porQue: string): VerificadorHandoff {
  return {
    nombre: `pendiente:${tipos.join(',')}`,
    soporta: (h: Handoff) => tipos.includes(h.tipo),
    verificar: async () => ({ resultado: 'RETRY_LATER', detalle: porQue }),
  };
}

/** Los huecos conocidos de esta fase, dichos en voz alta en vez de escondidos en un `default`. */
export const VERIFICADORES_PENDIENTES: readonly VerificadorHandoff[] = [
  verificadorPendiente(['PAYMENT_SETUP_REQUIRED'], 'SOEC todavía no sabe comprobar el medio de pago del proveedor'),
  verificadorPendiente(['TERMS_ACCEPTANCE_REQUIRED'], 'SOEC todavía no sabe comprobar la aceptación de términos'),
  verificadorPendiente(['IDENTITY_VERIFICATION_REQUIRED'], 'SOEC todavía no sabe comprobar la verificación de identidad'),
  verificadorPendiente(['LOGIN_REQUIRED', 'TWO_FACTOR_REQUIRED'], 'el acceso a la cuenta del proveedor no es observable desde SOEC'),
];
