/** Tipos de la experiencia de captura (F2-DISC-03 · F2-PILOT-00). Espejo del DTO de la API. */
export type TipoPregunta = 'CERRADA_BOOLEAN' | 'ABIERTA';
export type EstadoRespuesta = 'SIN_RESPONDER' | 'RESPONDIDA' | 'CONTRADICTORIA' | 'NO_NORMALIZABLE';
export type EstadoEvaluacion = 'BORRADOR' | 'GENERADA' | 'CERRADA' | 'ARCHIVADA';

export type EntradaRespuesta =
  | { clase: 'ABIERTA'; texto: string; sustento?: string }
  | { clase: 'CERRADA'; valorCrudo: string }
  | { clase: 'CONTRADICCION'; aFavor: string; enContra: string }
  | { clase: 'SIN_INFORMACION' };

export interface DepartamentoDemo {
  id: string;
  nombre: string;
  rubroId: string;
}
export interface OrganizacionDemo {
  id: string;
  nombre: string;
  descripcion: string;
  departamentos: DepartamentoDemo[];
}
export interface Catalogo {
  organizaciones: OrganizacionDemo[];
}

export interface ResumenEvaluacion {
  evaluacionId: string;
  titulo: string | null;
  estado: EstadoEvaluacion;
  creadaEn: string | null;
  respondidas: number;
  tieneGeneracion: boolean;
}
export interface ListaEvaluaciones {
  organizationId: string;
  departamento: string;
  evaluaciones: ResumenEvaluacion[];
}

export interface PreguntaEval {
  preguntaId: string;
  tipo: TipoPregunta;
  senalId: string | null;
  senalNombre: string | null;
  estado: EstadoRespuesta;
  entrada: EntradaRespuesta | null;
  valorNormalizado: boolean | null;
}

export interface EvaluacionEstado {
  organizationId: string;
  departamento: string;
  evaluacionId: string;
  titulo: string | null;
  estado: EstadoEvaluacion;
  creadaEn: string | null;
  editable: boolean;
  rubroId: string;
  rubroVersion: string;
  preguntas: PreguntaEval[];
  resumen: {
    total: number;
    sinResponder: number;
    respondidas: number;
    contradictorias: number;
    noNormalizables: number;
  };
  generacionSinEvidencia: boolean;
  generaciones: number;
  tieneGeneracion: boolean;
  ultimaGeneracion: { generacionId: string; huella: string; en: string } | null;
}
