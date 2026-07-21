/**
 * Objetivo comercial/de marketing (F2-MKT-01). Dirección comercial que el
 * planificador traduce en trabajo ejecutable. Event-sourced; con validación de
 * evaluabilidad (objetivos imposibles o mal formados se rechazan).
 */
import type { Attribution, RecordedEvent } from '@soec/contracts';

export type Prioridad = 'alta' | 'media' | 'baja';

export interface ContextoOrganizacion {
  readonly empresa: string;
  readonly marca: string;
  readonly producto: string;
  readonly propuestaValor: string;
  readonly mercado: string;
  readonly territorio: string;
  readonly idioma: string;
  readonly moneda: string;
  readonly audiencia: string;
  readonly segmento: string;
  readonly canales: readonly string[];
}

export interface DireccionComercial {
  readonly objetivoComercial: string;
  readonly objetivoMarketing: string;
  readonly indicador: string;
  readonly lineaBase: number;
  readonly valorEsperado: number;
  readonly horizonteDias: number;
  readonly prioridad: Prioridad;
  readonly restricciones: readonly string[];
  readonly presupuestoTotal: number;
  /** Días mínimos entre publicaciones de una misma campaña. */
  readonly frecuenciaDias: number;
}

export interface ContenidoObjetivo extends ContextoOrganizacion, DireccionComercial {}

export const EVENTOS_OBJ = { registrado: 'obj.registrado' } as const;

export function objStreamId(objetivoId: string): string {
  return `obj:${objetivoId}`;
}

export interface ObjetivoState {
  readonly objetivoId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly contenido: ContenidoObjetivo | null;
  readonly evaluable: boolean;
  readonly faltantes: readonly string[];
}

export function estadoInicialObjetivo(objetivoId: string, organizationId: string): ObjetivoState {
  return { objetivoId, organizationId, version: 0, existe: false, contenido: null, evaluable: false, faltantes: [] };
}

export interface ValidacionObjetivo {
  readonly evaluable: boolean;
  readonly faltantes: string[];
  readonly error: string | null;
}

/** Valida evaluabilidad: detecta faltantes y rechaza objetivos imposibles/mal formados. */
export function validarObjetivo(c: ContenidoObjetivo): ValidacionObjetivo {
  const faltantes: string[] = [];
  if (!c.empresa) faltantes.push('empresa');
  if (!c.marca) faltantes.push('marca');
  if (!c.audiencia) faltantes.push('audiencia');
  if (!c.indicador) faltantes.push('indicador');
  if (c.canales.length === 0) faltantes.push('canales');
  let error: string | null = null;
  if (c.horizonteDias <= 0) error = 'horizonte_no_positivo';
  else if (c.frecuenciaDias <= 0) error = 'frecuencia_no_positiva';
  else if (c.valorEsperado <= c.lineaBase) error = 'objetivo_no_supera_linea_base';
  else if (c.presupuestoTotal < 0) error = 'presupuesto_negativo';
  return { evaluable: faltantes.length === 0 && error === null, faltantes, error };
}

interface PayloadRegistrado {
  contenido: ContenidoObjetivo;
  evaluable: boolean;
  faltantes: string[];
}

export function aplicarObjetivo(state: ObjetivoState, event: RecordedEvent): ObjetivoState {
  const next = { ...state, version: state.version + 1 };
  if (event.type === EVENTOS_OBJ.registrado) {
    const p = event.payload as PayloadRegistrado;
    return { ...next, existe: true, contenido: p.contenido, evaluable: p.evaluable, faltantes: p.faltantes };
  }
  return next;
}

export function reconstruirObjetivo(objetivoId: string, organizationId: string, events: readonly RecordedEvent[]): ObjetivoState {
  return events.reduce(aplicarObjetivo, estadoInicialObjetivo(objetivoId, organizationId));
}

export interface Attribuido {
  readonly attribution: Attribution;
}
