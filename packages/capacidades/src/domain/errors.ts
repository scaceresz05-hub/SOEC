import { SoecError } from '@soec/contracts';

/** La definición de capacidad no existe. */
export class DefinicionNoEncontradaError extends SoecError {}
/** Falta un dato obligatorio en la definición o la solicitud (propósito, etc.). */
export class DefinicionInvalidaError extends SoecError {}
/** La definición compone una operación que el #13 no contiene. */
export class OperacionDesconocidaError extends SoecError {}
/** La composición formaría un ciclo (capacidad que se compone de sí misma, directa o indirectamente). */
export class CicloDetectadoError extends SoecError {}
/** No hay una versión publicada/vigente que resolver. */
export class VersionNoDisponibleError extends SoecError {}
/** La ejecución de capacidad solicitada no existe. */
export class EjecucionCapacidadNoEncontradaError extends SoecError {}
/** El producto compuesto viola la soberanía (sería vinculante) o la anti-atrofia (es opaco). */
export class GuardarrailCapacidadError extends SoecError {}
