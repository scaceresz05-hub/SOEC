/**
 * Tipos del modelo de lectura del Centro de Control (F2-CTRL-01 §3, §4.1). SOLO tipos:
 * la composición se realiza en la capa de aplicación a partir de contratos públicos y
 * proyecciones autorizadas de los demás módulos. El modelo de lectura NO recalcula
 * indicadores, NO reinterpreta estados, NO es otra fuente de verdad.
 */
import type { EstadoSalud } from './health';

export type ModoOperacional = 'simulado' | 'sandbox' | 'real_desactivado' | 'real_habilitado';

export interface ResumenObjetivo {
  readonly objetivoId: string;
  readonly indicador: string;
  readonly lineaBase: number;
  readonly meta: number;
  readonly resultado: number | null;
  readonly calidad: string;
  readonly clasificacion: string;
}

export interface TrabajoRealizado {
  readonly piezasCreadas: number;
  readonly publicacionesPreparadas: number;
  readonly publicacionesVerificadas: number;
  readonly campaniasActivas: number;
  readonly optimizacionesAplicadas: number;
  readonly retiros: number;
  readonly bloqueos: number;
}

export interface ProximoTrabajo {
  readonly actividadId: string;
  readonly canal: string;
  readonly fecha: string;
  readonly estadoContenido: string;
  readonly estado: string;
}

export interface PresupuestoConsolidado {
  readonly moneda: string;
  readonly produccion: number;
  readonly distribucion: number;
  readonly publicidad: number;
  readonly planificado: number;
  readonly comprometido: number;
  readonly ejecutado: number;
  readonly disponible: number;
  readonly discrepancia: number;
}

export interface EntradaActividad {
  readonly en: string;
  readonly texto: string; // lenguaje comprensible: qué, quién/qué lo originó, efecto, automático, simulado
  readonly automatico: boolean;
  readonly simulado: boolean;
  readonly refEntidad: string;
}

export interface Excepcion {
  readonly tipo: string;
  readonly severidad: string;
  readonly modulo: string;
  readonly entidad: string;
  readonly descripcion: string;
  readonly accionAutomatica: string;
  readonly accionHumana: string;
  readonly estado: string;
}

export interface ResumenDepartamento {
  readonly organizationId: string;
  readonly empresa: string;
  readonly periodo: string;
  readonly modo: ModoOperacional;
  readonly nivelAutonomia: number;
  readonly salud: EstadoSalud;
  readonly pausaTotal: boolean;
  readonly objetivos: readonly ResumenObjetivo[];
  readonly trabajo: TrabajoRealizado;
  readonly proximos: readonly ProximoTrabajo[];
  readonly excepciones: readonly Excepcion[];
  readonly presupuesto: PresupuestoConsolidado;
  readonly decisionesPendientes: number;
  readonly alertasAbiertas: number;
  readonly ultimaActualizacion: string;
}
