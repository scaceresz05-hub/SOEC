/**
 * apps/api · SINCRONIZACIÓN Google Ads DESDE LA CONEXIÓN (DB), no desde env global. Elimina la dependencia
 * productiva `GOOGLE_ADS_REFRESH_TOKEN` global: la resolución es
 *
 *   organizationId → GoogleAdsConnection (DB, tenant-scoped) → refresh token CIFRADO → decrypt server-side
 *   → Google OAuth → access token efímero → Google Ads API (READ ONLY)
 *
 * APP_LEVEL (client_id/secret/developer_token) sigue siendo global (env). TENANT_LEVEL (refresh token,
 * customerId, loginCustomerId, timezone/estado) vive en la conexión. Antes de ingerir, se prueba el token:
 * invalid_grant ⇒ NEEDS_REAUTH conservando el último snapshot (STALE) y el histórico; nunca se fabrica frescura.
 */

import { ActorId, OrganizationId, type EventStore, type RequestContext } from '@soec/contracts';
import { SecretStoreEnv, type SecretStore } from '@soec/secretos';
import { ObservacionService } from '@soec/motor-medicion';
import type { EsquemaSalida } from '@soec/adaptadores';
import { GoogleAdsAdapter } from './google-ads-adapter';
import { IngestaGoogleAds, adsRefreshStateStreamId, EVENTO_REFRESH_STATE, type AdsRefreshState } from './ingesta-google-ads-service';
import type { ConexionGoogleAds } from '../acquisition/google-ads-connection';
import { probarTokenConexion, type ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';

/** Egress cerrado y tipado (sólo query/customerId pueden salir). READ ONLY. */
const ESQUEMA_EGRESS_ADS: EsquemaSalida = {
  operacion: 'ingesta-ads',
  campos: [
    { nombre: 'query', tipo: 'string' },
    { nombre: 'customerId', tipo: 'string' },
  ],
};

/** ¿Están las variables app-level presentes? (no expone valores). */
export function appLevelConfigurado(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.GOOGLE_ADS_DEVELOPER_TOKEN && env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET);
}

/**
 * SecretStore COMPUESTO: enruta por esquema de la referencia. `env:` (app-level) → SecretStoreEnv;
 * `secretstore:` (refresh token cifrado, tenant) → EnvelopeSecretBackend. Default-deny: esquema desconocido lanza.
 */
export class SecretStoreCompuesto implements SecretStore {
  readonly nombre = 'compuesto:env+envelope';
  constructor(private readonly rutas: ReadonlyArray<{ readonly prefijo: string; readonly store: SecretStore }>) {}
  async resolver(ctx: RequestContext, secretRef: string) {
    for (const r of this.rutas) if (secretRef.startsWith(r.prefijo)) return r.store.resolver(ctx, secretRef);
    throw new Error('secretRef sin ruta de resolución (esquema no permitido)');
  }
}

/**
 * Construye la ingesta Google Ads a partir de la CONEXIÓN (DB) + secretos app-level (env). Devuelve null
 * (fail-closed) si falta cuenta, credencial o config app-level. `secretBackend` resuelve el refresh cifrado.
 */
export function construirIngestaDesdeConexion(store: EventStore, env: NodeJS.ProcessEnv, conexion: ConexionGoogleAds, secretBackend: SecretStore): IngestaGoogleAds | null {
  if (conexion.customerId === null || conexion.credencialRef === null) return null;
  if (!appLevelConfigurado(env)) return null;
  const secretStore = new SecretStoreCompuesto([
    { prefijo: 'env:', store: new SecretStoreEnv(env) },
    { prefijo: 'secretstore:', store: secretBackend },
  ]);
  const observaciones = new ObservacionService(store, {} as never);
  const adaptador = new GoogleAdsAdapter({
    secretStore,
    esquemaEgress: ESQUEMA_EGRESS_ADS,
    secretRefs: {
      developerToken: 'env:GOOGLE_ADS_DEVELOPER_TOKEN',
      clientId: 'env:GOOGLE_ADS_CLIENT_ID',
      clientSecret: 'env:GOOGLE_ADS_CLIENT_SECRET',
      refreshToken: conexion.credencialRef,
    },
    loginCustomerId: conexion.loginCustomerId ?? conexion.customerId,
  });
  return new IngestaGoogleAds({ adaptador, observaciones, store, org: conexion.organizationId, customerId: conexion.customerId });
}

export type EstadoSincronizacion = 'OK' | 'PARCIAL' | 'FALLO' | 'NEEDS_REAUTH' | 'NOT_CONFIGURED' | 'SKIPPED';

export interface ResultadoSincronizacion {
  readonly org: string;
  readonly estado: EstadoSincronizacion;
  readonly queriedAt: string;
  readonly error: string | null;
  readonly dataThrough: string | null;
}

export interface DepsSincronizacion {
  readonly store: EventStore;
  readonly env: NodeJS.ProcessEnv;
  readonly comp: ComponentesFlujoGoogleAds;
  readonly ahora: () => string;
}

function ctxAppend(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('google-ads-sync'), scope: { organizationId: o, permissions: ['events:read', 'events:append'] }, correlationId: `google-ads-sync-${org}` };
}

async function persistirRefreshState(deps: DepsSincronizacion, org: string, estado: AdsRefreshState): Promise<void> {
  const ctx = ctxAppend(org);
  const prev = await deps.store.readStream(ctx, adsRefreshStateStreamId(org));
  await deps.store
    .append(ctx, adsRefreshStateStreamId(org), prev.length, [{ type: EVENTO_REFRESH_STATE, payload: estado, attribution: { source: 'google-ads', purpose: 'sync', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' }, occurredAt: estado.queriedAt }])
    .catch(() => undefined);
}

/**
 * Sincroniza UNA conexión (READ ONLY). Prueba token → (invalid_grant ⇒ NEEDS_REAUTH, conserva snapshot) →
 * ingesta desde la conexión → persiste el estado del intento. No lanza por fallos del proveedor: los reporta.
 */
export async function sincronizarConexion(deps: DepsSincronizacion, conexion: ConexionGoogleAds): Promise<ResultadoSincronizacion> {
  const org = conexion.organizationId;
  const queriedAt = deps.ahora();
  if (conexion.estado !== 'CONNECTED') return { org, estado: 'SKIPPED', queriedAt, error: null, dataThrough: null };

  const token = await probarTokenConexion(deps.comp, conexion);
  if (token === 'NEEDS_REAUTH') {
    await persistirRefreshState(deps, org, { queriedAt, ok: false, estado: 'NEEDS_REAUTH', ventana: { desde: '', hasta: '' }, error: 'reauth', dataThrough: null });
    return { org, estado: 'NEEDS_REAUTH', queriedAt, error: 'reauth', dataThrough: null };
  }
  if (token !== 'OK') {
    await persistirRefreshState(deps, org, { queriedAt, ok: false, estado: 'FALLO', ventana: { desde: '', hasta: '' }, error: token, dataThrough: null });
    return { org, estado: 'FALLO', queriedAt, error: token, dataThrough: null };
  }

  const ingesta = construirIngestaDesdeConexion(deps.store, deps.env, conexion, deps.comp.secretWriter);
  if (ingesta === null) {
    await persistirRefreshState(deps, org, { queriedAt, ok: false, estado: 'NOT_CONFIGURED', ventana: { desde: '', hasta: '' }, error: 'app-level ausente', dataThrough: null });
    return { org, estado: 'NOT_CONFIGURED', queriedAt, error: 'app-level ausente', dataThrough: null };
  }
  const r = await ingesta.correrUnaVez(ctxAppend(org), { ahora: queriedAt });
  const okReal = r.estado === 'OK';
  const error = r.fallos.length > 0 ? r.fallos[0]!.replace(/^[^:]+:\s*/, '') : null;
  await persistirRefreshState(deps, org, { queriedAt, ok: okReal, estado: r.estado, ventana: r.ventana, error, dataThrough: r.dataThrough });
  return { org, estado: r.estado, queriedAt, error, dataThrough: r.dataThrough };
}
