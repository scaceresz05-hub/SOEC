/**
 * apps/web · lib · CLIENTE de la experiencia de Integraciones (CIA).
 *
 * Consume la API canónica `/api/cia/*` (proxy → apps/api → EventStore PostgreSQL). No mantiene estado propio:
 * la autoridad es la API. Presenta RESULTADOS (capacidades), nunca herramientas: ninguna función expone
 * proveedor. Degrada con gracia: si la API no responde, devuelve vacío en lugar de romper la experiencia.
 */
import type { CapacidadActiva, CapacidadCatalogo, DecisionIntegracion, Inicio, NivelAutonomia, Sobre } from './cia-types';

const ERRORES_CONOCIDOS: Record<string, string> = {
  CapacidadDesconocidaError: 'Esa capacidad no está disponible.',
  ComandoCiaInvalidoError: 'La acción no es válida en este momento (¿falta una aprobación humana?).',
  ConflictoIdempotenciaError: 'Ya existe una acción con ese identificador y otro contenido.',
  ModoRealBloqueadoError: 'El modo real está bloqueado: SOEC trabaja en simulado.',
  NO_AUTORIZADO: 'Inicia sesión para continuar.',
};
const MENSAJE_GENERICO = 'No se pudo completar la acción. Inténtalo nuevamente.';

/** Deriva un mensaje comprensible: `mensaje` del servicio → código conocido → genérico. Sin códigos crudos. */
export function mensajeDeError(body: unknown): string {
  const b = body as { error?: unknown; mensaje?: unknown } | null;
  if (b && typeof b.mensaje === 'string' && b.mensaje.trim() !== '') return b.mensaje;
  if (b && typeof b.error === 'string' && ERRORES_CONOCIDOS[b.error]) return ERRORES_CONOCIDOS[b.error]!;
  return MENSAJE_GENERICO;
}

/** Formatea el estado de una capacidad para el usuario (resultado + disponibilidad). Sin proveedor. */
export function resumenCapacidad(c: CapacidadActiva): string {
  if (c.limite <= 0) return c.estado;
  const pct = Math.min(100, Math.round((c.consumidoSimulado / c.limite) * 100));
  return `${c.estado} · usado ${pct}% de tu límite (simulado)`;
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<Sobre<T>> {
  try {
    const res = await fetch(`/api/backend/api/cia/${ruta}`, { cache: 'no-store', ...init });
    return (await res.json()) as Sobre<T>;
  } catch {
    return { ok: false, error: 'RED', mensaje: MENSAJE_GENERICO };
  }
}

export async function obtenerInicio(): Promise<Inicio> {
  const r = await pedir<Inicio>('inicio');
  return r.ok && r.datos ? r.datos : { capacidades: [], decisiones: [] };
}
export async function obtenerCatalogo(): Promise<CapacidadCatalogo[]> {
  const r = await pedir<CapacidadCatalogo[]>('catalogo');
  return r.ok && r.datos ? r.datos : [];
}
export async function obtenerDecisiones(): Promise<DecisionIntegracion[]> {
  const r = await pedir<DecisionIntegracion[]>('decisiones');
  return r.ok && r.datos ? r.datos : [];
}
export function autorizarCapacidad(capacidadId: string, body: { limite: number; nivelAutonomia: NivelAutonomia; actorHumano: string }): Promise<Sobre<unknown>> {
  return pedir(`autorizaciones/${encodeURIComponent(capacidadId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
export function aprobarPlan(planId: string, actorHumano: string): Promise<Sobre<unknown>> {
  return pedir(`planes/${encodeURIComponent(planId)}/aprobar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actorHumano }) });
}
