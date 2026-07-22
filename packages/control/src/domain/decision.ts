/**
 * Bandeja de decisiones excepcionales (F2-CTRL-01 §4.4, §11). Reúne las decisiones que
 * exceden la autonomía delegada (escalamiento, aumento de presupuesto, habilitación de
 * canal, cambio de modo…). El propietario/supervisor puede aprobar, denegar, modificar,
 * posponer o pedir más evidencia. La acción queda vinculada a política, evidencia, plan
 * y resultado. No existe aprobación genérica sin alcance.
 */
import type { RecordedEvent } from '@soec/contracts';

export type TipoDecision =
  | 'escalamiento_frecuencia'
  | 'aumento_presupuesto'
  | 'habilitar_canal'
  | 'afirmacion_sensible'
  | 'activo_no_validado'
  | 'reanudar_tras_anomalia'
  | 'cambio_modo'
  | 'habilitar_cuenta'
  | 'retiro_masivo';

export type EstadoDecision = 'pendiente' | 'aprobada' | 'denegada' | 'modificada' | 'pospuesta' | 'evidencia_solicitada';

export interface ContenidoDecision {
  readonly tipo: TipoDecision;
  readonly razon: string;
  readonly alcance: string;
  readonly efectoEsperado: string;
  readonly riesgo: 'bajo' | 'medio' | 'alto';
  readonly presupuestoImplicado: number;
  readonly evidencia: string;
  readonly alternativas: readonly string[];
  readonly recomendacionSistema: string;
  readonly politica: string;
  readonly refPlan: string;
}

export const EVENTOS_DEC = {
  registrada: 'dec.registrada',
  resuelta: 'dec.resuelta',
} as const;

export function decStreamId(decId: string): string {
  return `dec:${decId}`;
}

export interface DecisionState {
  readonly decId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly contenido: ContenidoDecision | null;
  readonly estado: EstadoDecision;
  readonly actorResolucion: string | null;
  readonly comentario: string;
  readonly modificacion: string | null;
  readonly historial: readonly { estado: EstadoDecision; actor: string; en: string }[];
}

export function estadoInicialDecision(decId: string, organizationId: string): DecisionState {
  return { decId, organizationId, version: 0, existe: false, contenido: null, estado: 'pendiente', actorResolucion: null, comentario: '', modificacion: null, historial: [] };
}

const TERMINALES: ReadonlySet<EstadoDecision> = new Set(['aprobada', 'denegada', 'modificada']);
export function decisionResuelta(estado: EstadoDecision): boolean {
  return TERMINALES.has(estado);
}

interface PayloadRegistrada {
  contenido: ContenidoDecision;
}
interface PayloadResuelta {
  estado: EstadoDecision;
  actor: string;
  comentario: string;
  modificacion: string | null;
}

export function aplicarDecision(state: DecisionState, event: RecordedEvent): DecisionState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_DEC.registrada: {
      const p = event.payload as PayloadRegistrada;
      return { ...next, existe: true, contenido: p.contenido, estado: 'pendiente', historial: [{ estado: 'pendiente', actor: 'sistema', en: event.recordedAt }] };
    }
    case EVENTOS_DEC.resuelta: {
      const p = event.payload as PayloadResuelta;
      // Una decisión ya resuelta de forma terminal no se re-resuelve.
      if (decisionResuelta(state.estado)) return next;
      return { ...next, estado: p.estado, actorResolucion: p.actor, comentario: p.comentario, modificacion: p.modificacion, historial: [...state.historial, { estado: p.estado, actor: p.actor, en: event.recordedAt }] };
    }
    default:
      return next;
  }
}

export function reconstruirDecision(decId: string, organizationId: string, events: readonly RecordedEvent[]): DecisionState {
  return events.reduce(aplicarDecision, estadoInicialDecision(decId, organizationId));
}
