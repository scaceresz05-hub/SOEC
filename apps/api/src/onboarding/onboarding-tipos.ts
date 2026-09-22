/**
 * apps/api · ONBOARDING INTELIGENTE · vocabulario.
 *
 * EL PRINCIPIO DEL PRODUCTO: el usuario habla de su negocio y SOEC traduce eso a configuración de marketing.
 * Nadie tiene que saber qué es un CPA, un pixel, una estrategia de puja ni una capability para dejar su
 * empresa lista. Este módulo define el vocabulario de esa conversación: sus pasos, sus preguntas, de dónde
 * viene cada dato y qué falta para estar preparado.
 *
 * LO QUE ESTE MÓDULO NO HACE: no guarda datos de negocio. Cada respuesta se TRADUCE a la tabla canónica que
 * ya existe (`business_profile`, `business_offering`, `business_geo_scope`, `business_restriction`,
 * `business_evaluation_policy`, `business_connection`, `business_capability`, `business_governance`). El
 * onboarding sólo recuerda la conversación y por dónde iba.
 */

/** Estado del asistente. `NEEDS_ACTION` = el usuario respondió todo lo que podía y falta algo suyo (una conexión). */
export type EstadoOnboarding = 'NOT_STARTED' | 'IN_PROGRESS' | 'NEEDS_ACTION' | 'COMPLETE';

export const ESTADOS_ONBOARDING: readonly EstadoOnboarding[] = ['NOT_STARTED', 'IN_PROGRESS', 'NEEDS_ACTION', 'COMPLETE'];

/**
 * PROCEDENCIA de un dato recogido. Hace visible la diferencia entre lo que una persona AFIRMÓ y lo que el
 * sistema OBSERVÓ: un título leído del sitio web no es una declaración del dueño, y no puede tratarse igual.
 */
export type ProcedenciaDato = 'USER' | 'WEBSITE' | 'CONNECTOR' | 'DERIVED';

export const PROCEDENCIAS_DATO: readonly ProcedenciaDato[] = ['USER', 'WEBSITE', 'CONNECTOR', 'DERIVED'];

/**
 * Estado de verificación de un dato: lo descubierto se propone, no se asume. Nada pasa a `USER_CONFIRMED`
 * sin que la persona lo confirme, aunque el sistema esté muy seguro.
 */
export type EstadoConfirmacion = 'DISCOVERED' | 'USER_CONFIRMED';

/** Pasos del asistente. Son ETAPAS DE CONVERSACIÓN, no tablas ni pantallas técnicas. */
export type PasoId =
  | 'negocio'
  | 'oferta'
  | 'territorio'
  | 'objetivo'
  | 'contacto'
  | 'restricciones'
  | 'medicion'
  | 'conexiones'
  | 'presupuesto'
  | 'autonomia'
  | 'resumen';

export const PASOS_EN_ORDEN: readonly PasoId[] = [
  'negocio', 'oferta', 'territorio', 'objetivo', 'contacto', 'restricciones',
  'medicion', 'conexiones', 'presupuesto', 'autonomia', 'resumen',
];

/** Tipos de pregunta que la interfaz sabe pintar. Ninguno expone jerga: son formas de responder. */
export type TipoPregunta =
  | 'TEXTO'
  | 'TEXTO_LARGO'
  | 'OPCION'
  | 'OPCIONES'
  | 'LISTA_TEXTO'
  | 'NUMERO'
  | 'SI_NO';

export interface OpcionPregunta {
  readonly valor: string;
  readonly etiqueta: string;
  readonly ayuda?: string;
}

/** Modalidad del techo de inversión declarado. `LATER` y `NONE` son respuestas legítimas, no huecos. */
export type ModalidadPresupuesto = 'NONE' | 'DAILY' | 'MONTHLY' | 'LATER';

export const MODALIDADES_PRESUPUESTO: readonly ModalidadPresupuesto[] = ['NONE', 'DAILY', 'MONTHLY', 'LATER'];

/** Preferencia de autonomía en lenguaje de negocio. Se traduce al modo operativo de la organización. */
export type PreferenciaAutonomia = 'SOLO_OBSERVAR' | 'PEDIR_APROBACION' | 'OPERAR_DENTRO_DE_LIMITES';

export const PREFERENCIAS_AUTONOMIA: readonly PreferenciaAutonomia[] = ['SOLO_OBSERVAR', 'PEDIR_APROBACION', 'OPERAR_DENTRO_DE_LIMITES'];

/** Traducción de la preferencia al modo almacenado. `PILOT` es el nombre almacenado de OBSERVE. */
export const MODO_DE_PREFERENCIA: Readonly<Record<PreferenciaAutonomia, 'PILOT' | 'SUPERVISED_REAL' | 'AUTONOMOUS_REAL'>> = {
  SOLO_OBSERVAR: 'PILOT',
  PEDIR_APROBACION: 'SUPERVISED_REAL',
  OPERAR_DENTRO_DE_LIMITES: 'AUTONOMOUS_REAL',
};

export class OnboardingInvalidoError extends Error {}

export function esPaso(v: unknown): v is PasoId {
  return typeof v === 'string' && (PASOS_EN_ORDEN as readonly string[]).includes(v);
}

export function exigirPaso(v: unknown): PasoId {
  if (!esPaso(v)) throw new OnboardingInvalidoError(`paso desconocido: ${String(v)}`);
  return v;
}

/**
 * Arranques habituales de una frase que NO forman parte del nombre de lo que se vende: «hacemos implantes»
 * es un implante, no un «hacemos implantes». Sin esto, el primer elemento de cada lista quedaría deformado.
 */
const ARRANQUES = /^(hacemos|vendemos|ofrecemos|ofertamos|prestamos|realizamos|trabajamos con|tenemos|somos|nos dedicamos a|me dedico a|hago|vendo|ofrezco|presto)\s+/i;

/**
 * Trocea una respuesta escrita con naturalidad en elementos. La persona escribe «hacemos implantes, prótesis
 * y odontología general» y de ahí salen tres cosas: no se le pide una lista con viñetas, ni códigos, ni slugs.
 */
export function trocearEnumeracion(texto: string): readonly string[] {
  return texto
    .split(/[\n;,]|\s+\by\b\s+|\s+\be\b\s+|\s+\/\s+/gi)
    .map((x) => x.replace(/^[\s·•\-*]+|[\s.]+$/g, '').trim().replace(ARRANQUES, '').trim())
    .filter((x) => x.length > 1)
    .slice(0, 40);
}

/** Identificador estable a partir de un texto humano. El usuario nunca ve ni escribe esto. */
export function claveDesdeTexto(texto: string): string {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
