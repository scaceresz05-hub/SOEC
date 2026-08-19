/**
 * apps/api · Superficie HTTP del OAuth READ-ONLY de Google Ads (multi-tenant, dinámico por DB).
 *
 * Split de seguridad (igual patrón que Meta, provider aislado):
 *  - AUTENTICADAS (dentro del gateway): start, connection (status), accounts (discovery), select-account,
 *    refresh, disconnect. La org proviene EXCLUSIVAMENTE del contexto del gateway (`contextoDe`), nunca de
 *    la URL/body. Las mutaciones de conexión (start/select/disconnect) exigen `business.manage`.
 *  - CALLBACK PÚBLICO (fuera del gateway): el redirect de Google llega SIN sesión; la autoridad viene
 *    EXCLUSIVAMENTE del `state` persistido (org+actor+provider, one-time, TTL, consumo atómico). Nunca deja
 *    CONNECTED (la selección de cuenta es un acto humano posterior y autenticado). Nunca expone tokens.
 *
 * DINÁMICO POR TENANT: connect/select/status/disconnect operan sobre la fila de conexión en DB. Una empresa
 * nueva conecta su cuenta sin editar código ni redeployar (no depende del registro estático TS).
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ActorId, OrganizationId, type EventStore, type RequestContext } from '@soec/contracts';
import { contextoDe, permisosDe } from '../superficie-auth';
import { crearEstadoGoogleAds, construirAuthorizationUrl } from './google-ads-oauth';
import {
  procesarCallbackGoogleAds, descubrirCuentas, seleccionarCuenta, desconectar,
  type ComponentesFlujoGoogleAds,
} from './google-ads-oauth-flow';
import { aConexionDTO, aCuentaDTO, connectionIdDe, type ConexionGoogleAds } from './google-ads-connection';
import { sincronizarConexion } from '../ingesta/google-ads-connection-service';
import { adsSnapshotStreamId, ultimoSnapshotAds, adsRefreshStateStreamId, ultimoRefreshState } from '../ingesta/ingesta-google-ads-service';

export interface DepsGoogleAdsRoutes {
  readonly composicion: ComponentesFlujoGoogleAds | null;
  readonly store: EventStore;
  readonly env: NodeJS.ProcessEnv;
  readonly ahora?: () => string;
  readonly webBaseUrl?: string;
}

function authed(req: FastifyRequest, reply: FastifyReply): { ctx: RequestContext; org: string; actor: string } | null {
  try {
    const ctx = contextoDe(req);
    return { ctx, org: String(ctx.organizationId), actor: String(ctx.actor) };
  } catch {
    reply.code(401).send({ ok: false, error: 'NO_AUTENTICADO' });
    return null;
  }
}

function ctxLectura(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('google-ads-status'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: `google-ads-status-${org}` };
}

/** Estado de datos legible para una persona normal (sin OAuth internals). */
function estadoDatos(conexion: ConexionGoogleAds | null, capturedAt: string | null, ahoraIso: string): 'ACTUALIZADO' | 'DESACTUALIZADO' | 'SIN_DATOS' | 'NECESITA_RECONEXION' | 'NO_CONECTADO' {
  if (conexion === null || conexion.estado === 'NOT_CONNECTED' || conexion.estado === 'DISCONNECTED') return 'NO_CONECTADO';
  if (conexion.estado === 'NEEDS_REAUTH' || conexion.needsReauth) return 'NECESITA_RECONEXION';
  if (capturedAt === null) return 'SIN_DATOS';
  const edadMs = Date.parse(ahoraIso) - Date.parse(capturedAt);
  return edadMs <= 24 * 60 * 60 * 1000 ? 'ACTUALIZADO' : 'DESACTUALIZADO';
}

async function construirEstadoConexion(deps: DepsGoogleAdsRoutes, org: string): Promise<Record<string, unknown>> {
  const comp = deps.composicion;
  const conexion = comp ? await comp.connRepo.obtener(org, connectionIdDe(org)) : null;
  const ctx = ctxLectura(org);
  const snapshot = ultimoSnapshotAds(await deps.store.readStream(ctx, adsSnapshotStreamId(org)));
  const refresh = ultimoRefreshState(await deps.store.readStream(ctx, adsRefreshStateStreamId(org)));
  const capturedAt = snapshot?.at ?? null;
  const ahoraIso = (deps.ahora ?? (() => new Date().toISOString()))();
  return {
    conexion: conexion ? aConexionDTO(conexion) : { estado: 'NOT_CONNECTED', salud: 'UNKNOWN', customerId: null, descriptiveName: null, timeZone: null, currencyCode: null, needsReauth: false, connectedAt: null },
    datos: {
      estado: estadoDatos(conexion, capturedAt, ahoraIso),
      capturedAt,
      dataThrough: refresh?.dataThrough ?? null,
      ultimaActualizacion: refresh?.queriedAt ?? null,
      impressions: snapshot?.impressions ?? null,
      clicks: snapshot?.clicks ?? null,
      cost: snapshot?.cost ?? null,
    },
    configurado: comp !== null,
  };
}

/** CALLBACK PÚBLICO — FUERA del gateway. Autoridad = state. Sin sesión. Nunca expone token/code/state. */
export function registerGoogleAdsCallbackPublico(app: FastifyInstance, deps: DepsGoogleAdsRoutes): void {
  const ahora = deps.ahora ?? (() => new Date().toISOString());
  const comp = deps.composicion;
  const web = deps.webBaseUrl?.replace(/\/+$/, '') ?? null;
  const irAWeb = (reply: FastifyReply, params: string): boolean => {
    if (web === null) return false;
    void reply.redirect(`${web}/negocios?${params}`, 302);
    return true;
  };
  app.get('/acquisition/google-ads/oauth/callback', async (req, reply) => {
    if (comp === null) return irAWeb(reply, 'ga=no_disponible') ? reply : reply.code(503).send({ ok: false, error: 'GOOGLE_ADS_NOT_CONFIGURED' });
    const q = req.query as { state?: string; code?: string; error?: string };
    if (q.error) return irAWeb(reply, 'ga=cancelado') ? reply : reply.code(400).send({ ok: false, error: 'OAUTH_CANCELADO' });
    if (!q.state || !q.code) return irAWeb(reply, 'ga=incompleto') ? reply : reply.code(400).send({ ok: false, error: 'FALTA_STATE_O_CODE' });
    const r = await procesarCallbackGoogleAds({ ...comp, ahora }, { stateValor: q.state, code: q.code });
    const estado = r.estado === 'ACCOUNT_SELECTION_PENDING' ? 'seleccionar_cuenta' : r.estado === 'OAUTH_FALLIDO' ? 'oauth_fallido' : 'state_invalido';
    if (irAWeb(reply, `ga=${estado}`)) return reply;
    return reply.send({ ok: r.estado === 'ACCOUNT_SELECTION_PENDING', datos: { estado: r.estado } });
  });
}

/** Rutas AUTENTICADAS — DENTRO del gateway vertical. */
export function registerGoogleAdsOAuthAutenticadas(app: FastifyInstance, deps: DepsGoogleAdsRoutes): void {
  const ahora = deps.ahora ?? (() => new Date().toISOString());
  const comp = deps.composicion;
  const exigeGestion = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!permisosDe(req).has('business.manage')) {
      reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
      return false;
    }
    return true;
  };

  app.post('/acquisition/google-ads/oauth/start', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (!exigeGestion(req, reply)) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'GOOGLE_ADS_NOT_CONFIGURED' });
    const st = crearEstadoGoogleAds({ nonce: randomBytes(32).toString('hex'), ahora: ahora(), ttlMs: 600_000 }, a.org, a.actor);
    await comp.stateStore.guardar(st);
    const authorizationUrl = construirAuthorizationUrl({ clientId: comp.clientId, redirectUri: comp.redirectUri }, st.valor);
    return reply.send({ ok: true, datos: { authorizationUrl, state: st.valor } });
  });

  app.get('/acquisition/google-ads/connection', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    return reply.send({ ok: true, datos: await construirEstadoConexion(deps, a.org) });
  });

  app.post('/acquisition/google-ads/accounts', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'GOOGLE_ADS_NOT_CONFIGURED' });
    const r = await descubrirCuentas({ ...comp, ahora }, a.org);
    if (!r.ok) return reply.code(409).send({ ok: false, error: r.motivo });
    return reply.send({ ok: true, datos: { cuentas: r.cuentas.map(aCuentaDTO) } });
  });

  app.post('/acquisition/google-ads/select-account', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (!exigeGestion(req, reply)) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'GOOGLE_ADS_NOT_CONFIGURED' });
    const customerId = (req.body as { customerId?: unknown } | undefined)?.customerId;
    if (typeof customerId !== 'string' || !/^\d{6,12}$/.test(customerId)) return reply.code(400).send({ ok: false, error: 'CUSTOMER_ID_INVALIDO' });
    const r = await seleccionarCuenta({ ...comp, ahora }, a.org, customerId);
    if (!r.ok) return reply.code(409).send({ ok: false, error: r.motivo });
    return reply.send({ ok: true, datos: aConexionDTO(r.conexion) });
  });

  app.post('/acquisition/google-ads/refresh', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'GOOGLE_ADS_NOT_CONFIGURED' });
    const conexion = await comp.connRepo.obtener(a.org, connectionIdDe(a.org));
    if (conexion === null || conexion.estado !== 'CONNECTED') return reply.code(409).send({ ok: false, error: 'NOT_CONNECTED' });
    const r = await sincronizarConexion({ store: deps.store, env: deps.env, comp, ahora }, conexion);
    return reply.send({ ok: r.estado === 'OK', datos: { estado: r.estado, queriedAt: r.queriedAt, dataThrough: r.dataThrough, error: r.error } });
  });

  app.post('/acquisition/google-ads/disconnect', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (!exigeGestion(req, reply)) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'GOOGLE_ADS_NOT_CONFIGURED' });
    await desconectar({ ...comp, ahora }, a.org);
    return reply.send({ ok: true, datos: { estado: 'DISCONNECTED' } });
  });
}
