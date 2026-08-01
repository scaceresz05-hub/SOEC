/** Tipos de la superficie de generación (Motor de Generación Autónoma, Macrobloque 3). Todo SIMULADO. */

export type Naturaleza = 'REAL' | 'SIMULADO' | 'ESTIMADO' | 'DESCONOCIDO';

export interface ResultadoStart {
  estado: 'PREPARADO' | 'ABSTENCION';
  piezas?: string[];
  yaEjecutado?: boolean;
  faltantes?: string[];
  naturaleza: Naturaleza;
}

export interface EstadoGeneracion {
  programaId: string;
  estado: string;
  segmentos: number;
  campanias: number;
  piezas: number;
  naturaleza: Naturaleza;
}

export interface ArtefactoEstrategia {
  estrategiaCreativaId: string;
  hipotesisId: string;
  concepto: string;
  angulo: string;
  gancho: string;
  mensajesClave: string[];
  tono: string;
  cta: string;
  afirmacionesPermitidas: string[];
  evidencias: string[];
  pruebaSocialPermitida: boolean;
  confianza: string;
  naturaleza: Naturaleza;
  version: number;
}

export interface CampaniaGen {
  campaignId: string;
  hipotesisId: string;
  piezas: string[];
}

export interface PiezaGen {
  piezaId: string;
  campaignId: string;
}

export interface VarianteGen {
  varianteId: string;
  elementoModificado: string;
  diferenciaControlada: string;
  hipotesisQuePrueba: string;
  estado: string;
}

export interface ExperimentoGen {
  piezaId: string;
  variantes: VarianteGen[];
}

export interface EntradaCalendarioGen {
  entradaId: string;
  fechaHora: string;
  canal: string;
  piezaId: string;
  segmento: string;
  estado: string;
  naturaleza: Naturaleza;
}

export interface DecisionAprobacionGen {
  resourceType: string;
  resourceId: string;
  resourceVersion: number;
  decision: 'APROBADA' | 'RECHAZADA' | 'CAMBIOS_SOLICITADOS';
  actorUserId: string;
  timestamp: string;
}

export interface AprobacionGen {
  resourceType: string;
  resourceId: string;
  resourceVersion: number;
  aprobado: boolean;
  ultima: DecisionAprobacionGen | null;
}
