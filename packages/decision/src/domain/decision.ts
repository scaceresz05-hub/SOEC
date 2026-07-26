/**
 * @soec/decision · dominio · Decisión institucional gobernada (F2-DISC-01, Paso 4).
 *
 * Registra el acto humano de decidir sobre una PROPUESTA del motor de Estrategia:
 * ACEPTAR un candidato (→ objetivo vigente) o RECHAZAR la propuesta. Append-only.
 * Estados históricos EXPLÍCITOS (VIGENTE/SUPERADA/REVOCADA/RECHAZADA): una nueva
 * aceptación supera a la vigente; revocar la vigente deja vigente=null SIN resucitar
 * una decisión superada. Congela la propuesta completa por valor, con huella de
 * integridad (SHA-256) y versión de esquema. Es un hecho de gobierno, NO ejecución.
 *
 * Agregado por Organización + Departamento. Invariante: a lo sumo un VIGENTE por par.
 */
import { createHash } from 'node:crypto';
import type { RecordedEvent } from '@soec/contracts';
import type { ComprensionEvaluable } from '@soec/diagnostico';
import type { CandidatoEstrategia, ResultadoEstrategia } from '@soec/estrategia';

export type ResultadoDecision = 'ACEPTADO' | 'RECHAZADO';
export type EstadoRegistro = 'VIGENTE' | 'SUPERADA' | 'REVOCADA' | 'RECHAZADA';

export type CategoriaJustificacion =
  'NEGOCIO' | 'PRESUPUESTO' | 'RIESGO' | 'REGULATORIO' | 'PRIORIDAD' | 'OTRO';
export const CATEGORIAS_JUSTIFICACION: readonly CategoriaJustificacion[] = [
  'NEGOCIO',
  'PRESUPUESTO',
  'RIESGO',
  'REGULATORIO',
  'PRIORIDAD',
  'OTRO',
];

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface JustificacionHumana {
  readonly texto: string;
  readonly categoria: CategoriaJustificacion;
}

export interface RechazoDetalle {
  readonly alcance: 'PROPUESTA_COMPLETA' | 'CANDIDATOS_ESPECIFICOS';
  readonly candidatosRechazados: readonly string[];
}

/** Instantánea inmutable (por valor) de lo que el Director efectivamente vio. */
export interface PropuestaSnapshot {
  readonly comprension: ComprensionEvaluable;
  readonly resultado: ResultadoEstrategia;
  readonly rubroId: string;
  readonly rubroHuella: string;
}

export interface DecisionRegistro {
  readonly decisionId: string;
  readonly resultado: ResultadoDecision;
  readonly candidatoElegido: CandidatoEstrategia | null;
  readonly propuesta: PropuestaSnapshot;
  readonly justificacion: JustificacionHumana;
  readonly actor: string;
  readonly en: string;
  readonly organizationId: string;
  readonly departamentoId: string;
  readonly reemplazaDecisionId: string | null;
  readonly rechazo: RechazoDetalle | null;
  readonly estadoRegistro: EstadoRegistro;
  readonly motivoRevocacion: string | null;
  readonly snapshotSchemaVersion: number;
  readonly snapshotHash: string;
}

export interface ObjetivoVigente {
  readonly decisionId: string;
  readonly candidato: CandidatoEstrategia;
  readonly en: string;
}

export const EVENTOS_DEC = {
  registrada: 'decision.registrada',
  revocada: 'decision.revocada',
} as const;

export function decStreamId(organizationId: string, departamentoId: string): string {
  // Prefijo propio 'objdecision:' — NO 'decision:', que ya usa @soec/control (bandeja).
  return `objdecision:${organizationId}:${departamentoId}`;
}

export interface DecisionState {
  readonly organizationId: string;
  readonly departamentoId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly vigente: ObjetivoVigente | null;
  readonly decisiones: readonly DecisionRegistro[];
}

export function estadoInicialDecision(
  organizationId: string,
  departamentoId: string,
): DecisionState {
  return {
    organizationId,
    departamentoId,
    version: 0,
    existe: false,
    vigente: null,
    decisiones: [],
  };
}

export interface ComandoDecision {
  readonly decisionId: string;
  readonly resultado: ResultadoDecision;
  readonly candidatoElegido: CandidatoEstrategia | null;
  readonly propuesta: PropuestaSnapshot;
  readonly justificacion: JustificacionHumana;
  readonly reemplazaDecisionId?: string | null;
  readonly rechazo?: RechazoDetalle;
}

// --- Integridad criptográfica del snapshot ---------------------------------

function canon(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return (
      '{' +
      Object.keys(o)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canon(o[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(v);
}

/** Huella SHA-256 sobre la representación canónica de la unidad congelada. */
export function huellaSnapshot(
  propuesta: PropuestaSnapshot,
  candidatoElegido: CandidatoEstrategia | null,
): string {
  const unidad = {
    comprension: propuesta.comprension,
    resultado: propuesta.resultado,
    candidato: candidatoElegido,
    rubroId: propuesta.rubroId,
    rubroHuella: propuesta.rubroHuella,
  };
  return createHash('sha256').update(canon(unidad), 'utf8').digest('hex');
}

/** Verifica que el snapshot congelado no fue alterado (huella recomputada coincide). */
export function verificarIntegridadSnapshot(r: DecisionRegistro): boolean {
  return huellaSnapshot(r.propuesta, r.candidatoElegido) === r.snapshotHash;
}

// --- Validación -------------------------------------------------------------

export function validarDecision(cmd: ComandoDecision): string[] {
  const errores: string[] = [];
  if (!cmd.justificacion || cmd.justificacion.texto.trim() === '')
    errores.push('justificacion_vacia');
  if (!CATEGORIAS_JUSTIFICACION.includes(cmd.justificacion?.categoria))
    errores.push('categoria_invalida');
  if (!/^[0-9a-f]{64}$/.test(cmd.propuesta.rubroHuella)) errores.push('rubro_huella_invalida');

  if (cmd.resultado === 'ACEPTADO') {
    if (cmd.propuesta.resultado.tipo !== 'PROPUESTA') {
      errores.push('resultado_no_es_propuesta');
    } else if (!cmd.candidatoElegido) {
      errores.push('aceptado_sin_candidato');
    } else {
      const enPropuesta = cmd.propuesta.resultado.candidatos.find(
        (c) => c.objetivoId === cmd.candidatoElegido!.objetivoId,
      );
      if (!enPropuesta) errores.push('candidato_fuera_de_la_propuesta');
      else if (canon(enPropuesta) !== canon(cmd.candidatoElegido))
        errores.push('candidato_alterado');
    }
  } else if (cmd.candidatoElegido) {
    errores.push('rechazado_con_candidato');
  }
  return errores;
}

// --- Reducer ----------------------------------------------------------------

interface PReg {
  decisionId: string;
  resultado: ResultadoDecision;
  candidatoElegido: CandidatoEstrategia | null;
  propuesta: PropuestaSnapshot;
  justificacion: JustificacionHumana;
  reemplazaDecisionId: string | null;
  rechazo: RechazoDetalle | null;
  snapshotSchemaVersion: number;
  snapshotHash: string;
}
interface PRev {
  decisionId: string;
  motivo: string;
}

function objetivoVigenteDe(decisiones: readonly DecisionRegistro[]): ObjetivoVigente | null {
  const v = decisiones.find((d) => d.estadoRegistro === 'VIGENTE');
  return v && v.candidatoElegido
    ? { decisionId: v.decisionId, candidato: v.candidatoElegido, en: v.en }
    : null;
}

export function aplicarDecision(state: DecisionState, event: RecordedEvent): DecisionState {
  const next = { ...state, version: state.version + 1, existe: true };
  switch (event.type) {
    case EVENTOS_DEC.registrada: {
      const p = event.payload as PReg;
      const base = {
        decisionId: p.decisionId,
        candidatoElegido: p.candidatoElegido,
        propuesta: p.propuesta,
        justificacion: p.justificacion,
        actor: String(event.actor),
        en: event.recordedAt,
        organizationId: state.organizationId,
        departamentoId: state.departamentoId,
        reemplazaDecisionId: p.reemplazaDecisionId,
        rechazo: p.rechazo,
        motivoRevocacion: null,
        snapshotSchemaVersion: p.snapshotSchemaVersion,
        snapshotHash: p.snapshotHash,
      };
      if (p.resultado === 'ACEPTADO') {
        // La aceptación vigente pasa a SUPERADA; la nueva queda VIGENTE.
        const previas = state.decisiones.map((d) =>
          d.estadoRegistro === 'VIGENTE'
            ? { ...d, estadoRegistro: 'SUPERADA' as EstadoRegistro }
            : d,
        );
        const decisiones = [
          ...previas,
          {
            ...base,
            resultado: 'ACEPTADO' as ResultadoDecision,
            estadoRegistro: 'VIGENTE' as EstadoRegistro,
          },
        ];
        return { ...next, decisiones, vigente: objetivoVigenteDe(decisiones) };
      }
      // RECHAZADO: se registra; NO modifica el objetivo vigente existente.
      const decisiones = [
        ...state.decisiones,
        {
          ...base,
          resultado: 'RECHAZADO' as ResultadoDecision,
          estadoRegistro: 'RECHAZADA' as EstadoRegistro,
        },
      ];
      return { ...next, decisiones, vigente: state.vigente };
    }
    case EVENTOS_DEC.revocada: {
      const p = event.payload as PRev;
      // Solo la VIGENTE puede revocarse (garantizado por el servicio). No resucita histórico.
      const decisiones = state.decisiones.map((d) =>
        d.decisionId === p.decisionId && d.estadoRegistro === 'VIGENTE'
          ? { ...d, estadoRegistro: 'REVOCADA' as EstadoRegistro, motivoRevocacion: p.motivo }
          : d,
      );
      return { ...next, decisiones, vigente: objetivoVigenteDe(decisiones) };
    }
    default:
      return next;
  }
}

export function reconstruirDecision(
  organizationId: string,
  departamentoId: string,
  events: readonly RecordedEvent[],
): DecisionState {
  return events.reduce(aplicarDecision, estadoInicialDecision(organizationId, departamentoId));
}
