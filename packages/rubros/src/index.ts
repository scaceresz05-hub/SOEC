/**
 * @soec/rubros — Biblioteca de Conocimiento por Rubro (frontera pública).
 *
 * El conocimiento se entrega EXCLUSIVAMENTE como `RubroKnowledgePort` mediante
 * fábricas con nombre (`crearBibliotecaClinicaDental`, `obtenerBiblioteca`). La
 * estructura cruda de la biblioteca (`RubroKnowledge`), la validación, la
 * canonicalización, las huellas y la fábrica genérica son INTERNAS (accesibles solo
 * dentro del paquete y en pruebas): así ningún consumidor puede saltarse el puerto
 * (criterio 3). Componente autónomo, sin dependencias `@soec/*`, sin persistencia y
 * sin datos de instancia (Rubro ≠ Instancia).
 */

// Única vía de acceso al conocimiento: fábricas que devuelven el puerto.
export {
  crearBibliotecaClinicaDental,
  obtenerBiblioteca,
  RUBROS_DISPONIBLES,
  RubroDesconocidoError,
} from './rubros/registro';
export type { RubroId } from './rubros/registro';

// Contrato del puerto y política de madurez.
export type { RubroKnowledgePort, VersionBiblioteca, PoliticaMadurez } from './domain/port';

// Tipos de los RESULTADOS del puerto (no la estructura de la biblioteca).
export type {
  EstadoMadurez,
  Confianza,
  EstadoVerificacion,
  TipoConocimiento,
  Auditoria,
  Objetivo,
  Estrategia,
  Metrica,
  Embudo,
  RestriccionGeneral,
  Supuesto,
  Regulatorio,
  ActivadorRegulatorio,
  CondicionActivacion,
  Senal,
  Mapeo,
} from './domain/tipos';
export { ESTADOS_MADUREZ, CONFIANZAS, ACTIVADORES_REGULATORIOS } from './domain/tipos';

// Semántica regulatoria: consulta y guarda honesta.
export type { SemanticaRegulatoria } from './domain/regulatorio';
export {
  semanticaRegulatoria,
  verificarCapacidadDeCertificacion,
  CertificacionNoPermitidaError,
} from './domain/regulatorio';
