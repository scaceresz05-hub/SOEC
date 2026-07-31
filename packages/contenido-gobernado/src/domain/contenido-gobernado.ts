/**
 * @soec/contenido-gobernado · dominio · Contenido gobernado por el contexto de campaña (Bloque D).
 *
 * NO duplica la fábrica de contenido (`@soec/contenido`): reutiliza su contrato de brief
 * (`ContenidoBrief` + `validarBrief`) y le impone la capa de gobierno que el ciclo del Director
 * Autónomo exige:
 *   - El contenido hereda org, `campaniaId`, `decisionId`, público y fuentes de la campaña; una
 *     referencia externa NO puede cambiar la organización del contenido.
 *   - Contenido RECHAZADO no puede programarse ni publicarse.
 *   - Una nueva versión preserva la trazabilidad previa (campaña, decisión, versión anterior).
 *   - PUBLICADO_SIMULADO nunca es productivo: es una simulación, no un efecto real.
 * Event-sourced (`contenido-gob:<org>:<id>`).
 */
import type { RecordedEvent } from '@soec/contracts';
import type { ContenidoBrief } from '@soec/contenido';

export type EstadoContenido =
  | 'BORRADOR'
  | 'EN_REVISION'
  | 'APROBADO'
  | 'RECHAZADO'
  | 'PROGRAMADO'
  | 'PUBLICADO_SIMULADO'
  | 'ARCHIVADO';

export interface ContenidoGobernado {
  readonly contenidoId: string;
  readonly organizacionId: string;
  readonly campaniaId: string;
  readonly decisionId: string;
  readonly publico: string;
  readonly fuentes: readonly string[];
  readonly canal: string;
  readonly cuerpo: string;
  readonly brief: ContenidoBrief | null;
  readonly faltantesBrief: readonly string[];
  /** Revisión editorial del contenido (1, 2, 3…), independiente de la versión del stream. */
  readonly revision: number;
  readonly revisionPreviaCuerpo: string | null;
  readonly estado: EstadoContenido;
  readonly autor: string;
  readonly en: string;
  readonly version: number;
  readonly existe: boolean;
}

const TRANSICIONES: Readonly<Record<EstadoContenido, readonly EstadoContenido[]>> = {
  BORRADOR: ['EN_REVISION', 'ARCHIVADO'],
  EN_REVISION: ['APROBADO', 'RECHAZADO'],
  APROBADO: ['PROGRAMADO', 'ARCHIVADO'],
  // RECHAZADO NO transiciona a PROGRAMADO: contenido rechazado no puede programarse.
  RECHAZADO: ['ARCHIVADO'],
  PROGRAMADO: ['PUBLICADO_SIMULADO', 'ARCHIVADO'],
  PUBLICADO_SIMULADO: ['ARCHIVADO'],
  ARCHIVADO: [],
};
export function transicionContenidoValida(desde: EstadoContenido, hacia: EstadoContenido): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/** Un contenido publicado de forma simulada NUNCA es productivo: no hubo efecto externo real. */
export function esProductivo(_estado: EstadoContenido): boolean {
  return false;
}

export const EVENTOS_CONTENIDO = {
  creado: 'contenido-gob.creado',
  transicionado: 'contenido-gob.transicionado',
  versionado: 'contenido-gob.versionado',
} as const;

export function contenidoGobStreamId(organizacionId: string, contenidoId: string): string {
  return `contenido-gob:${organizacionId}:${contenidoId}`;
}

export function estadoInicialContenido(organizacionId: string, contenidoId: string): ContenidoGobernado {
  return {
    contenidoId,
    organizacionId,
    campaniaId: '',
    decisionId: '',
    publico: '',
    fuentes: [],
    canal: '',
    cuerpo: '',
    brief: null,
    faltantesBrief: [],
    revision: 0,
    revisionPreviaCuerpo: null,
    estado: 'BORRADOR',
    autor: '',
    en: '',
    version: 0,
    existe: false,
  };
}

type PayloadCreado = Omit<ContenidoGobernado, 'autor' | 'en' | 'version' | 'existe' | 'revision' | 'revisionPreviaCuerpo'>;

export function aplicarContenido(state: ContenidoGobernado, event: RecordedEvent): ContenidoGobernado {
  const next = { ...state, version: state.version + 1, existe: true };
  switch (event.type) {
    case EVENTOS_CONTENIDO.creado: {
      const p = event.payload as PayloadCreado;
      return { ...next, ...p, revision: 1, revisionPreviaCuerpo: null, autor: String(event.actor), en: event.recordedAt };
    }
    case EVENTOS_CONTENIDO.transicionado:
      return { ...next, estado: (event.payload as { estado: EstadoContenido }).estado };
    case EVENTOS_CONTENIDO.versionado: {
      const p = event.payload as { cuerpo: string };
      // Nueva versión: conserva campaña, decisión, público y fuentes; vuelve a BORRADOR.
      return {
        ...next,
        revision: state.revision + 1,
        revisionPreviaCuerpo: state.cuerpo,
        cuerpo: p.cuerpo,
        estado: 'BORRADOR',
      };
    }
    default:
      return next;
  }
}

export function reconstruirContenido(organizacionId: string, contenidoId: string, events: readonly RecordedEvent[]): ContenidoGobernado {
  return events.reduce(aplicarContenido, estadoInicialContenido(organizacionId, contenidoId));
}
