/**
 * Cliente de la superficie Meta READ-ONLY (vía BFF autenticado /api/backend/acquisition/meta/*).
 * La organización activa viaja en cabecera (x-organization-slug); la sesión en cookie httpOnly.
 * Nunca maneja tokens ni secretos: sólo consume DTOs normalizados del backend.
 */
import { cabecerasOrg } from './org-activa';

async function j<T>(res: Response): Promise<T> {
  const c = (await res.json().catch(() => ({}))) as { ok?: boolean; datos?: T; error?: string; message?: string };
  if (!res.ok || c.ok === false) throw new Error(c.message ?? c.error ?? `error ${res.status}`);
  return c.datos as T;
}

const get = (org: string, ruta: string) => fetch(`/api/backend/acquisition/meta/${ruta}`, { cache: 'no-store', headers: cabecerasOrg(org) });
const post = (org: string, ruta: string, body?: unknown) =>
  fetch(`/api/backend/acquisition/meta/${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: JSON.stringify(body ?? {}) });

export type EstadoConexion =
  | 'NOT_CONFIGURED'
  | 'NOT_CONNECTED'
  | 'BINDING_PENDING'
  | 'CONNECTED_READ_ONLY'
  | 'DEGRADED'
  | 'REAUTH_REQUIRED'
  | (string & {});

export interface Conexion {
  estado: EstadoConexion;
  salud?: string;
  bindings?: { assetType: string; externalId: string; displayName: string | null }[];
}
export interface Candidato {
  assetType: 'business' | 'page' | 'instagram' | 'adAccount' | string;
  externalId: string;
  displayName: string | null;
  ownerBusinessId?: string | null;
  accessMode?: string;
  bindingEligible?: boolean;
}
export interface ItemConocimiento {
  id: string;
  type: 'FACT' | 'DERIVED_METRIC' | 'SIGNAL' | 'HYPOTHESIS' | 'RECOMMENDATION';
  title: string;
  summary: string;
  evidence: string[];
  sourceCapabilities: string[];
  capturedAt: string | null;
  freshness: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  direction?: 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';
}
export interface Capacidad {
  capability: string;
  externalId: string;
  source: string;
  capturedAt: string | null;
  freshness: string;
  resumen: { kind: string; count?: number; identity?: Record<string, string>; metrics?: Record<string, number> } | null;
}
export interface VistaDirector {
  organizationId: string;
  connectionId: string;
  lastSuccessfulSyncAt: string | null;
  health: string;
  capacidades: Capacidad[];
  inteligencia: {
    overview: string;
    health: string;
    lastSuccessfulSyncAt: string | null;
    facts: ItemConocimiento[];
    metrics: ItemConocimiento[];
    signals: ItemConocimiento[];
    hypotheses: ItemConocimiento[];
    recommendations: ItemConocimiento[];
    priorities: ItemConocimiento[];
  };
}
export interface EstadoSync {
  syncEnabled: boolean;
  lastAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  nextEligibleSyncAt: string | null;
  lastErrorClass: string;
  consecutiveFailures: number;
  capabilitiesAffected: string[];
  health: string;
  freshness: { capability: string; freshness: string; capturedAt: string | null }[];
}

export const conexion = (org: string) => get(org, 'connection').then(j<Conexion>);
export const iniciarOAuth = (org: string) => post(org, 'oauth/start').then(j<{ authorizationUrl: string; state: string }>);
export const activos = (org: string) => get(org, 'assets').then(j<{ candidatos: Candidato[] }>);
export const vincular = (org: string, externalId: string, assetType: string) => post(org, 'binding', { externalId, assetType }).then(j<{ estado: string; salud?: string }>);
export const redescubrir = (org: string) => post(org, 'assets/rediscover').then(j<{ estado: string; candidatos: Candidato[] }>);
export const sincronizar = (org: string, force = false) => post(org, 'sync', force ? { force } : {}).then(j<EstadoSync>);
export const director = (org: string) => get(org, 'director').then(j<VistaDirector>);
export const estadoSync = (org: string) => get(org, 'sync/estado').then(j<EstadoSync>);
