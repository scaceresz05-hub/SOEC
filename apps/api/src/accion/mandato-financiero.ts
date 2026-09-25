/**
 * apps/api · MANDATO FINANCIERO · la autorización de gasto, vista por la persona que la firma.
 *
 * Esto no es un segundo mandato. La autorización vive en UN solo sitio —`accion_mandato`, el Mandato del
 * plano de acción— y aquí sólo se hacen dos cosas que hasta ahora no hacía nadie:
 *
 *  1. TRADUCIRLA a lo que una persona puede leer sin diccionario: «Total máximo: $30.000. Máximo diario:
 *     $2.500». Sin micros, sin unidades menores, sin Customer ID, sin sobres ni MCC.
 *  2. Hacerla MANDAR sobre lo que viene después. El Authorized Execution Envelope restringe UNA ejecución
 *     concreta; el mandato dice cuánto dinero existe. Un sobre nunca puede pedir más que el mandato, y sin
 *     mandato no hay sobre que valga: eso es la diferencia entre un tope y una sugerencia.
 *
 * LO QUE UN MANDATO NO ES, y este archivo se encarga de que no se confunda:
 *  · no es permiso para escribir en la cuenta (ESCRITURA_ADS es otra decisión de la persona);
 *  · no es permiso para operar sin preguntar (AUTONOMIA_ADS es otra decisión más);
 *  · no es medición, ni director, ni campaña.
 * Autorizar dinero y entregar el volante son cosas distintas. Un mandato con las capacidades apagadas deja
 * exactamente igual que antes: nada se ejecuta, nada se gasta.
 */
import { aUnidadesMayores, aUnidadesMenores, normalizarMoneda } from '../dinero';
import { recomputarEstado, type Mandato, type ProveedorDeGasto } from './mandato';

/** Estados en los que la autorización está viva (puede respaldar gasto si TODO lo demás lo permite). */
const VIGENTES = new Set(['AUTHORIZED', 'ACTIVE']);

export type MotivoFinanciero =
  | 'SIN_MANDATO'
  | 'MANDATO_NO_VIGENTE'
  | 'CANAL_NO_AUTORIZADO'
  | 'MONEDA_DISTINTA'
  | 'TOTAL_SUPERA_EL_MANDATO'
  | 'DIARIO_SUPERA_EL_MANDATO';

export interface VeredictoFinanciero {
  readonly ok: boolean;
  readonly motivo: MotivoFinanciero | null;
}
const no = (motivo: MotivoFinanciero): VeredictoFinanciero => ({ ok: false, motivo });
const si: VeredictoFinanciero = { ok: true, motivo: null };

/** ¿Está viva esta autorización AHORA? Se recomputa por tiempo/gasto/kill switch, no se cree el estado guardado. */
export function mandatoVigente(m: Mandato | null, ahora: string): boolean {
  if (m === null) return false;
  return VIGENTES.has(recomputarEstado(m, ahora));
}

/**
 * TOPES QUE PIDE UN SOBRE, en unidades MAYORES —las que escribe una persona y las que usa el plan de campaña—.
 * El mandato guarda enteros en unidades menores; comparar ambos sin decir en qué unidad está cada uno es la
 * forma exacta de autorizar cien veces más de lo que alguien quiso.
 */
export interface TopesSolicitados {
  readonly currency: string;
  readonly totalMayor: number;
  readonly diarioMayor?: number | null;
  readonly canal?: ProveedorDeGasto;
}

/**
 * PRECEDENCIA DEL MANDATO SOBRE EL SOBRE. Fail-closed en todas las ramas: sin mandato, con mandato vencido, en
 * otra moneda o para otro canal, la respuesta es no. Nunca se «ajusta» el sobre al mandato en silencio: un
 * recorte automático sería SOEC decidiendo cuánto quiso gastar la persona.
 */
export function verificarContraMandato(m: Mandato | null, pedido: TopesSolicitados, ahora: string): VeredictoFinanciero {
  if (m === null) return no('SIN_MANDATO');
  if (!mandatoVigente(m, ahora)) return no('MANDATO_NO_VIGENTE');
  if (pedido.canal !== undefined && m.provider !== pedido.canal) return no('CANAL_NO_AUTORIZADO');
  const moneda = normalizarMoneda(pedido.currency);
  if (moneda === null || moneda !== normalizarMoneda(m.currency)) return no('MONEDA_DISTINTA');
  const totalMinor = aUnidadesMenores(pedido.totalMayor, moneda);
  // Un sobre sin importe utilizable no puede superar nada: no autoriza gasto, y el gate financiero no es quien
  // tiene que quejarse de eso.
  if (totalMinor !== null && totalMinor > m.authorizedBudgetMinor) return no('TOTAL_SUPERA_EL_MANDATO');
  if (pedido.diarioMayor !== undefined && pedido.diarioMayor !== null) {
    const diarioMinor = aUnidadesMenores(pedido.diarioMayor, moneda);
    // Si la persona fijó un máximo por día, pedir más que eso es pedir dinero que no autorizó. Si NO lo fijó,
    // el total sigue mandando: no se inventa un tope diario que nadie escribió.
    if (diarioMinor !== null && m.dailyCapMinor !== null && diarioMinor > m.dailyCapMinor) return no('DIARIO_SUPERA_EL_MANDATO');
    if (diarioMinor !== null && diarioMinor > m.authorizedBudgetMinor) return no('TOTAL_SUPERA_EL_MANDATO');
  }
  return si;
}

export type MotivoSinEjecucion = MotivoFinanciero | 'SIN_PERMISO_DE_ESCRITURA' | 'SIN_AUTONOMIA';

/** Las tres llaves que tienen que estar puestas a la vez para que exista gasto real. */
export interface LlavesDeEjecucion {
  readonly mandato: Mandato | null;
  readonly escrituraAds: boolean;
  readonly autonomiaAds: boolean;
  readonly canal: ProveedorDeGasto;
  readonly autonoma: boolean;
}

/**
 * INVARIANTE DE EJECUCIÓN. Se comprueban las tres puertas por separado y se dice cuál falta:
 *  · dinero autorizado (mandato vigente, del canal y la moneda correctos);
 *  · permiso para tocar la cuenta (ESCRITURA_ADS);
 *  · permiso para actuar sin preguntar (AUTONOMIA_ADS), y sólo si la acción es autónoma.
 * Ninguna implica a las otras. Que existan 30.000 pesos autorizados no enciende nada por sí solo.
 */
export function puedeEjecutarGasto(ll: LlavesDeEjecucion, moneda: string, ahora: string): { readonly ok: boolean; readonly motivo: MotivoSinEjecucion | null } {
  const financiero = verificarContraMandato(ll.mandato, { currency: moneda, totalMayor: 0, canal: ll.canal }, ahora);
  if (!financiero.ok) return { ok: false, motivo: financiero.motivo };
  if (!ll.escrituraAds) return { ok: false, motivo: 'SIN_PERMISO_DE_ESCRITURA' };
  if (ll.autonoma && !ll.autonomiaAds) return { ok: false, motivo: 'SIN_AUTONOMIA' };
  return { ok: true, motivo: null };
}

/**
 * LO QUE VE LA PERSONA. En su moneda, en unidades que reconoce, sin una sola palabra del mecanismo: ni sobre,
 * ni autonomía, ni Customer ID, ni micros, ni MCC. Si no hay autorización, `null` — y la pantalla dirá que no
 * hay ninguna, que es la verdad, en vez de un cero que parece un límite.
 */
export interface PresupuestoAutorizado {
  readonly moneda: string;
  readonly totalMaximo: number;
  readonly maximoDiario: number | null;
  readonly gastado: number;
  readonly disponible: number;
  readonly vigente: boolean;
  readonly autorizadoPor: string;
  readonly autorizadoEn: string | null;
  readonly desde: string;
  readonly hasta: string;
}

export function presupuestoAutorizado(m: Mandato | null, ahora: string): PresupuestoAutorizado | null {
  if (m === null) return null;
  const moneda = normalizarMoneda(m.currency) ?? m.currency;
  const mayor = (minor: number | null): number | null => aUnidadesMayores(minor, moneda);
  const gastado = mayor(m.spentMinor) ?? 0;
  const total = mayor(m.authorizedBudgetMinor) ?? 0;
  return {
    moneda,
    totalMaximo: total,
    maximoDiario: mayor(m.dailyCapMinor),
    gastado,
    disponible: Math.max(0, total - gastado),
    vigente: mandatoVigente(m, ahora),
    autorizadoPor: m.authorizedBy,
    autorizadoEn: m.authorizedAt,
    desde: m.periodStart,
    hasta: m.periodEnd,
  };
}
