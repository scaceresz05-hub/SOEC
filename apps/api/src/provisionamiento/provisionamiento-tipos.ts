/**
 * apps/api · PROVISIONAMIENTO DE CUENTA PUBLICITARIA (Autonomy Fase I.5) · el puerto y sus reglas.
 *
 * La pregunta que responde este módulo no es «¿sabemos crear cuentas?», sino una mucho más honesta:
 * **¿puede SOEC crear ESTA cuenta, con ESTAS credenciales, hoy?** Son cosas distintas, y confundirlas es la
 * forma más rápida de prometerle a alguien que nos ocupamos de algo que el proveedor no nos deja hacer.
 *
 * Por eso la capacidad no es un booleano. Cuatro estados, porque hay cuatro situaciones realmente distintas:
 *
 *   · `AUTOMATABLE`                  la topología y las credenciales permiten intentarlo.
 *   · `HUMAN_PROVIDER_STEP_REQUIRED` falta un paso que sólo una persona puede dar en el proveedor.
 *   · `BLOCKED_EXTERNAL`             el proveedor no lo permite hoy; no es culpa de nadie ni se puede forzar.
 *   · `RETRY_LATER`                  no se pudo averiguar. No es «no se puede»: es «no sé», y no se decide.
 *
 * Y una regla que atraviesa todo el archivo: **crear una cuenta no es permiso para gastar**. Provisionar deja
 * lista la casa; quién puede entrar, cuánto puede comprometer y qué puede encender se autoriza aparte.
 */
import { monedaValida, normalizarMoneda } from '../dinero';

export type EstadoCapacidad = 'AUTOMATABLE' | 'HUMAN_PROVIDER_STEP_REQUIRED' | 'BLOCKED_EXTERNAL' | 'RETRY_LATER';

/**
 * Por qué. Cada motivo nombra un hecho comprobable, no una impresión: sirve para auditar la decisión y para
 * explicársela a alguien sin decirle «no se puede» a secas.
 */
export type MotivoCapacidad =
  | 'MANAGER_ELEGIBLE_DISPONIBLE'      // hay una cuenta administradora utilizable: se puede intentar
  | 'SIN_MANAGER_ACCESIBLE'            // Google exige crear la cuenta DESDE una administradora, y no hay ninguna
  | 'AUTORIZACION_NO_VIGENTE'          // la autorización caducó o nunca se completó
  | 'SIN_ACCESO_DE_API'                // este despliegue no tiene acceso de API al proveedor
  | 'DATOS_DEL_NEGOCIO_INCOMPLETOS'    // faltan nombre, moneda o zona horaria, y no se inventan
  | 'PROVEEDOR_NO_LO_PERMITE'          // el proveedor rechazó la operación por política
  | 'NO_SE_PUDO_CONSULTAR';            // no hubo respuesta utilizable del proveedor

export interface CapacidadProvisionamiento {
  readonly estado: EstadoCapacidad;
  readonly motivo: MotivoCapacidad;
  /** Explicación en lenguaje de negocio. Nunca menciona MCC, developer token ni customer id. */
  readonly explicacion: string;
  /** Administradora desde la que se crearía la cuenta. `null` cuando no hay ninguna utilizable. */
  readonly managerCustomerId: string | null;
}

/** Los hechos con los que se decide. Se reciben; este módulo no consulta a nadie. */
export interface HechosDeCapacidad {
  /** Estado del ciclo de autorización del proveedor. `null` ⇒ nunca se autorizó. */
  readonly estadoProveedor: string | null;
  /** Cuentas accesibles con esta autorización. `null` ⇒ no se pudo mirar (que no es «no hay»). */
  readonly cuentas: readonly CuentaAccesible[] | null;
  /** ¿Tiene este despliegue acceso de API al proveedor? */
  readonly accesoDeApi: boolean;
  /** Datos del negocio para dar de alta la cuenta. `null` ⇒ incompletos. */
  readonly datosDeCuenta: DatosDeCuenta | null;
}

export interface CuentaAccesible {
  readonly customerId: string;
  readonly manager: boolean;
  readonly testAccount: boolean;
}

/** Lo mínimo que Google exige para dar de alta una cuenta. Todo sale del negocio; nada se inventa. */
export interface DatosDeCuenta {
  readonly nombre: string;
  /** ISO 4217 en mayúsculas. */
  readonly moneda: string;
  /** Zona horaria IANA, tal como la declaró el negocio. */
  readonly zonaHoraria: string;
}

const AUTORIZACION_VIGENTE = ['ACCOUNT_SELECTION_PENDING', 'CONNECTED'];

/**
 * DATOS DE LA CUENTA A PARTIR DEL NEGOCIO. Fail closed: si falta el nombre, la moneda o la zona horaria,
 * devuelve `null` y nadie sigue adelante. La moneda sale de lo que declaró la empresa —nunca se deduce del
 * país—, porque una cuenta de anuncios nace con su moneda y esa decisión no se deshace.
 */
export function datosDeCuentaDesdeNegocio(perfil: { displayName?: string | null; currency?: string | null; timezone?: string | null } | null): DatosDeCuenta | null {
  if (perfil === null) return null;
  const nombre = (perfil.displayName ?? '').trim();
  const moneda = normalizarMoneda(perfil.currency ?? '');
  const zonaHoraria = (perfil.timezone ?? '').trim();
  if (nombre === '' || moneda === null || !monedaValida(moneda) || zonaHoraria === '') return null;
  return { nombre, moneda, zonaHoraria };
}

/**
 * ¿PUEDE SOEC CREAR LA CUENTA? Función pura sobre hechos observados.
 *
 * El orden de las ramas es el de la honestidad, no el del optimismo: primero lo que impide saber, después lo
 * que impide hacer, y sólo al final el sí. «Cero cuentas accesibles» NO es evidencia de que podamos crear una:
 * Google exige que la creación se haga DESDE una cuenta administradora —el identificador de esa administradora
 * va en la propia dirección de la llamada—, así que sin ninguna administradora accesible no hay nada que
 * intentar, por mucho que la autorización sea válida.
 */
export function inspeccionarCapacidad(h: HechosDeCapacidad): CapacidadProvisionamiento {
  const sin = (estado: EstadoCapacidad, motivo: MotivoCapacidad, explicacion: string): CapacidadProvisionamiento =>
    ({ estado, motivo, explicacion, managerCustomerId: null });

  // 1. NO SABER. Nunca se convierte en una decisión: se vuelve a preguntar.
  if (h.cuentas === null) {
    return sin('RETRY_LATER', 'NO_SE_PUDO_CONSULTAR', 'Todavía no pudimos comprobar qué permite tu cuenta de Google. Lo reintentamos solos.');
  }

  // 2. AUTORIZACIÓN. Sin ella no se puede afirmar nada sobre lo que se puede crear.
  if (h.estadoProveedor === null || !AUTORIZACION_VIGENTE.includes(h.estadoProveedor)) {
    return sin('HUMAN_PROVIDER_STEP_REQUIRED', 'AUTORIZACION_NO_VIGENTE', 'Hace falta que autorices el acceso con Google antes de que podamos preparar nada.');
  }

  // 3. ACCESO DE API. Si este despliegue no puede hablar con el proveedor, no es un paso que nadie pueda dar.
  if (!h.accesoDeApi) {
    return sin('BLOCKED_EXTERNAL', 'SIN_ACCESO_DE_API', 'Hoy no podemos crear cuentas de anuncios por nuestra cuenta. Te avisaremos en cuanto se pueda.');
  }

  // 4. TOPOLOGÍA. Una cuenta cliente sólo nace desde una administradora, y tiene que ser real, no de prueba.
  const manager = h.cuentas.find((c) => c.manager && !c.testAccount) ?? null;
  if (manager === null) {
    return sin('HUMAN_PROVIDER_STEP_REQUIRED', 'SIN_MANAGER_ACCESIBLE', 'Google sólo deja crear una cuenta de anuncios desde una cuenta administradora, y con este acceso no llegamos a ninguna. La primera cuenta hay que crearla en Google.');
  }

  // 5. DATOS DEL NEGOCIO. Una cuenta nace con moneda y zona horaria, y eso no se adivina.
  if (h.datosDeCuenta === null) {
    return sin('HUMAN_PROVIDER_STEP_REQUIRED', 'DATOS_DEL_NEGOCIO_INCOMPLETOS', 'Nos falta el nombre, la moneda o la zona horaria de tu negocio para poder crear la cuenta.');
  }

  return {
    estado: 'AUTOMATABLE',
    motivo: 'MANAGER_ELEGIBLE_DISPONIBLE',
    explicacion: 'Podemos preparar la cuenta de anuncios nosotros.',
    managerCustomerId: manager.customerId,
  };
}

/** Ciclo de vida de una solicitud de provisionamiento. */
export type EstadoSolicitud =
  | 'PENDING'          // registrada; falta saber si se puede
  | 'READY'            // se puede intentar: hay administradora, acceso y datos
  | 'EXECUTING'        // se está creando en el proveedor (o se creó y aún no se confirmó)
  | 'WAITING_HUMAN'    // falta un paso que sólo una persona puede dar
  | 'COMPLETED'        // la cuenta existe y está identificada
  | 'BLOCKED_EXTERNAL' // el proveedor no lo permite
  | 'RETRY_LATER'      // no se pudo comprobar; se reintenta
  | 'FAILED';          // se intentó y falló de forma definitiva

export const ESTADOS_ACTIVOS_SOLICITUD: readonly EstadoSolicitud[] = ['PENDING', 'READY', 'EXECUTING', 'WAITING_HUMAN', 'RETRY_LATER'];

/** La solicitud, tal como se persiste. Ningún campo puede contener un secreto. */
export interface SolicitudProvisionamiento {
  readonly id: string;
  readonly organizationId: string;
  readonly proveedor: 'GOOGLE_ADS';
  readonly nombreDeseado: string;
  readonly moneda: string;
  readonly zonaHoraria: string;
  readonly capacidad: EstadoCapacidad;
  readonly motivo: MotivoCapacidad;
  /** Identificador OPACO de lo creado en el proveedor. Nunca una credencial. */
  readonly referenciaProveedor: string | null;
  readonly estado: EstadoSolicitud;
  readonly detalle: string | null;
  readonly creadoEn: string;
  readonly actualizadoEn: string;
  readonly completadoEn: string | null;
}

/** Resultado de intentar crear la cuenta. `INCIERTO` es un ciudadano de primera: existe y se maneja. */
export type ResultadoProvisionamiento =
  | { readonly resultado: 'CREADA'; readonly customerId: string }
  | { readonly resultado: 'INCIERTO'; readonly detalle: string }
  | { readonly resultado: 'RECHAZADA_POR_PROVEEDOR'; readonly detalle: string }
  | { readonly resultado: 'REINTENTAR'; readonly detalle: string }
  | { readonly resultado: 'NO_INTENTADA'; readonly detalle: string };

/** Lo que devuelve una reconciliación: ¿existe ya la cuenta que íbamos a crear? */
export type ResultadoVerificacion =
  | { readonly verificacion: 'EXISTE'; readonly customerId: string }
  | { readonly verificacion: 'NO_EXISTE' }
  | { readonly verificacion: 'INDETERMINADA'; readonly detalle: string };

/**
 * PUERTO CANÓNICO. Independiente de Google: un adaptador de Meta o de cualquier otro canal implementa lo
 * mismo. Tres verbos, y ninguno de ellos concede permisos de gasto.
 */
export interface PuertoProvisionamientoCuenta {
  readonly nombre: string;
  /** ¿Se puede, con lo que hay hoy? Nunca escribe. */
  inspeccionar(org: string): Promise<CapacidadProvisionamiento>;
  /** Crea la cuenta. Debe ser seguro llamarlo dos veces: la clave de idempotencia viaja en la solicitud. */
  provisionar(solicitud: SolicitudProvisionamiento): Promise<ResultadoProvisionamiento>;
  /** ¿Existe ya lo que íbamos a crear? Es la red de seguridad ante una respuesta incierta. */
  verificar(solicitud: SolicitudProvisionamiento): Promise<ResultadoVerificacion>;
}
