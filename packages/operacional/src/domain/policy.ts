/**
 * Política operativa versionada — SSOT de la AUTORIZACIÓN (ADR-0009 D-2/D-3).
 *
 * Ninguna acción operativa se ejecuta sin una política vigente que la autorice.
 * Modificar una política no reescribe ejecuciones anteriores; una acción histórica
 * conserva la versión exacta que la autorizó. La persona conserva la autoridad
 * estratégica; SOEC ejecuta solo lo que la política delega (Const. 2.4 v1.7).
 */
import type { Attribution, RecordedEvent } from '@soec/contracts';

export type NivelAutonomia = 0 | 1 | 2 | 3 | 4 | 5;
export type ClaseRiesgo = 'bajo' | 'medio' | 'alto';
export type EstadoPolitica = 'borrador' | 'vigente' | 'suspendida' | 'revocada';

/** Contenido de una versión de política. Datos de dominio; sin metadatos técnicos. */
export interface ContenidoPolitica {
  readonly empresa: string;
  readonly objetivo: string;
  readonly canalesAutorizados: readonly string[];
  readonly presupuestoTotal: number;
  readonly presupuestoDiario: number | null;
  readonly productosRestringidos: readonly string[];
  /** Subcadenas prohibidas en el contenido de una acción. */
  readonly afirmacionesProhibidas: readonly string[];
  /** Tipos de acción nunca permitidos. */
  readonly accionesProhibidas: readonly string[];
  /** Tipos de acción que exigen aprobación humana explícita (no auto-ejecutables). */
  readonly accionesRequierenAprobacion: readonly string[];
  readonly nivelAutonomia: NivelAutonomia;
  /** Riesgo por tipo de acción; el alto riesgo exige aprobación. */
  readonly riesgoPorAccion: Readonly<Record<string, ClaseRiesgo>>;
}

export interface VersionPolitica extends ContenidoPolitica {
  readonly version: number;
  readonly vigenciaDesde: string;
  readonly atribucion: Attribution;
}

export const EVENTOS_POL = {
  registrada: 'pol.version_registrada',
  publicada: 'pol.version_publicada',
  suspendida: 'pol.suspendida',
  reanudada: 'pol.reanudada',
  revocada: 'pol.revocada',
} as const;

export function polStreamId(policyId: string): string {
  return `pol:${policyId}`;
}

export interface PolicyState {
  readonly policyId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly versiones: Readonly<Record<number, VersionPolitica>>;
  readonly vigente: number | null;
  readonly estado: EstadoPolitica;
}

export function estadoInicialPolicy(policyId: string, organizationId: string): PolicyState {
  return { policyId, organizationId, version: 0, existe: false, versiones: {}, vigente: null, estado: 'borrador' };
}

interface PayloadRegistrada {
  version: VersionPolitica;
}
interface PayloadVersion {
  version: number;
}

export function aplicarPolicy(state: PolicyState, event: RecordedEvent): PolicyState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_POL.registrada: {
      const p = event.payload as PayloadRegistrada;
      return { ...next, existe: true, versiones: { ...state.versiones, [p.version.version]: p.version } };
    }
    case EVENTOS_POL.publicada: {
      const p = event.payload as PayloadVersion;
      return { ...next, vigente: p.version, estado: 'vigente' };
    }
    case EVENTOS_POL.suspendida:
      return { ...next, estado: 'suspendida' };
    case EVENTOS_POL.reanudada:
      return { ...next, estado: state.vigente !== null ? 'vigente' : state.estado };
    case EVENTOS_POL.revocada:
      return { ...next, estado: 'revocada' };
    default:
      return next;
  }
}

export function reconstruirPolicy(policyId: string, organizationId: string, events: readonly RecordedEvent[]): PolicyState {
  return events.reduce(aplicarPolicy, estadoInicialPolicy(policyId, organizationId));
}

/** La versión vigente y aplicable (excluye suspendida/revocada). */
export function versionVigente(state: PolicyState): VersionPolitica | null {
  if (!state.existe || state.vigente === null) return null;
  if (state.estado !== 'vigente') return null;
  return state.versiones[state.vigente] ?? null;
}
