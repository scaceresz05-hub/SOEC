/**
 * apps/api · ATRIBUCIÓN FIRST-PARTY · tipos del dominio.
 *
 * DOS COSAS QUE NO SON LA MISMA, y que este módulo existe para no volver a confundir:
 *
 *   GOOGLE_CONVERSION_TRACKING — Google recibe la acción como CONVERSIÓN y puja por ella. Hoy, para CP, esto
 *     no existe: la cuenta no tiene ninguna acción de conversión y el camino de carga server-side está
 *     bloqueado por la verificación OAuth (ver ADR 0035).
 *
 *   FIRST_PARTY_ATTRIBUTION — SOEC guarda, en su propia base, de qué clic de anuncio venía cada intención de
 *     WhatsApp. Sirve para EVALUAR el piloto: saber qué campaña, qué grupo y qué palabra terminan en alguien
 *     escribiendo. NO sirve para que Google optimice, porque Google no se entera.
 *
 * La diferencia importa en la única frase que el negocio va a leer: con atribución first-party se puede decir
 * «de estos 40 clics, 3 acabaron en WhatsApp»; NO se puede decir «Google está optimizando por contactos».
 * Decir lo segundo sería vender como automático algo que todavía hace una persona mirando una tabla.
 */

export type ModoDeMedicion = 'GOOGLE_CONVERSION_TRACKING' | 'FIRST_PARTY_ATTRIBUTION';

/**
 * En qué punto está la medición de una organización, para decidir qué campaña se puede proponer:
 *
 *  · GOOGLE_CONVERSION_READY        — hay acción de conversión y Google la recibe: se puede pujar a conversiones.
 *  · FIRST_PARTY_ATTRIBUTION_READY  — SOEC puede atribuir internamente: se puede pujar a CLICS y evaluar aparte.
 *  · MEASUREMENT_BLOCKED            — no hay ni una cosa ni la otra: no se propone gasto.
 */
export type EstadoDeMedicionParaCampana =
  | 'GOOGLE_CONVERSION_READY'
  | 'FIRST_PARTY_ATTRIBUTION_READY'
  | 'MEASUREMENT_BLOCKED';

/**
 * Resultado de intentar atribuir una intención a un clic de anuncio. Cinco estados, y ninguno es «se supone
 * que sí»: la diferencia entre «Google no conoce ese clic» y «no pude preguntarle a Google» decide si se
 * reintenta o no, y confundirlas es cómo se acaba con un piloto que cree haber medido lo que no midió.
 */
export type EstadoAtribucion =
  /** Registrada, todavía sin preguntar a la plataforma. Es el estado con el que nace una intención. */
  | 'PENDIENTE'
  /** Google devolvió el clic y se guardó de qué campaña venía. */
  | 'ATTRIBUTED'
  /** Se preguntó por ese gclid y Google no lo tiene. No se inventa una campaña parecida. */
  | 'GCLID_NOT_FOUND'
  /** La intención no traía identificador de clic: no vino de un anuncio, o el anuncio no lo pasó. */
  | 'NO_GCLID'
  /** No se pudo preguntar (error, cuota, cuenta sin conectar). Se reintenta; no se concluye nada. */
  | 'PROVIDER_UNAVAILABLE'
  /** El clic es más viejo que la ventana que Google permite consultar: ya no se puede saber. */
  | 'EXPIRED_LOOKBACK';

/** Estados desde los que reintentar tiene sentido. Los demás son definitivos. */
export const ATRIBUCION_REINTENTABLE: readonly EstadoAtribucion[] = ['PENDIENTE', 'PROVIDER_UNAVAILABLE'];

/**
 * Ventana que Google permite consultar en `click_view`: «Queries including ClickView must have a filter
 * limiting the results to one day and can be requested for dates back to 90 days before the time of the
 * request». Las dos mitades de esa frase mandan sobre el diseño del lector: una consulta por día, y nada
 * más viejo que noventa.
 */
export const DIAS_MAXIMOS_CLICK_VIEW = 90;

/** Lo que se guarda de una atribución. Nada más: ni teléfono, ni texto, ni identificador de persona. */
export interface AtribucionDeIntencion {
  readonly organizationId: string;
  /** El `ref` que el sitio generó en el clic. Es la identidad del evento y la clave de idempotencia. */
  readonly ref: string;
  readonly gclid: string | null;
  readonly eventTimestamp: string;
  readonly estado: EstadoAtribucion;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly adGroupId: string | null;
  readonly adGroupName: string | null;
  readonly keyword: string | null;
  readonly matchType: string | null;
  readonly device: string | null;
  readonly clickDate: string | null;
  readonly resueltoEn: string | null;
  readonly intentos: number;
  readonly ultimoError: string | null;
}
