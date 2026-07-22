export interface AdaptacionResumen {
  canal: string;
  formato: string;
  estado: string;
  titulo: string;
  cuerpo: string;
  hashtags: string[];
  llamadaAccion: string;
}
export interface PaqueteResumen {
  paqueteId: string;
  actividadId: string;
  canal: string;
  estado: string;
  resultado: string | null;
  adaptaciones: AdaptacionResumen[];
  activos: { tipo: string; descripcion: string }[];
  hallazgos: { codigo: string; severidad: string; descripcion: string; bloqueante: boolean }[];
  revisiones: { ronda: number; motivo: string; accion: string }[];
  afirmaciones: { texto: string; tipo: string; fuente: string }[];
  ejecucion: string | null;
}
export interface ActividadContenido {
  id: string;
  canal: string;
  estado: string;
  motivoBloqueo: string | null;
  paquete: PaqueteResumen | null;
}
export interface EstadoContenido {
  existe: boolean;
  empresa: string;
  marca: string;
  plan: { planVersion: number; estado: string } | null;
  actividades: ActividadContenido[];
}
export interface ResultadoPreparacion {
  actividadDesbloqueada: boolean;
  motivo: string;
  paquete: PaqueteResumen;
}
