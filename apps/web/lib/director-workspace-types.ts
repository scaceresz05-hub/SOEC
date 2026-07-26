/** Tipos del Director Workspace (F2-DISC-02). Espejo del DTO de la API de experiencia. */
export type Confianza = 'HIGH' | 'MEDIUM' | 'LOW';
export type CategoriaJustificacion =
  'NEGOCIO' | 'PRESUPUESTO' | 'RIESGO' | 'REGULATORIO' | 'PRIORIDAD' | 'OTRO';

export interface Hecho {
  preguntaId: string;
  enunciado: string;
  valor?: string | boolean | null;
  afirmacionId: string;
  evidenciaIds: string[];
}
export interface Faltante {
  preguntaId: string;
  motivo: string;
  mensaje: string;
}
export interface Contradiccion {
  preguntaId: string;
}
export interface Explicacion {
  detecte: string;
  observe: string;
  necesito: string;
  meFalta: string;
}
export interface CadenaTrazo {
  mapeoId: string;
  porque: string;
  senal: { id: string; nombre: string; preguntaId: string };
  hecho: { preguntaId: string; enunciado: string; valor: string | boolean | null } | null;
  respuestaOriginal: { tipo: string; detalle: string } | null;
}
export interface Advertencia {
  reglaId: string;
  estrategiaId: string;
  activadaPor: string;
  efecto: 'ADVIERTE' | 'BLOQUEA';
  estado: string;
  nota: string;
}
export interface FactoresConfianza {
  hechosRespaldatorios: string[];
  faltantesQueReducen: string[];
  contradiccionesQueReducen: string[];
  supuestosUtilizados: string[];
  resultado: Confianza;
}
export interface EstrategiaSugerida {
  id: string;
  estrategia: string;
  bloqueada: boolean;
}
export interface Candidato {
  objetivoId: string;
  objetivo: string;
  metrica: string;
  costoMedicion: string | null;
  confianza: Confianza;
  confianzaTexto: string;
  explicacion: Explicacion;
  estrategiasSugeridas: EstrategiaSugerida[];
  advertenciasRegulatorias: Advertencia[];
  factoresConfianza: FactoresConfianza;
  trazabilidad: { objetivoId: string; cadena: CadenaTrazo[]; entradasRubro: string[] };
  impacto: { siAcepto: string; siRechazo: string };
}
export interface Transparencia {
  confianzaGlobal: string;
  incertidumbre: string;
  supuestos: { id: string; texto: string }[];
  proximosDatosMasValiosos: string[];
}
export interface Vigente {
  decisionId: string;
  objetivoId: string;
  objetivo: string;
  en: string;
}
export interface HistorialItem {
  decisionId: string;
  resultado: string;
  estadoRegistro: string;
  objetivoId: string | null;
  objetivo: string | null;
  categoria: string;
  justificacion: string;
  en: string;
}
export interface WorkspaceEstado {
  organizationId: string;
  departamento: string;
  evaluacionId: string;
  evaluacionExiste: boolean;
  sinEvaluacion: boolean;
  tieneRespuestas: boolean;
  propuestaDisponible: boolean;
  generacion: { generacionId: string; huella: string; en: string } | null;
  abstencion: { razon: string; faltantesRelevantes: string[] } | null;
  cobertura: {
    candidatosEsperados: number;
    candidatosFundados: number;
    motivoDeCoberturaParcial?: string;
  } | null;
  comprension: { hechos: Hecho[]; faltantes: Faltante[]; contradicciones: Contradiccion[] };
  candidatos: Candidato[];
  transparencia: Transparencia;
  gobierno: { vigente: Vigente | null; historial: HistorialItem[] };
}
