/**
 * Prompts como activos versionados (F2-CONT-01 §10). Las instrucciones de
 * generación NO viven dispersas como strings en el código: se modelan como
 * plantillas con propósito, versión, variables, restricciones, esquema esperado,
 * idioma, estado, vigencia, historial y huella. Se conserva qué versión produjo
 * cada pieza. No se almacena razonamiento privado, solo instrucciones y esquema.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { TareaGenerativa } from './generative';

export type EstadoPrompt = 'borrador' | 'vigente' | 'reemplazado' | 'archivado';

export interface ContenidoPrompt {
  readonly proposito: string;
  readonly tarea: TareaGenerativa;
  /** Instrucción con marcadores {{variable}}. */
  readonly plantilla: string;
  readonly variables: readonly string[];
  readonly restricciones: readonly string[];
  readonly esquemaEsperado: readonly string[];
  readonly idioma: string;
}

export interface VersionPrompt extends ContenidoPrompt {
  readonly version: number;
  readonly vigenciaDesde: string;
  /** Huella determinista del contenido (no aleatoria). */
  readonly huella: string;
}

/** Huella determinista simple (suma de caracteres) — reproducible, sin azar. */
export function huellaPrompt(c: ContenidoPrompt): string {
  const base = `${c.tarea}|${c.plantilla}|${c.esquemaEsperado.join(',')}|${c.idioma}`;
  let h = 0;
  for (let i = 0; i < base.length; i += 1) h = (h * 31 + base.charCodeAt(i)) % 1_000_000_007;
  return `h${h.toString(16)}`;
}

export const EVENTOS_PROMPT = {
  registrado: 'prompt.version_registrada',
  publicado: 'prompt.version_publicada',
} as const;

export function promptStreamId(promptId: string): string {
  return `prompt:${promptId}`;
}

export interface PromptState {
  readonly promptId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly versiones: Readonly<Record<number, VersionPrompt>>;
  readonly vigente: number | null;
}

export function estadoInicialPrompt(promptId: string, organizationId: string): PromptState {
  return { promptId, organizationId, version: 0, existe: false, versiones: {}, vigente: null };
}

interface PayloadRegistrado {
  version: VersionPrompt;
}
interface PayloadVersion {
  version: number;
}

export function aplicarPrompt(state: PromptState, event: RecordedEvent): PromptState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_PROMPT.registrado: {
      const p = event.payload as PayloadRegistrado;
      return { ...next, existe: true, versiones: { ...state.versiones, [p.version.version]: p.version } };
    }
    case EVENTOS_PROMPT.publicado: {
      const p = event.payload as PayloadVersion;
      return { ...next, vigente: p.version };
    }
    default:
      return next;
  }
}

export function reconstruirPrompt(promptId: string, organizationId: string, events: readonly RecordedEvent[]): PromptState {
  return events.reduce(aplicarPrompt, estadoInicialPrompt(promptId, organizationId));
}

export function versionVigentePrompt(state: PromptState): VersionPrompt | null {
  if (!state.existe || state.vigente === null) return null;
  return state.versiones[state.vigente] ?? null;
}

/** Referencia estable a la versión de prompt que produjo una pieza. */
export function promptRef(promptId: string, version: number, huella: string): string {
  return `prompt:${promptId}@v${version}#${huella}`;
}
