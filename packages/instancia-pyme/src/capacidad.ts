/**
 * La definición de «Comprender el estado» se extrajo a `@soec/capacidades` como
 * fuente declarativa ÚNICA (F2-DISC-01, paso 2). Este módulo solo re-exporta para
 * compatibilidad; `instanciar.ts` la consume directamente desde el paquete neutral.
 * No existe una segunda definición: hay una sola autoridad de la capacidad.
 */
export {
  definicionComprenderEstado,
  definicionComprenderEstado as capacidadComprenderEstado,
} from '@soec/capacidades';
