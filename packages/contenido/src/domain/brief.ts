/**
 * Brief de contenido (F2-CONT-01 §4.1) — el encargo editorial derivado de una
 * actividad de marketing. Reúne objetivo, campaña, audiencia, marca, canal y
 * restricciones de política. Event-sourced con máquina de estados (§5.1).
 * Un brief incompleto NO se completa inventando datos: los faltantes quedan visibles.
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoBrief = 'borrador' | 'evaluando' | 'incompleto' | 'listo' | 'bloqueado' | 'reemplazado' | 'archivado';

export type EtapaEmbudo = 'reconocimiento' | 'consideracion' | 'conversion' | 'fidelizacion';

export interface ContenidoBrief {
  readonly organizationId: string;
  readonly marcaId: string;
  readonly objetivoComercial: string;
  readonly objetivoMarketing: string;
  readonly iniciativaId: string;
  readonly campaniaId: string;
  readonly planId: string;
  readonly actividadId: string;
  readonly audiencia: string;
  readonly segmento: string;
  readonly etapaEmbudo: EtapaEmbudo;
  readonly canalDestino: string;
  readonly proposito: string;
  readonly mensajePrincipal: string;
  readonly propuestaValor: string;
  readonly productoServicio: string;
  readonly problemaCliente: string;
  readonly llamadaAccion: string;
  readonly tono: string;
  readonly idioma: string;
  readonly territorio: string;
  readonly restricciones: readonly string[];
  readonly afirmacionesPermitidas: readonly string[];
  readonly afirmacionesProhibidas: readonly string[];
  readonly requisitosLegales: readonly string[];
  readonly fuentesDisponibles: readonly string[];
  readonly fechaObjetivo: string;
  // ── M6 · gobernanza M5 (ampliación ADITIVA; opcional para no romper briefs previos) ──
  /** Contexto creativo (M6) del que deriva el brief. */
  readonly contextoCreativoId?: string;
  /** Razones para creer la promesa (respaldo argumental). */
  readonly razonesParaCreer?: readonly string[];
  /** Objeciones anticipadas de la audiencia. */
  readonly objeciones?: readonly string[];
  /** Referencias VERSIONADAS a afirmaciones de M5 usadas (no copias): base de obsolescencia. */
  readonly referenciasM5?: readonly { readonly afirmacionId: string; readonly version: number }[];
  /** Información faltante declarada (nunca se completa inventando). */
  readonly informacionFaltante?: readonly string[];
  /** Estado epistémico del brief (valor de EstadoEvaluabilidad de M5; tipado por el productor M6). */
  readonly estadoEpistemico?: string;
  /** Explicación de por qué el brief es (o no es) evaluable. */
  readonly explicacion?: string;
  /** Huella de las versiones de conocimiento M5 usadas (suma), para detectar obsolescencia. */
  readonly versionConocimiento?: number;
  /** Vigencia del brief respecto de M5. */
  readonly vigencia?: 'VIGENTE' | 'OBSOLETO' | 'REQUIERE_REVISION';
}

export const EVENTOS_BRIEF = {
  creado: 'brief.creado',
  transicion: 'brief.transicion',
} as const;

export function briefStreamId(briefId: string): string {
  return `brief:${briefId}`;
}

/** Campos sin los cuales el brief no puede producir contenido honesto. */
const OBLIGATORIOS: ReadonlyArray<keyof ContenidoBrief> = [
  'marcaId',
  'audiencia',
  'canalDestino',
  'proposito',
  'mensajePrincipal',
  'propuestaValor',
  'productoServicio',
  'llamadaAccion',
  'idioma',
];

export interface ValidacionBrief {
  readonly completo: boolean;
  readonly faltantes: string[];
}

export function validarBrief(c: ContenidoBrief): ValidacionBrief {
  const faltantes: string[] = [];
  for (const campo of OBLIGATORIOS) {
    const v = c[campo];
    if (typeof v === 'string' ? v.trim() === '' : v == null) faltantes.push(String(campo));
  }
  return { completo: faltantes.length === 0, faltantes };
}

const TRANSICIONES_BRIEF: Readonly<Record<EstadoBrief, readonly EstadoBrief[]>> = {
  borrador: ['evaluando', 'archivado'],
  evaluando: ['listo', 'incompleto', 'bloqueado'],
  incompleto: ['evaluando', 'archivado'],
  listo: ['bloqueado', 'reemplazado', 'archivado'],
  bloqueado: ['evaluando', 'archivado'],
  reemplazado: [],
  archivado: [],
};

export function transicionBriefValida(desde: EstadoBrief, hacia: EstadoBrief): boolean {
  return (TRANSICIONES_BRIEF[desde] ?? []).includes(hacia);
}

export interface BriefState {
  readonly briefId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly contenido: ContenidoBrief | null;
  readonly estado: EstadoBrief;
  readonly faltantes: readonly string[];
  readonly historial: readonly { estado: EstadoBrief; en: string }[];
}

export function estadoInicialBrief(briefId: string, organizationId: string): BriefState {
  return { briefId, organizationId, version: 0, existe: false, contenido: null, estado: 'borrador', faltantes: [], historial: [] };
}

interface PayloadCreado {
  contenido: ContenidoBrief;
  estado: EstadoBrief;
  faltantes: string[];
}
interface PayloadTransicion {
  nuevoEstado: EstadoBrief;
  faltantes: string[];
  en: string;
}

export function aplicarBrief(state: BriefState, event: RecordedEvent): BriefState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_BRIEF.creado: {
      const p = event.payload as PayloadCreado;
      return {
        ...next,
        existe: true,
        contenido: p.contenido,
        estado: p.estado,
        faltantes: p.faltantes,
        historial: [{ estado: p.estado, en: event.recordedAt }],
      };
    }
    case EVENTOS_BRIEF.transicion: {
      const p = event.payload as PayloadTransicion;
      if (!transicionBriefValida(state.estado, p.nuevoEstado)) return next;
      return { ...next, estado: p.nuevoEstado, faltantes: p.faltantes, historial: [...state.historial, { estado: p.nuevoEstado, en: p.en }] };
    }
    default:
      return next;
  }
}

export function reconstruirBrief(briefId: string, organizationId: string, events: readonly RecordedEvent[]): BriefState {
  return events.reduce(aplicarBrief, estadoInicialBrief(briefId, organizationId));
}
