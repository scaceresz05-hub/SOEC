/**
 * @soec/piloto-director-v1 — Piloto SmileFlow completo y adversarial (Bloque J del Director de
 * Marketing Autónomo V1). Orquesta los Bloques C–I sobre un único event-store, gobernado por
 * autonomía, y valida el ciclo end-to-end con trazabilidad hacia atrás hasta la evidencia
 * inicial, más ocho escenarios adversariales. Comando reproducible: `pnpm -C
 * packages/piloto-director-v1 piloto`.
 */
export * from './fixture';
export * from './piloto';
// Re-exporta el tipo de la vista para que los consumidores (runtime) tengan un único punto de
// entrada de integración sin depender directamente de @soec/director-workspace.
export type { VistaCicloDirector, Naturaleza, Dato, EjecucionSimuladaVista } from '@soec/director-workspace';
// Re-exporta las clases de error del ciclo para que el runtime las mapee a códigos HTTP sin
// depender directamente de cada paquete del clúster.
export { DecisionMktInvalidaError, TransicionInvalidaError } from '@soec/decisiones-mkt';
export { CampaniaInvalidaError, SeparacionCampaniaVioladaError, TransicionCampaniaInvalidaError } from '@soec/campanias';
export { ContenidoGobernadoInvalidoError, SeparacionContenidoVioladaError, TransicionContenidoInvalidaError } from '@soec/contenido-gobernado';
export { EjecucionInvalidaError, SeparacionEjecucionVioladaError } from '@soec/ejecucion-simulada';
export { AprendizajeInvalidoError, AplicacionSinDecisionHumanaError } from '@soec/aprendizaje';
