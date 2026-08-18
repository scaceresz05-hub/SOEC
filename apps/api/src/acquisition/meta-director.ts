/**
 * apps/api · READ MODEL del DIRECTOR sobre el conocimiento Meta sincronizado.
 *
 * El Director de SOEC consume ÚNICAMENTE snapshots NORMALIZADOS ya persistidos + metadata de observabilidad.
 * NUNCA recibe token, secretRef, ciphertext, raw Graph, URLs de paging ni PII de leads. No hace llamadas
 * Graph: es una vista pura sobre lo persistido, con freshness derivada de la política de sync.
 */

import type { BindingMeta } from './meta-onboarding';
import { capacidadesAplicables, clasificarFreshness, TTL_POR_CAPACIDAD, type CapacidadSync, type EstadoCapacidad, type Freshness, type MetaSyncRepo, type ResumenNormalizado } from './meta-sync';

export interface ConocimientoCapacidad {
  readonly capability: CapacidadSync;
  readonly externalId: string;
  readonly source: 'meta';
  readonly capturedAt: string | null; // observedAt del snapshot, null si NEVER_SYNCED
  readonly freshness: Freshness;
  readonly resumen: ResumenNormalizado | null; // normalizado; null si nunca se sincronizó
}

export interface VistaDirectorMeta {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly lastSuccessfulSyncAt: string | null;
  readonly health: string; // salud de la última sync (HEALTHY/TOKEN_EXPIRED/SCOPE_MISSING/DEGRADED/UNKNOWN)
  readonly capacidades: readonly ConocimientoCapacidad[];
}

/**
 * Construye la vista del Director a partir de lo persistido. Freshness se recalcula con el `ahora` actual
 * (un snapshot antes FRESH puede haber caducado). Nunca expone secretos ni raw. No llama a Graph.
 */
export async function construirVistaDirector(repo: MetaSyncRepo, organizationId: string, connectionId: string, bindings: readonly BindingMeta[], ahora: string): Promise<VistaDirectorMeta> {
  const ahoraMs = Date.parse(ahora);
  const snaps = new Map((await repo.listarSnapshots(organizationId, connectionId)).map((s) => [`${s.capability}:${s.externalId}`, s]));
  const estado = await repo.obtenerEstado(organizationId, connectionId);
  const capPrev = new Map<CapacidadSync, EstadoCapacidad>((estado?.capacidades ?? []).map((c) => [c.capability, c.estado]));

  const capacidades: ConocimientoCapacidad[] = capacidadesAplicables(bindings).map((a) => {
    const snap = snaps.get(`${a.capability}:${a.externalId}`);
    const freshness = clasificarFreshness(snap, capPrev.get(a.capability), TTL_POR_CAPACIDAD[a.capability], ahoraMs);
    return {
      capability: a.capability,
      externalId: a.externalId,
      source: 'meta',
      capturedAt: snap?.observedAt ?? null,
      freshness,
      resumen: snap?.resumen ?? null,
    };
  });

  return {
    organizationId,
    connectionId,
    lastSuccessfulSyncAt: estado?.lastSuccessfulSyncAt ?? null,
    health: estado?.saludConexion ?? 'UNKNOWN',
    capacidades,
  };
}
