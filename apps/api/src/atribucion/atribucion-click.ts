/**
 * apps/api · ATRIBUCIÓN FIRST-PARTY · resolver un clic de anuncio a partir de su identificador.
 *
 * PURO y con el proveedor inyectado. Pregunta a Google, por `click_view`, de qué campaña venía un `gclid` — y
 * si Google no lo conoce, lo dice. Nunca busca «el clic más parecido»: una atribución inventada contamina
 * exactamente la decisión que el piloto existe para tomar.
 *
 * DOS LÍMITES DE GOOGLE mandan sobre este diseño, y no son negociables:
 *   · una consulta debe filtrar UN SOLO DÍA;
 *   · no se puede preguntar por nada anterior a 90 días.
 * De ahí que se pregunte por el día del evento y, como mucho, por el anterior: un clic puede caer justo antes
 * de la medianoche de la cuenta y la intención justo después.
 */
import { DIAS_MAXIMOS_CLICK_VIEW, type EstadoAtribucion } from './atribucion-tipos';

/** Lo que Google devuelve de un clic. Sólo lo que sirve para saber qué anuncio lo trajo. */
export interface ClicObservado {
  readonly gclid: string;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly adGroupId: string | null;
  readonly adGroupName: string | null;
  readonly keyword: string | null;
  readonly matchType: string | null;
  readonly device: string | null;
  readonly fecha: string;
}

/** Puerto de consulta: un día, un gclid. `null` ⇒ no se pudo preguntar (distinto de «no está»). */
export type ConsultaDeClics = (gclid: string, fecha: string) => Promise<readonly ClicObservado[] | null>;

export interface ResultadoAtribucion {
  readonly estado: EstadoAtribucion;
  readonly clic: ClicObservado | null;
  readonly motivo: string;
  readonly diasConsultados: readonly string[];
}

const soloFecha = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
const restarDias = (iso: string, dias: number): string => new Date(Date.parse(iso) - dias * 86_400_000).toISOString();

/**
 * FORMA SEGURA de un identificador de clic. No se valida contra una lista de Google —no existe— sino contra
 * lo que puede viajar sin riesgo: caracteres de URL, longitud acotada. Un valor raro no se consulta ni se
 * guarda: llegaría de la barra de direcciones de cualquiera.
 */
export function gclidValido(v: string | null | undefined): v is string {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return s.length >= 10 && s.length <= 200 && /^[A-Za-z0-9._-]+$/.test(s);
}

/**
 * Resuelve la atribución de UNA intención. `ahora` se inyecta para que la ventana de 90 días sea comprobable
 * sin depender del día en que se corran las pruebas.
 */
export async function atribuirIntencion(
  entrada: { readonly gclid: string | null; readonly eventTimestamp: string },
  consultar: ConsultaDeClics,
  ahora: string,
): Promise<ResultadoAtribucion> {
  if (!gclidValido(entrada.gclid)) {
    return {
      estado: 'NO_GCLID',
      clic: null,
      motivo: 'la intención no trae identificador de clic de anuncio: no vino de un anuncio, o el anuncio no lo pasó',
      diasConsultados: [],
    };
  }

  const antiguedadDias = Math.floor((Date.parse(ahora) - Date.parse(entrada.eventTimestamp)) / 86_400_000);
  if (antiguedadDias > DIAS_MAXIMOS_CLICK_VIEW) {
    return {
      estado: 'EXPIRED_LOOKBACK',
      clic: null,
      motivo: `el clic tiene ${antiguedadDias} días y la plataforma sólo permite consultar ${DIAS_MAXIMOS_CLICK_VIEW}: ya no se puede saber de dónde vino`,
      diasConsultados: [],
    };
  }

  /**
   * El día del evento y el anterior. Dos consultas como máximo, y la segunda sólo si la primera no encontró
   * nada: un clic de las 23:50 y una intención de las 00:05 son el mismo camino de una persona, y perderlo
   * por la medianoche de la cuenta sería perder justo los casos más rápidos.
   */
  const dias = [soloFecha(entrada.eventTimestamp), soloFecha(restarDias(entrada.eventTimestamp, 1))];
  const consultados: string[] = [];
  let huboFallo = false;

  for (const dia of dias) {
    if (Math.floor((Date.parse(ahora) - Date.parse(`${dia}T00:00:00.000Z`)) / 86_400_000) > DIAS_MAXIMOS_CLICK_VIEW) continue;
    consultados.push(dia);
    const filas = await consultar(entrada.gclid, dia);
    if (filas === null) {
      huboFallo = true;
      continue; // no se pudo preguntar por ese día; se intenta el otro antes de concluir nada
    }
    const exacto = filas.find((f) => f.gclid === entrada.gclid) ?? null;
    if (exacto !== null) {
      return { estado: 'ATTRIBUTED', clic: exacto, motivo: 'la plataforma devolvió ese clic', diasConsultados: consultados };
    }
  }

  if (huboFallo) {
    return {
      estado: 'PROVIDER_UNAVAILABLE',
      clic: null,
      motivo: 'no se pudo consultar la plataforma: no se sabe de dónde vino este clic, y no se da por no atribuido',
      diasConsultados: consultados,
    };
  }

  return {
    estado: 'GCLID_NOT_FOUND',
    clic: null,
    motivo: 'la plataforma respondió y no conoce ese identificador de clic: no se atribuye a ninguna campaña',
    diasConsultados: consultados,
  };
}
