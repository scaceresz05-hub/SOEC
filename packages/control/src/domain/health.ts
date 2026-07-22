/**
 * Salud operacional del departamento (F2-CTRL-01 §4.2, §16). Se DERIVA de señales
 * explícitas mediante una regla de PRECEDENCIA determinista y documentada; no depende
 * de una descripción generativa libre. La ausencia de datos no es fracaso: se
 * distingue de un problema.
 */
export type EstadoSalud =
  | 'pausado'
  | 'intervencion_requerida'
  | 'parcialmente_bloqueado'
  | 'degradado'
  | 'operando_con_advertencias'
  | 'saludable'
  | 'sin_informacion';

export interface SenalesSalud {
  readonly pausaTotal: boolean;
  readonly riesgoCritico: number; // anomalías críticas / decisiones de riesgo alto sin resolver
  readonly intervencionRequerida: number; // decisiones pendientes que exigen aprobación
  readonly bloqueos: number; // publicaciones/actividades bloqueadas
  readonly advertencias: number; // anomalías menores, hallazgos no bloqueantes
  readonly conDatos: boolean; // hay objetivos/planes/mediciones con evidencia
}

/**
 * Precedencia (documentada): 1) pausa total · 2) riesgo crítico · 3) intervención
 * requerida · 4) bloqueo significativo · 5) advertencias · 6) saludable · 7) sin datos.
 */
export function calcularSalud(s: SenalesSalud): EstadoSalud {
  if (s.pausaTotal) return 'pausado';
  if (s.riesgoCritico > 0) return 'intervencion_requerida';
  if (s.intervencionRequerida > 0) return 'intervencion_requerida';
  if (s.bloqueos >= 3) return 'parcialmente_bloqueado';
  if (s.bloqueos > 0) return 'degradado';
  if (!s.conDatos) return 'sin_informacion';
  if (s.advertencias > 0) return 'operando_con_advertencias';
  return 'saludable';
}
