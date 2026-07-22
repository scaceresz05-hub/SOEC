export interface EstadoPiloto {
  existe: boolean;
  organizacion: { nombre: string; estado: string; departamentos: string[]; claseDatos: string } | null;
  onboarding: { total: number; completas: number; faltantes: string[] };
  perfil: { departamento: string; modo: string; nivelAutonomia: number } | null;
  politicaAceptada: boolean;
  presupuesto: { moneda: string; limiteTotal: number; limiteDiario: number; ejecutadoReal: number; ejecutadoSintetico: number } | null;
  readiness: { entorno: string; resultado: string; nota: string; chequeos: { codigo: string; estado: string; faltante: string; bloqueo: boolean }[]; activacionRealPermitida: boolean };
  expediente: { estado: string; entorno: string; readiness: string | null; intentosActivacion: number } | null;
  ultimoEnsayo: { escenario: string; resultado: string; incidencias: number; rollbackVerificado: boolean } | null;
  activacion: { bloqueada: boolean; motivo: string };
}
