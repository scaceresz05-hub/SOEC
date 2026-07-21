/** DTOs de transporte de la experiencia de marketing (sin importar dominio). */
export interface Iniciativa {
  id: string;
  nombre: string;
  porque: string;
  objetivoAtendido: string;
}
export interface Campania {
  id: string;
  iniciativaId: string;
  nombre: string;
  canal: string;
  presupuesto: number;
  porque: string;
}
export interface Actividad {
  id: string;
  campaniaId: string;
  tipo: string;
  canal: string;
  contenido: string;
  costo: number;
  fechaProgramada: string;
  estado: string;
  motivoBloqueo: string | null;
  explicacion: string;
  accionExecutionId: string | null;
  resultado: string | null;
}
export interface Calendario {
  zonaHoraria: string;
  desde: string;
  hasta: string;
  frecuenciaDias: number;
}
export interface Presupuesto {
  total: number;
  moneda: string;
  porCampania: Record<string, number>;
}
export interface EstadoMarketing {
  existe: boolean;
  empresa: string;
  objetivo: { objetivoComercial: string; indicador: string; lineaBase: number; valorEsperado: number; horizonteDias: number } | null;
  plan: {
    planVersion: number;
    estado: string;
    iniciativas: Iniciativa[];
    campanias: Campania[];
    calendario: Calendario | null;
    presupuesto: Presupuesto | null;
    actividades: Actividad[];
    historial: { planVersion: number; motivo: string; en: string }[];
  } | null;
  siguiente: { id: string; canal: string; fechaProgramada: string } | null;
}
export interface ResultadoEjecucion {
  actividad: string;
  permitida: boolean;
  motivo: string | null;
  resultado: string;
}
