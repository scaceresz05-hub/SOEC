export interface ActividadMedicion {
  id: string;
  canal: string;
  publicationId: string | null;
  externalRef: string | null;
  calidad: string | null;
  clasificacion: string | null;
  indicadores: { tipo: string; valor: number | null }[];
  atribucion: { modelo: string; clase: string; conversiones: number } | null;
  anomalias: { codigo: string; severidad: string }[];
  optimizacion: { tipo: string; estado: string; motivoDenegacion: string | null } | null;
}
export interface EstadoMedicion {
  existe: boolean;
  empresa: string;
  escenario: string;
  actividades: ActividadMedicion[];
}
