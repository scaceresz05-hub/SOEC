/**
 * Agregado de definición de capacidad (versionada, append-only).
 * Modificar una definición no reescribe ejecuciones anteriores: cada versión se
 * agrega; una ejecución histórica conserva la versión exacta usada (§13).
 */
import type { RecordedEvent } from '@soec/contracts';
import type { DefinicionVersion } from './definition';

export const EVENTOS_CAPDEF = {
  registrada: 'capdef.version_registrada',
  publicada: 'capdef.version_publicada',
  retirada: 'capdef.version_retirada',
} as const;

export function capdefStreamId(capabilityId: string): string {
  return `capdef:${capabilityId}`;
}

export interface CapDefState {
  readonly capabilityId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly versiones: Readonly<Record<number, DefinicionVersion>>;
  readonly publicadas: readonly number[];
  readonly retiradas: readonly number[];
  readonly vigente: number | null;
}

export function estadoInicialCapDef(capabilityId: string, organizationId: string): CapDefState {
  return {
    capabilityId,
    organizationId,
    version: 0,
    existe: false,
    versiones: {},
    publicadas: [],
    retiradas: [],
    vigente: null,
  };
}

interface PayloadRegistrada {
  definicion: DefinicionVersion;
}
interface PayloadVersion {
  version: number;
}

export function aplicarCapDef(state: CapDefState, event: RecordedEvent): CapDefState {
  const next = { ...state, version: state.version + 1 };
  if (event.type === EVENTOS_CAPDEF.registrada) {
    const p = event.payload as PayloadRegistrada;
    return {
      ...next,
      existe: true,
      versiones: { ...state.versiones, [p.definicion.version]: p.definicion },
    };
  }
  if (event.type === EVENTOS_CAPDEF.publicada) {
    const p = event.payload as PayloadVersion;
    return {
      ...next,
      publicadas: state.publicadas.includes(p.version) ? state.publicadas : [...state.publicadas, p.version],
      vigente: p.version, // la última publicada es la vigente
    };
  }
  if (event.type === EVENTOS_CAPDEF.retirada) {
    const p = event.payload as PayloadVersion;
    return {
      ...next,
      retiradas: state.retiradas.includes(p.version) ? state.retiradas : [...state.retiradas, p.version],
      vigente: state.vigente === p.version ? null : state.vigente,
    };
  }
  return next;
}

export function reconstruirCapDef(
  capabilityId: string,
  organizationId: string,
  events: readonly RecordedEvent[],
): CapDefState {
  return events.reduce(aplicarCapDef, estadoInicialCapDef(capabilityId, organizationId));
}
