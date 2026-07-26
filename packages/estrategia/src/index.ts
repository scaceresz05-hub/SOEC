/**
 * @soec/estrategia — Motor de Estrategia (F2-DISC-01, paso 3 · contrato v1.1).
 *
 * Función pura y determinista que, a partir de una `ComprensionEvaluable`, un
 * `RubroKnowledgePort` y una política explícita, propone CANDIDATOS derivados
 * causalmente de señales diagnósticas activas y mapeos versionados (o se abstiene de
 * forma evaluable). No elige, no registra objetivos, no persiste, no accede a internals
 * del Diagnóstico, sin efectos reales.
 */
export type {
  PoliticaEstrategia,
  ExplicacionCandidato,
  FactoresConfianza,
  ProcedenciaCandidato,
  EstrategiaSugerida,
  CandidatoEstrategia,
  AdvertenciaRegulatoria,
  Cobertura,
  AbstencionEstrategia,
  ResultadoEstrategia,
} from './domain/tipos';
export { proponerEstrategia, POLITICA_ESTRATEGIA_CONSERVADORA } from './app/motor';
