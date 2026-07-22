/**
 * Ensayo general del piloto (F2-PILOT-01 §19–§21). Recorre onboarding → readiness →
 * política → plan → contenido → publicación EMULADA → métricas → optimización → pausa →
 * rollback → reanudación → informe, en entorno no productivo. Cada ejecución es un
 * ensayo distinto; idempotente por identidad. Registra incidencias con su regla de
 * escalamiento (no toda alerta es incidencia). Ningún efecto/gasto real.
 */
import type { RecordedEvent } from '@soec/contracts';

export type EscenarioEnsayo = 'exitoso' | 'onboarding_incompleto' | 'credencial_pendiente' | 'activo_faltante' | 'presupuesto_invalido' | 'suspension' | 'rollback' | 'repeticion';
export type ResultadoEnsayo = 'apto_para_activacion' | 'bloqueado' | 'suspendido' | 'incompleto' | 'inconcluso';

export interface PasoEnsayo {
  readonly nombre: string;
  readonly estado: 'ok' | 'bloqueado' | 'omitido' | 'suspendido';
  readonly detalle: string;
}
export interface Incidencia {
  readonly codigo: string;
  readonly categoria: string;
  readonly severidad: 'menor' | 'mayor' | 'critico';
  readonly descripcion: string;
  readonly evidencia: string;
  readonly accionInmediata: string;
  readonly estado: 'abierta' | 'en_curso' | 'resuelta';
}

export const EVENTOS_ENS = { ejecutado: 'ens.ejecutado' } as const;

export function ensStreamId(ensId: string): string {
  return `ens:${ensId}`;
}

export interface EnsayoState {
  readonly ensId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly orgRef: string;
  readonly escenario: EscenarioEnsayo;
  readonly pasos: readonly PasoEnsayo[];
  readonly incidencias: readonly Incidencia[];
  readonly rollbackVerificado: boolean;
  readonly resultado: ResultadoEnsayo | null;
  readonly en: string;
}

export function estadoInicialEnsayo(ensId: string, organizationId: string): EnsayoState {
  return { ensId, organizationId, version: 0, existe: false, orgRef: '', escenario: 'exitoso', pasos: [], incidencias: [], rollbackVerificado: false, resultado: null, en: '' };
}

export interface PayloadEjecutado {
  orgRef: string;
  escenario: EscenarioEnsayo;
  pasos: PasoEnsayo[];
  incidencias: Incidencia[];
  rollbackVerificado: boolean;
  resultado: ResultadoEnsayo;
}

export function aplicarEnsayo(state: EnsayoState, event: RecordedEvent): EnsayoState {
  const next = { ...state, version: state.version + 1 };
  if (event.type === EVENTOS_ENS.ejecutado) {
    const p = event.payload as PayloadEjecutado;
    return { ...next, existe: true, orgRef: p.orgRef, escenario: p.escenario, pasos: p.pasos, incidencias: p.incidencias, rollbackVerificado: p.rollbackVerificado, resultado: p.resultado, en: event.recordedAt };
  }
  return next;
}

export function reconstruirEnsayo(ensId: string, organizationId: string, events: readonly RecordedEvent[]): EnsayoState {
  return events.reduce(aplicarEnsayo, estadoInicialEnsayo(ensId, organizationId));
}

/** Regla de escalamiento: solo las anomalías mayores/críticas se elevan a incidencia. */
export function esIncidencia(severidad: 'menor' | 'mayor' | 'critico'): boolean {
  return severidad === 'mayor' || severidad === 'critico';
}
