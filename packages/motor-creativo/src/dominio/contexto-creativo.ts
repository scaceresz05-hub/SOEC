/**
 * @soec/motor-creativo · dominio · CONTEXTO CREATIVO (agregado event-sourced).
 *
 * El puente entre M5 (conocimiento) y M6 (dirección creativa). Es una proyección INMUTABLE y VERSIONADA
 * derivada EXCLUSIVAMENTE del conocimiento estratégico de M5: contiene REFERENCIAS (no copias) a las
 * afirmaciones de `@soec/motor-estrategico` por `afirmacionId` + la VERSIÓN del agregado usada + el estado
 * de evaluabilidad observado al construirlo. Nunca copia el contenido de M5 (SSOT intacto).
 *
 * Clave de gobernanza: al registrar la versión del conocimiento usado, un cambio SIGNIFICATIVO en M5
 * (nueva versión de una afirmación referenciada) vuelve OBSOLETO el contexto — y con él, la dirección
 * creativa derivada. Un contexto obsoleto no se muta en silencio: se detecta y se versiona/rehace.
 *
 * Multi-tenant, stream `creativo-contexto:<org>:<contextoId>`.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { ClaseAfirmacion, EstadoEvaluabilidad } from '@soec/motor-estrategico';

/** Rol que juega una afirmación de M5 dentro del contexto creativo (nunca inferido: declarado). */
export type RolConocimiento =
  | 'EMPRESA'
  | 'OBJETIVO'
  | 'ICP'
  | 'BUYER_PERSONA'
  | 'PROPUESTA_VALOR'
  | 'HIPOTESIS'
  | 'MERCADO'
  | 'COMPETENCIA'
  | 'EVIDENCIA'
  | 'RESTRICCION';

/** Referencia versionada a una afirmación de M5. Snapshot de (id, versión, estado) al construir. */
export interface ReferenciaConocimiento {
  readonly rol: RolConocimiento;
  readonly afirmacionId: string;
  readonly clase: ClaseAfirmacion;
  /** Versión del agregado de M5 usada. Base de la obsolescencia. */
  readonly version: number;
  /** Estado de evaluabilidad observado al construir el contexto (derivado en M5). */
  readonly estado: EstadoEvaluabilidad;
}

export interface ContextoCreativoState {
  readonly organizacionId: string;
  readonly contextoId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly referencias: readonly ReferenciaConocimiento[];
  /** Roles pedidos que M5 no pudo sostener (NO_EVALUABLE / ausentes): faltantes declarados. */
  readonly faltantes: readonly string[];
  readonly construidoEn: string | null;
  /** Marcado obsoleto explícitamente (una versión referenciada de M5 cambió). */
  readonly obsoleto: boolean;
  readonly motivoObsolescencia: string | null;
}

export const EVENTOS_CONTEXTO = {
  construido: 'creativo.contexto_construido',
  obsoleto: 'creativo.contexto_marcado_obsoleto',
} as const;

export function contextoCreativoStreamId(organizacionId: string, contextoId: string): string {
  return `creativo-contexto:${organizacionId}:${contextoId}`;
}

export function estadoInicialContexto(organizacionId: string, contextoId: string): ContextoCreativoState {
  return {
    organizacionId,
    contextoId,
    version: 0,
    existe: false,
    referencias: [],
    faltantes: [],
    construidoEn: null,
    obsoleto: false,
    motivoObsolescencia: null,
  };
}

interface PConstruido {
  referencias: readonly ReferenciaConocimiento[];
  faltantes: readonly string[];
}
interface PObsoleto {
  motivo: string;
}

export function aplicarContexto(state: ContextoCreativoState, event: RecordedEvent): ContextoCreativoState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_CONTEXTO.construido: {
      const p = event.payload as PConstruido;
      // Inmutable por construcción: si ya existe, un reconstruir crea una NUEVA versión del contexto
      // (mismo id) que REEMPLAZA las referencias; nunca se mutan las de una versión previa in situ.
      return {
        ...next,
        existe: true,
        referencias: p.referencias,
        faltantes: p.faltantes,
        construidoEn: event.recordedAt,
        obsoleto: false,
        motivoObsolescencia: null,
      };
    }
    case EVENTOS_CONTEXTO.obsoleto: {
      const p = event.payload as PObsoleto;
      return { ...next, obsoleto: true, motivoObsolescencia: p.motivo };
    }
    default:
      return next;
  }
}

export function reconstruirContexto(
  organizacionId: string,
  contextoId: string,
  events: readonly RecordedEvent[],
): ContextoCreativoState {
  return events.reduce(aplicarContexto, estadoInicialContexto(organizacionId, contextoId));
}

/** ¿El contexto es utilizable para producir dirección creativa concluyente? */
export function contextoEvaluable(state: ContextoCreativoState): boolean {
  return state.existe && !state.obsoleto && state.faltantes.length === 0;
}

/**
 * Detección PURA de obsolescencia: compara las versiones de M5 congeladas en el contexto contra las
 * versiones ACTUALES (leídas por el servicio desde M5). Devuelve las referencias cuya versión cambió
 * o desaparecieron. Determinista; sin efectos. Si el resultado no es vacío, el contexto está obsoleto.
 */
export interface DesajusteReferencia {
  readonly afirmacionId: string;
  readonly versionUsada: number;
  readonly versionActual: number | null; // null = la afirmación ya no existe / no es legible
}

export function detectarObsolescencia(
  state: ContextoCreativoState,
  versionesActuales: Readonly<Record<string, number>>,
): readonly DesajusteReferencia[] {
  const desajustes: DesajusteReferencia[] = [];
  for (const ref of state.referencias) {
    const actual = Object.prototype.hasOwnProperty.call(versionesActuales, ref.afirmacionId)
      ? versionesActuales[ref.afirmacionId]!
      : null;
    if (actual === null || actual !== ref.version) {
      desajustes.push({ afirmacionId: ref.afirmacionId, versionUsada: ref.version, versionActual: actual });
    }
  }
  return desajustes;
}
