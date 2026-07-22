import type { DecisionPendiente, ResumenControl } from './control-types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok && res.status !== 404) throw new Error('fallo de servicio');
  return (await res.json()) as T;
}

export async function prepararControl(): Promise<void> {
  await fetch('/api/control/preparar', { method: 'POST' });
}
export async function resumenControl(): Promise<ResumenControl> {
  return json<ResumenControl>(await fetch('/api/control/resumen', { cache: 'no-store' }));
}
export async function actividadControl(): Promise<{ entradas: { texto: string; automatico: boolean; simulado: boolean }[] }> {
  return json(await fetch('/api/control/actividad', { cache: 'no-store' }));
}
export async function decisionesControl(): Promise<{ decisiones: DecisionPendiente[] }> {
  return json(await fetch('/api/control/decisiones', { cache: 'no-store' }));
}
export async function simularControl(escenario: string): Promise<{ medidas: number; aplicadas: number; decisiones: number; alertas: number; pausado: boolean }> {
  return json(await fetch('/api/control/simular', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ escenario }) }));
}
export async function pausarControl(pausar: boolean): Promise<{ pausaTotal: boolean }> {
  return json(await fetch(`/api/control/${pausar ? 'pausar' : 'reanudar'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tipo: 'departamento', valor: '*', motivo: 'desde el centro de control', actor: 'propietario' }) }));
}
export async function resolverDecision(decId: string, estado: 'aprobada' | 'denegada'): Promise<{ estado: string; efectoAplicado: boolean }> {
  return json(await fetch(`/api/control/decisiones/${encodeURIComponent(decId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estado, rol: 'propietario', actor: 'propietario' }) }));
}
