import type { EstadoPiloto } from './piloto-types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error('fallo de servicio');
  return (await res.json()) as T;
}

export async function prepararPiloto(): Promise<void> {
  await fetch('/api/piloto/preparar', { method: 'POST' });
}
export async function estadoPiloto(): Promise<EstadoPiloto> {
  return json<EstadoPiloto>(await fetch('/api/piloto/estado', { cache: 'no-store' }));
}
export async function ensayar(escenario: string): Promise<{ ensId: string; resultado: string; pasos: number; incidencias: number; rollbackVerificado: boolean }> {
  return json(await fetch('/api/piloto/ensayar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ escenario }) }));
}
export async function intentarActivar(): Promise<{ permitida: boolean; motivoDenegacion: string; autorizacionesFaltantes: string[] }> {
  return json(await fetch('/api/piloto/activar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entorno: 'real_preparado' }) }));
}

export interface DecisionPiloto {
  existe: boolean;
  empresa: string;
  decision: { departamento: string; objetivo: string; canal: string; modo: string; nivelAutonomia: number; aprobacionPorPublicacion: boolean; frecuenciaMaxima: number; duracionDias: number; gastoPublicitario: number; prohibiciones: string[]; criteriosExito: string[]; criteriosSuspension: string[] };
  presupuesto: { publicidad: number; ejecutadoReal: number } | null;
  readinessReal: { resultado: string; nota: string; bloqueos: { codigo: string; estado: string; faltante: string }[]; activacionRealPermitida: boolean };
  readinessSandbox: { resultado: string };
  activacion: { permitida: boolean; motivo: string; loQueFaltaEstrategico: string[]; loQueFaltaOperativo: string[] };
}
export async function prepararDecision(): Promise<void> {
  await fetch('/api/piloto/decision/preparar', { method: 'POST' });
}
export async function estadoDecision(): Promise<DecisionPiloto> {
  return json<DecisionPiloto>(await fetch('/api/piloto/decision/estado', { cache: 'no-store' }));
}
