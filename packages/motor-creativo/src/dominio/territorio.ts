/**
 * @soec/motor-creativo · dominio · TERRITORIO CREATIVO (agregado event-sourced).
 *
 * Una dirección conceptual amplia y durable (educación, transformación, confianza, prevención…). NO es
 * una pieza ni una campaña: es la tesis creativa de la que luego cuelgan estrategia, mensajes y piezas.
 * Su evidencia son REFERENCIAS a afirmaciones de M5 (por id + versión), nunca copias. Su evaluabilidad y
 * confianza se DERIVAN evaluando esas afirmaciones con el núcleo de M5 (no se almacena un veredicto).
 *
 * Multi-tenant, stream `creativo-territorio:<org>:<territorioId>`.
 */
import type { RecordedEvent } from '@soec/contracts';

/** Referencia versionada a una afirmación de M5 que sostiene el territorio. */
export interface EvidenciaTerritorio {
  readonly afirmacionId: string;
  readonly version: number;
}

export interface TerritorioState {
  readonly organizacionId: string;
  readonly territorioId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly tesis: string;
  /** Referencia a la audiencia (afirmación ICP o BUYER_PERSONA de M5). */
  readonly audienciaRef: string | null;
  readonly problemaCentral: string;
  readonly tension: string;
  readonly beneficio: string;
  readonly prueba: string;
  readonly riesgos: readonly string[];
  readonly evidencias: readonly EvidenciaTerritorio[];
  /** Compatibilidad con la marca: declaración explícita (COMPATIBLE / TENSION / INCOMPATIBLE + nota). */
  readonly compatibilidadMarca: string;
  readonly retirado: boolean;
}

export const EVENTOS_TERRITORIO = {
  registrado: 'creativo.territorio_registrado',
  actualizado: 'creativo.territorio_actualizado',
  evidencia: 'creativo.territorio_evidencia_agregada',
  retirado: 'creativo.territorio_retirado',
} as const;

export function territorioStreamId(organizacionId: string, territorioId: string): string {
  return `creativo-territorio:${organizacionId}:${territorioId}`;
}

export function estadoInicialTerritorio(organizacionId: string, territorioId: string): TerritorioState {
  return {
    organizacionId,
    territorioId,
    version: 0,
    existe: false,
    tesis: '',
    audienciaRef: null,
    problemaCentral: '',
    tension: '',
    beneficio: '',
    prueba: '',
    riesgos: [],
    evidencias: [],
    compatibilidadMarca: '',
    retirado: false,
  };
}

/** Contenido editable de un territorio (sin metadata). */
export interface ContenidoTerritorio {
  readonly tesis: string;
  readonly audienciaRef: string | null;
  readonly problemaCentral: string;
  readonly tension: string;
  readonly beneficio: string;
  readonly prueba: string;
  readonly riesgos: readonly string[];
  readonly compatibilidadMarca: string;
}

export function aplicarTerritorio(state: TerritorioState, event: RecordedEvent): TerritorioState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_TERRITORIO.registrado:
    case EVENTOS_TERRITORIO.actualizado: {
      const p = event.payload as ContenidoTerritorio;
      return {
        ...next,
        existe: true,
        tesis: p.tesis,
        audienciaRef: p.audienciaRef,
        problemaCentral: p.problemaCentral,
        tension: p.tension,
        beneficio: p.beneficio,
        prueba: p.prueba,
        riesgos: p.riesgos,
        compatibilidadMarca: p.compatibilidadMarca,
      };
    }
    case EVENTOS_TERRITORIO.evidencia: {
      const p = event.payload as EvidenciaTerritorio;
      if (state.evidencias.some((e) => e.afirmacionId === p.afirmacionId)) return next; // idempotente por id
      return { ...next, evidencias: [...state.evidencias, p] };
    }
    case EVENTOS_TERRITORIO.retirado:
      return { ...next, retirado: true };
    default:
      return next;
  }
}

export function reconstruirTerritorio(
  organizacionId: string,
  territorioId: string,
  events: readonly RecordedEvent[],
): TerritorioState {
  return events.reduce(aplicarTerritorio, estadoInicialTerritorio(organizacionId, territorioId));
}
