/**
 * Tipos de la vista del ciclo del Director Autónomo (espejo de `VistaCicloDirector` del núcleo).
 * Cada dato declara su NATURALEZA para que la UI nunca presente una simulación como un hecho.
 */
export type Naturaleza = 'REAL' | 'SIMULADO' | 'ESTIMADO' | 'DESCONOCIDO';

export interface Dato<T> {
  valor: T | null;
  naturaleza: Naturaleza;
  nota: string;
}

export interface EjecucionSimuladaVista {
  requestId: string;
  contenidoId: string;
  canal: string;
  resultado: string;
  naturaleza: Naturaleza;
}

export interface AprendizajeVista {
  conclusion: string;
  reutilizable: boolean;
}

export interface VistaCicloDirector {
  organizacionActiva: string;
  nivelAutonomia: number;
  modoSeguro: boolean;
  objetivo: Dato<string>;
  justificacion: string | null;
  calidadEvaluabilidad: 'EVALUABLE' | 'NO_EVALUABLE';
  decision: Dato<string>;
  pendientes: string[];
  ejecucionesSimuladas: EjecucionSimuladaVista[];
  bloqueos: string[];
  resultado: Dato<number>;
  aprendizajes: AprendizajeVista[];
  proximaRecomendacion: string;
}
