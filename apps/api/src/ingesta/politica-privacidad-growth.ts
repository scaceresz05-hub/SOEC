/**
 * apps/api · CAPA DE COMPOSICIÓN · POLÍTICA DE PRIVACIDAD V1 del puente Growth → SOEC.
 *
 * SOEC mide INTENCIÓN COMERCIAL. Nunca historia clínica. El riesgo real de un negocio de salud no es
 * que llegue un diagnóstico explícito, sino que lleguen dos piezas inocuas por separado que, juntas,
 * reconstruyen una: «interés por implantes dentales» + «lead 4127» = un dato de salud de una persona
 * identificable. La regla de este módulo corta esa unión EN LA FRONTERA, antes de persistir nada.
 *
 * REGLA V1 (dos mitades, ninguna opcional):
 *
 *   1. INTERÉS POR TRATAMIENTO — `service_viewed` / `service_viewed:<slug>`
 *      PUEDE nombrar el tratamiento, pero DEBE llegar SIN `lead_id` (sin `leadRef`): se cuenta como
 *      volumen agregado y no se puede unir a una persona.
 *
 *   2. CORRELACIONABLE CON CONTACTO — `whatsapp_intent`, `phone_intent`, `appointment_intent`
 *      PUEDE llevar `lead_id` (es lo que permite atribuir un contacto), pero NO debe contener
 *      tratamiento, ruta de tratamiento, diagnóstico, síntomas ni texto clínico libre.
 *
 * QUÉ VERIFICA ESTE MÓDULO Y QUÉ NO (declarado, no supuesto):
 *   · SÍ verifica los campos cuya FORMA controla el productor y es comprobable: el calificador del
 *     nombre de evento (`service_viewed:<slug>`, `whatsapp_intent-<slug>`, …) y la `path`. La `path`
 *     se comprueba aunque SOEC no la persista: la regla es sobre lo que el productor puede ENVIAR, y
 *     rechazarla obliga a corregir el emisor en vez de confiar en que el mapeo la descarte.
 *   · NO puede verificar TEXTO LIBRE: `utm_campaign` y `utm_source` los fija la plataforma de
 *     anuncios, y decidir si «implantes-curico» nombra un tratamiento exigiría un vocabulario clínico
 *     que SOEC no tiene y que no se va a inventar aquí. LIMITACIÓN DECLARADA de V1: la política de
 *     nomenclatura de campañas es un control aparte, del lado del emisor, no de esta frontera.
 *
 * FAIL-CLOSED: una violación LANZA y el evento no se persiste. No se "sanea" en silencio, porque un
 * saneo silencioso convierte un fallo del productor en un dato que nadie revisa. CONSECUENCIA REAL,
 * asumida: mientras el emisor siga produciendo ese evento, la ingesta de ESA fuente queda detenida
 * (el cursor no avanza y ningún evento posterior entra) hasta que se corrija el emisor. El scheduler
 * aísla el fallo, así que las demás fuentes y organizaciones siguen ingiriendo con normalidad.
 *
 * El mensaje de error NUNCA incluye el calificador ni la ruta: nombrar el tratamiento al reportar la
 * violación filtraría por los registros exactamente lo que la regla impide persistir.
 */

/** Nombre base de los eventos de interés por tratamiento. */
export const EVENTO_INTERES_POR_SERVICIO = 'service_viewed' as const;

/** Eventos que PUEDEN correlacionarse con una persona (llevan `leadRef`). */
export const EVENTOS_CORRELACIONABLES_CON_CONTACTO: readonly string[] = [
  'whatsapp_intent',
  'phone_intent',
  'appointment_intent',
];

/**
 * Primer carácter que separa el nombre base de su calificador. Deliberadamente AMPLIO: la convención
 * es `nombre:<slug>`, pero un emisor que escriba `service_viewed/implantes` o `service_viewed-implantes`
 * estaría adjuntando el mismo tratamiento por otra vía. Los nombres de evento del contrato usan sólo
 * letras, dígitos y `_`, así que cualquier otro carácter marca el inicio del calificador.
 */
const SEPARADOR_DE_CALIFICADOR = /[^A-Za-z0-9_]/;

/**
 * Rutas que denotan una página de tratamiento. Conservadora y explícita: si el productor inventa una
 * ruta nueva, el fallo es que el evento pase, no que se bloquee de más; por eso la segunda mitad de
 * la regla se apoya SOBRE TODO en el calificador del nombre de evento, que es el canal previsto.
 */
const RUTA_DE_TRATAMIENTO = /(^|\/)(servicios?|tratamientos?|services|treatments?)(\/|$)/i;

/** Forma mínima que la política necesita observar. Coincide con `EventoGrowth` por estructura. */
export interface EventoInspeccionable {
  readonly event_id: number;
  readonly event_name: string;
  readonly path?: string | null;
  readonly lead_id?: number | null;
}

export type ViolacionPrivacidadGrowth =
  | 'INTERES_POR_SERVICIO_CON_LEADREF'
  | 'CONTACTO_CON_TRATAMIENTO';

/** Nombre base del evento: lo anterior al primer separador. `whatsapp_intent:x` → `whatsapp_intent`. */
export function nombreBaseDeEvento(eventName: string): string {
  const n = (eventName ?? '').trim();
  const m = SEPARADOR_DE_CALIFICADOR.exec(n);
  return m ? n.slice(0, m.index) : n;
}

/** Calificador del evento: lo posterior al primer separador. `null` si no lo lleva. */
export function calificadorDeEvento(eventName: string): string | null {
  const n = (eventName ?? '').trim();
  const m = SEPARADOR_DE_CALIFICADOR.exec(n);
  if (!m) return null;
  const q = n.slice(m.index + 1).trim();
  return q.length > 0 ? q : null;
}

/**
 * Comparación INSENSIBLE A MAYÚSCULAS: `Service_Viewed` y `SERVICE_VIEWED` son el mismo evento para la
 * regla. Un emisor no puede esquivar la política cambiando la caja del nombre.
 */
function claveDeEvento(eventName: string): string {
  return nombreBaseDeEvento(eventName).toLowerCase();
}

export function esInteresPorServicio(eventName: string): boolean {
  return claveDeEvento(eventName) === EVENTO_INTERES_POR_SERVICIO;
}

export function esCorrelacionableConContacto(eventName: string): boolean {
  return EVENTOS_CORRELACIONABLES_CON_CONTACTO.includes(claveDeEvento(eventName));
}

/** ¿La ruta apunta a una página de tratamiento? (vacía/ausente ⇒ no). */
export function esRutaDeTratamiento(path: string | null | undefined): boolean {
  const p = (path ?? '').trim();
  return p.length > 0 && RUTA_DE_TRATAMIENTO.test(p);
}

/** Violación de la regla V1, o `null` si el evento la respeta. Función PURA. */
export function violacionDePrivacidadGrowth(
  ev: EventoInspeccionable,
): ViolacionPrivacidadGrowth | null {
  const nombre = ev.event_name ?? '';
  // (1) interés por tratamiento: jamás correlacionable con una persona.
  if (esInteresPorServicio(nombre) && ev.lead_id != null) {
    return 'INTERES_POR_SERVICIO_CON_LEADREF';
  }
  // (2) intención de contacto: jamás portadora de tratamiento (ni por nombre, ni por ruta).
  if (esCorrelacionableConContacto(nombre)) {
    if (calificadorDeEvento(nombre) !== null) return 'CONTACTO_CON_TRATAMIENTO';
    if (esRutaDeTratamiento(ev.path)) return 'CONTACTO_CON_TRATAMIENTO';
  }
  return null;
}

/** Error de frontera: el evento viola la regla V1 y NO se persiste. */
export class PrivacidadGrowthError extends Error {
  readonly code = 'GROWTH_PRIVACY_RULE_VIOLATED';
  constructor(
    readonly violacion: ViolacionPrivacidadGrowth,
    readonly eventId: number,
    readonly eventNameBase: string,
  ) {
    super(
      `evento growth ${eventId} ('${eventNameBase}') rechazado por la regla de privacidad V1: ${violacion}`,
    );
    this.name = 'PrivacidadGrowthError';
  }
}

/** Exige la regla V1. Lanza `PrivacidadGrowthError` si el evento la viola. */
export function assertPrivacidadGrowth(ev: EventoInspeccionable): void {
  const v = violacionDePrivacidadGrowth(ev);
  if (v === null) return;
  // Sólo el nombre BASE viaja al mensaje: el calificador (el tratamiento) nunca se registra.
  throw new PrivacidadGrowthError(v, ev.event_id, nombreBaseDeEvento(ev.event_name ?? ''));
}
