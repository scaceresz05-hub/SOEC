/**
 * apps/web · lib · TIPOS de la experiencia de Integraciones (CIA), capability-framed.
 * Espejo de las respuestas de la API `/api/cia/*`. Nunca contienen proveedor: el usuario ve resultados.
 */
export type NivelAutonomia = 'SOLO_OBSERVAR' | 'RECOMENDAR' | 'EJECUTAR_CON_APROBACION' | 'EJECUTAR_AUTOMATICO';

export interface CapacidadCatalogo {
  id: string;
  titulo: string;
  descripcion: string;
  unidadLimite: 'CLP_MENSUAL' | 'ENVIOS_MENSUALES' | 'SIN_GASTO';
}
export interface CapacidadActiva {
  capacidadId: string;
  titulo: string;
  estado: 'Activa' | 'En pausa' | 'Pendiente';
  limite: number;
  consumidoSimulado: number;
  disponible: number;
}
export interface DecisionIntegracion {
  planId: string;
  titulo: string;
  objetivo: string;
  costoEstimado: number;
}
export interface Inicio {
  capacidades: CapacidadActiva[];
  decisiones: DecisionIntegracion[];
}
export interface Sobre<T> { ok: boolean; datos?: T; error?: string; mensaje?: string }
