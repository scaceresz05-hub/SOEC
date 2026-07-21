/**
 * Tipos de TRANSPORTE de la web (DTOs). Derivados de los contratos públicos de la
 * API de capacidades, pero SIN importar paquetes de dominio: la web no reconstruye
 * productos, no aplica reglas intelectuales, no es fuente de verdad.
 */

export interface Senal {
  objeto: string;
  entradas: string[];
  condiciones: string[];
  incertidumbre: string;
  posibleFalsoPositivo: boolean;
  noEvaluable: boolean;
}

export interface DetalleOperacion {
  operacion: string;
  eceCorte?: { version: number; recordedAt: string | null };
  mecanismo?: string;
  mecanismoVersion?: string;
  deteccion?: { senales: Senal[] };
  esclarecimiento?: {
    elementoTipo: string;
    lados: { referencia: string; tipo: string; contenido: string }[];
    relacionesExplicitas: string[];
    contradiccionSinResolver: boolean;
  };
}

export interface ProductoOperacion {
  operacion: string;
  abstenido: boolean;
  causaAbstencion: string | null;
  evidencia: string[];
  razones: string[];
  procedencia: string;
  incertidumbre: string;
  faltante: string[];
  limitaciones: string[];
  detalle: DetalleOperacion;
}

export interface PasoEjecutado {
  stepId: string;
  operacion: string;
  operacionExecutionId: string;
  abstenido: boolean;
  causaAbstencion: string | null;
  resumen: string;
}

export interface ProductoCapacidad {
  capabilityId: string;
  version: number;
  nombre: string;
  proposito: string;
  operacionesEjecutadas: PasoEjecutado[];
  productosIntermedios: string[];
  productoCompuesto: string[];
  evidencia: string[];
  procedencia: string;
  incertidumbre: string;
  limitaciones: string[];
  faltante: string[];
  contradiccionesAbiertas: string[];
  cuestionesJuicioHumano: string[];
  abstenido: boolean;
  causaAbstencion: string | null;
  pasoAfectado: string | null;
  bindingDecision: boolean;
}

export interface ResultadoExperiencia {
  executionId: string;
  existe: boolean;
  estado: 'compuesta' | 'abstenida' | 'inexistente';
  empresa: string;
  capacidad: { id: string; nombre: string; version: number };
  construidoEn: string | null;
  producto: ProductoCapacidad | null;
  intermedios: ProductoOperacion[];
}

export interface ResumenHistorial {
  executionId: string;
  estado: string;
  terminadoEn: string | null;
  contradicciones: number;
  faltantes: number;
}
