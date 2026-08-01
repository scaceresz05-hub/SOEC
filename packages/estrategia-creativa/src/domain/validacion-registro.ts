/**
 * @soec/estrategia-creativa · dominio · REGISTRO de validación de contenido (A-3). Traza, event-sourced y
 * multi-tenant, el resultado de validar cada cuerpo generado: qué se pidió, qué salió, con qué versión de
 * estrategia/política, el veredicto y sus razones. Naturaleza SIMULADO. Una salida inválida queda registrada
 * (auditable) y NO produce pieza aprobable.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { ResultadoValidacion } from './validador-contenido';

export interface RegistroValidacion {
  readonly referencia: string; // estrategiaCreativaId + formato
  readonly promptRef: string;
  readonly estrategiaRef: string;
  readonly politicaVersion: string;
  readonly resultado: ResultadoValidacion;
  readonly razones: readonly string[];
  readonly afirmacionesNoRespaldadas: readonly string[];
  readonly longitudCuerpo: number;
  readonly naturaleza: 'SIMULADO';
  readonly en: string;
}

export interface ValidacionRegistroState {
  readonly organizationId: string;
  readonly referencia: string;
  readonly version: number;
  readonly historial: readonly RegistroValidacion[];
  readonly ultimo: RegistroValidacion | null;
}

export const EVENTOS_VALIDACION = { registrada: 'contenido.validacion_registrada' } as const;

export function validacionRegistroStreamId(org: string, referencia: string): string {
  return `contenido-validacion:${org}:${referencia}`;
}

export function reconstruirValidacionRegistro(org: string, referencia: string, events: readonly RecordedEvent[]): ValidacionRegistroState {
  return events.reduce<ValidacionRegistroState>(
    (st, ev) => {
      const next = { ...st, version: st.version + 1 };
      if (ev.type === EVENTOS_VALIDACION.registrada) {
        const r = ev.payload as RegistroValidacion;
        return { ...next, historial: [...st.historial, r], ultimo: r };
      }
      return next;
    },
    { organizationId: org, referencia, version: 0, historial: [], ultimo: null },
  );
}
