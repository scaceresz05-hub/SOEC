import { InMemoryEventStore } from '../src/in-memory';
import { runEventStoreConformance } from './conformance';

// La implementación de referencia en memoria pasa toda la batería de conformidad.
runEventStoreConformance('InMemory', async () => ({
  store: new InMemoryEventStore(),
  cleanup: async () => undefined,
}));
