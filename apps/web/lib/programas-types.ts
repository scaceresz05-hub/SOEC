/** Tipos de la vista de Programa (espejo de VistaPrograma del núcleo @soec/programas). */
export type Naturaleza = 'REAL' | 'SIMULADO' | 'ESTIMADO' | 'DESCONOCIDO';

export interface OrgLista {
  organizaciones: { org: string; nombre: string }[];
}
export interface ProgramaLista {
  programas: { programaId: string; nombre: string }[];
}

export interface ContenidoVista {
  contenidoId: string;
  estado: string;
  canal: string;
}
export interface EjecucionVista {
  requestId: string;
  resultado: string;
  naturaleza: Naturaleza;
}
export interface CampaniaVista {
  campaignId: string;
  nombreSegmento: string;
  publico: string;
  estadoCampania: string;
  presupuestoSimulado: number;
  contenidos: ContenidoVista[];
  ejecuciones: EjecucionVista[];
  roi: { valor: number | null; clasificacion: string; naturaleza: Naturaleza };
}
/** Respuesta de pausa/reanudación: la autonomía es por ORGANIZACIÓN en V1. */
export interface RespuestaAutonomia {
  alcance: 'ORGANIZACION';
  organizacionId: string;
  programaSolicitadoId: string;
  estadoAutonomia: 'PAUSADA' | 'ACTIVA';
  vista: VistaPrograma | null;
}

export interface VistaPrograma {
  organizacionActiva: string;
  programaId: string;
  nombre: string;
  objetivoPrincipal: string;
  estadoPrograma: string;
  modoSeguro: boolean;
  nivelAutonomia: number;
  modoEjecucion: string;
  presupuesto: { totalSimulado: number; comprometidoSimulado: number; moneda: string };
  segmentos: { id: string; nombre: string; prioridad: number }[];
  hipotesis: { id: string; mensaje: string; estado: string }[];
  campanias: CampaniaVista[];
  aprendizajes: { conclusion: string; reutilizable: boolean }[];
  avisos: string[];
  proximaRecomendacion: string;
}
