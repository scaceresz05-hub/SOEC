export interface ResumenControl {
  organizationId: string;
  empresa: string;
  periodo: string;
  modo: string;
  nivelAutonomia: number;
  salud: string;
  pausaTotal: boolean;
  escenario: string;
  objetivos: { objetivoId: string; indicador: string; lineaBase: number; meta: number; resultado: number | null; calidad: string; clasificacion: string }[];
  trabajo: { piezasCreadas: number; publicacionesPreparadas: number; publicacionesVerificadas: number; campaniasActivas: number; optimizacionesAplicadas: number; retiros: number; bloqueos: number };
  proximos: { actividadId: string; canal: string; fecha: string; estadoContenido: string; estado: string }[];
  excepciones: { tipo: string; severidad: string; modulo: string; entidad: string; descripcion: string; accionAutomatica: string; accionHumana: string; estado: string }[];
  presupuesto: { moneda: string; produccion: number; distribucion: number; publicidad: number; planificado: number; comprometido: number; ejecutado: number; disponible: number; discrepancia: number };
  decisionesPendientes: number;
  alertasAbiertas: number;
  ultimaActualizacion: string;
}
export interface DecisionPendiente {
  decId: string;
  tipo: string;
  riesgo: string;
  razon: string;
  estado: string;
  recomendacion: string;
}
