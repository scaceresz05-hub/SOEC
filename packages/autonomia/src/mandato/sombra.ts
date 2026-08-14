/**
 * @soec/autonomia · mandato · MODO SOMBRA (shadow) + AUDITORÍA.
 *
 * El resultado operativo de este bloque: SOEC decide QUÉ HARÍA con los datos reales, usando EXACTAMENTE
 * los mismos gates que usaría la ejecución real (`evaluarAccion`), pero SIN llamar a ningún adaptador.
 * Por construcción, las mutaciones externas son 0: este módulo no importa ningún cliente externo.
 *
 * Cada evaluación deja una traza auditable: qué vio SOEC, qué política aplicó, qué acción consideró,
 * por qué fue (o no) elegible, qué versión de mandato regía y qué límites había — para responder
 * siempre «¿por qué hiciste (o no hiciste) esto?».
 */
import { evaluarAccion, type AccionPropuesta, type ContextoEjecucion, type Decision, type ResultadoGate } from './gates';
import type { MandatoAutonomia } from './mandato';

export type ResultadoSombra = 'WOULD_EXECUTE' | 'WOULD_REQUIRE_APPROVAL' | 'WOULD_OBSERVE_MORE' | 'WOULD_DENY';

export function decisionASombra(d: Decision): ResultadoSombra {
  switch (d) {
    case 'EXECUTE':
      return 'WOULD_EXECUTE';
    case 'REQUIRE_APPROVAL':
      return 'WOULD_REQUIRE_APPROVAL';
    case 'OBSERVE_MORE':
      return 'WOULD_OBSERVE_MORE';
    case 'DENY':
      return 'WOULD_DENY';
  }
}

/** Registro de auditoría por acción evaluada (tenant-scoped). Responde «¿por qué?». */
export interface RegistroDecisionSombra {
  readonly actionId: string;
  readonly tipo: string;
  readonly targetId: string;
  readonly sombra: ResultadoSombra;
  readonly razon: string;
  readonly explicacion: string;
  readonly mandateVersion: number;
  readonly limitesEnLaDecision: { readonly financieros: unknown; readonly cambio: unknown };
  readonly evidenciaVista: { readonly muestra: number; readonly ventanaHoras: number };
  readonly traza: ResultadoGate['traza'];
}

export interface ReporteSombra {
  readonly organizationId: string;
  readonly externalAccountId: string;
  readonly mandateVersion: number;
  readonly nivel: string;
  readonly ahora: string;
  readonly totalEvaluadas: number;
  readonly wouldExecute: number;
  readonly wouldRequireApproval: number;
  readonly wouldObserveMore: number;
  readonly wouldDeny: number;
  /** Invariante DURA de este bloque: el modo sombra nunca muta nada externo. */
  readonly mutacionesExternas: 0;
  readonly decisiones: readonly RegistroDecisionSombra[];
}

/**
 * Evalúa en SOMBRA un conjunto de acciones candidatas contra el mandato y contexto vigentes.
 * Usa el pipeline real de gates; jamás ejecuta. `mutacionesExternas` es literalmente 0.
 */
export function evaluarSombra(
  acciones: readonly AccionPropuesta[],
  ctx: ContextoEjecucion,
): ReporteSombra {
  const m: MandatoAutonomia = ctx.mandato;
  const decisiones: RegistroDecisionSombra[] = acciones.map((a) => {
    const r = evaluarAccion(a, ctx);
    return {
      actionId: a.actionId,
      tipo: a.tipo,
      targetId: a.targetId,
      sombra: decisionASombra(r.decision),
      razon: r.razon,
      explicacion: r.explicacion,
      mandateVersion: m.version,
      limitesEnLaDecision: { financieros: m.limitesFinancieros, cambio: m.limitesCambio },
      evidenciaVista: { muestra: a.evidencia.muestra, ventanaHoras: a.evidencia.ventanaHoras },
      traza: r.traza,
    };
  });
  const cuenta = (s: ResultadoSombra): number => decisiones.filter((d) => d.sombra === s).length;
  return {
    organizationId: m.organizationId,
    externalAccountId: m.externalAccountId,
    mandateVersion: m.version,
    nivel: m.nivel,
    ahora: ctx.ahora,
    totalEvaluadas: decisiones.length,
    wouldExecute: cuenta('WOULD_EXECUTE'),
    wouldRequireApproval: cuenta('WOULD_REQUIRE_APPROVAL'),
    wouldObserveMore: cuenta('WOULD_OBSERVE_MORE'),
    wouldDeny: cuenta('WOULD_DENY'),
    mutacionesExternas: 0,
    decisiones,
  };
}
