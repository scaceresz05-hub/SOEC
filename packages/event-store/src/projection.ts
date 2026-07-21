import type { Projection, RecordedEvent } from '@soec/contracts';

/** Reconstruye el estado de una proyección a partir de la historia de eventos. */
export function project<S>(p: Projection<S>, events: readonly RecordedEvent[]): S {
  return events.reduce<S>((state, event) => p.apply(state, event), p.initial);
}
