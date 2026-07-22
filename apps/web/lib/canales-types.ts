export interface PublicacionResumen {
  publicationId: string;
  canal: string;
  modo: string;
  estado: string;
  motivoBloqueo: string | null;
  externalRef: string | null;
  estadoRemoto: string | null;
  intentos: { intentoId: number; resultado: string; mensaje: string }[];
  reconciliaciones: { tipo: string; resolucion: string; requiereIntervencion: boolean }[];
  requiereIntervencion: boolean;
}
export interface ActividadCanal {
  id: string;
  canal: string;
  paqueteEstado: string | null;
  publicable: boolean;
  publicacion: PublicacionResumen | null;
}
export interface EstadoCanales {
  existe: boolean;
  empresa: string;
  modo: string;
  modosDisponibles: string[];
  actividades: ActividadCanal[];
}
