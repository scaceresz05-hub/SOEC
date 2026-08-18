/**
 * apps/api · Superficie HTTP del OAuth READ-ONLY de Meta (Parte 3b + certificación de callback).
 *
 * Split de seguridad:
 *  - AUTENTICADAS (dentro del gateway vertical, exigen sesión): start, connection, assets, binding.
 *  - CALLBACK PÚBLICO (fuera del gateway): el redirect de Meta llega SIN sesión ni Authorization; la autoridad
 *    proviene EXCLUSIVAMENTE del `state` persistido (org+actor, one-time, TTL, consumo atómico). El callback
 *    NO acepta org/actor de query/body, NO expone token, y JAMÁS deja CONNECTED_READ_ONLY (eso exige binding
 *    humano posterior y AUTENTICADO). Un state forjado/expirado/consumido/replay ⇒ falla.
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { contextoDe, permisosDe } from '../superficie-auth';
import type { ComposicionMetaOAuth } from './meta-runtime';
import { crearEstadoOAuth, dedupCandidatos, SCOPES_REQUERIDOS, type CandidatoActivo } from './meta-oauth';
import { procesarCallbackMeta, confirmarBindingMeta, aConexionDTO, aCandidatoDTO } from './meta-oauth-flow';
import type { TipoBindingMeta } from './meta-onboarding';
import { MetaAutenticacionError, MetaPermisoError } from './meta-http';
import { ejecutarSync } from './meta-sync';
import { construirVistaDirector } from './meta-director';
import { construirConocimiento } from './meta-knowledge';

export interface DepsMetaRoutes {
  readonly composicion: ComposicionMetaOAuth | null;
  readonly ahora?: () => string;
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

/** Contexto de sistema para resolver el secretRef durante el discovery (org autoritativa del state). */
function ctxSistema(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('meta-callback'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'meta-callback' };
}

async function descubrirAssets(g: ReturnType<ComposicionMetaOAuth['crearGraphRead']>): Promise<readonly CandidatoActivo[]> {
  // Ad accounts se descubren por ACCESO del token (me/adaccounts), no sólo por ownership del Business.
  const [b, p, i, a] = await Promise.all([g.discoverBusinesses(), g.discoverPages(), g.discoverInstagram(), g.discoverAdAccounts()]);
  return dedupCandidatos([...b, ...p, ...i, ...a]);
}

/** Los 8 checks de lectura del read-smoke completo (uno por capacidad de lectura post-binding). */
export type CheckReadSmoke =
  | 'BUSINESS_READ'
  | 'PAGE_READ'
  | 'INSTAGRAM_BASIC_READ'
  | 'INSTAGRAM_MEDIA_READ'
  | 'INSTAGRAM_INSIGHTS_READ'
  | 'ADS_ACCOUNT_READ'
  | 'ADS_CAMPAIGNS_READ'
  | 'ADS_INSIGHTS_READ';
export type ResultadoCheck = 'PASS' | 'FAIL' | 'SKIP';
const CHECKS_READ_SMOKE: readonly CheckReadSmoke[] = ['BUSINESS_READ', 'PAGE_READ', 'INSTAGRAM_BASIC_READ', 'INSTAGRAM_MEDIA_READ', 'INSTAGRAM_INSIGHTS_READ', 'ADS_ACCOUNT_READ', 'ADS_CAMPAIGNS_READ', 'ADS_INSIGHTS_READ'];

export interface ResultadoReadSmoke {
  readonly checks: Record<CheckReadSmoke, ResultadoCheck>;
  readonly pass: boolean;
  readonly salud: string;
  readonly estado: string;
  readonly totalPass: number;
  readonly totalRun: number;
}

/**
 * READ-SMOKE COMPLETO read-only tras el binding: ejecuta REALMENTE cada capacidad de lectura por binding
 * confirmado y registra PASS/FAIL/SKIP por check. Sólo lectura (GET), un check por llamada Graph; nunca
 * persiste raw Graph ni el token. Health fail-closed: auth ⇒ TOKEN_EXPIRED/REAUTH_REQUIRED; permiso ⇒
 * SCOPE_MISSING/DEGRADED; otros ⇒ DEGRADED. Una respuesta vacía/no-data NO es fallo (la llamada fue
 * autorizada y saneada): no se convierte «missing» en 0 ni en error de auth.
 */
export async function ejecutarReadSmoke(comp: ComposicionMetaOAuth, ctx: RequestContext, org: string, connectionId: string): Promise<ResultadoReadSmoke> {
  const checks = Object.fromEntries(CHECKS_READ_SMOKE.map((c) => [c, 'SKIP'])) as Record<CheckReadSmoke, ResultadoCheck>;
  const reg = await comp.connRepo.obtener(org, connectionId);
  const cred = await comp.credRepo.obtener(org, connectionId);
  if (reg === null || cred === null) return { checks, pass: false, salud: 'UNKNOWN', estado: 'NOT_CONNECTED', totalPass: 0, totalRun: 0 };

  const bind = (t: string): string | null => reg.conexion.bindings.find((b) => b.assetType === t && b.confirmadoPorHumano)?.externalId ?? null;
  const hasBusiness = bind('business') !== null;
  const hasPage = bind('page') !== null;
  const igsid = bind('instagram');
  const adId = bind('adAccount');

  let auth = false, scope = false, degraded = false;
  const correr = async (name: CheckReadSmoke, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn(); // no-data/empty ⇒ éxito autorizado (no se convierte en fallo)
      checks[name] = 'PASS';
    } catch (e) {
      checks[name] = 'FAIL';
      if (e instanceof MetaAutenticacionError) auth = true;
      else if (e instanceof MetaPermisoError) scope = true;
      else degraded = true;
    }
  };

  try {
    const resuelto = await comp.secretWriter.resolver(ctx, cred.secretRef);
    await resuelto.usar(async (token) => {
      const g = comp.crearGraphRead(token);
      if (hasBusiness) await correr('BUSINESS_READ', () => g.discoverBusinesses());
      if (hasPage) await correr('PAGE_READ', () => g.discoverPages());
      if (igsid !== null) {
        await correr('INSTAGRAM_BASIC_READ', () => g.readInstagramProfile(igsid));
        await correr('INSTAGRAM_MEDIA_READ', () => g.readInstagramMedia(igsid));
        await correr('INSTAGRAM_INSIGHTS_READ', () => g.readInstagramAccountInsights(igsid));
      }
      if (adId !== null) {
        await correr('ADS_ACCOUNT_READ', () => g.readAdAccount(adId));
        await correr('ADS_CAMPAIGNS_READ', () => g.readCampaigns(adId));
        await correr('ADS_INSIGHTS_READ', () => g.readAdsInsights(adId));
      }
      return 'ok';
    });
  } catch {
    // Fallo al resolver la credencial (token no disponible): fail-closed, sin ejecutar checks.
    degraded = true;
  }

  const salud = auth ? 'TOKEN_EXPIRED' : scope ? 'SCOPE_MISSING' : degraded ? 'DEGRADED' : 'HEALTHY';
  const estado = auth ? 'REAUTH_REQUIRED' : scope || degraded ? 'DEGRADED' : 'CONNECTED_READ_ONLY';
  const ejecutados = CHECKS_READ_SMOKE.filter((c) => checks[c] !== 'SKIP');
  const totalPass = ejecutados.filter((c) => checks[c] === 'PASS').length;
  const pass = ejecutados.length > 0 && totalPass === ejecutados.length;
  await comp.connRepo.guardar({ conexion: { ...reg.conexion, estado: estado as typeof reg.conexion.estado, salud: salud as typeof reg.conexion.salud }, candidatos: reg.candidatos });
  return { checks, pass, salud, estado, totalPass, totalRun: ejecutados.length };
}

/**
 * Orquestación del callback: la org/actor autoritativas vienen del STATE (no del request). No se pasa
 * `organizationIdCallback` ⇒ ninguna org externa puede reemplazar la del state. Discovery real con el token
 * recién guardado (boundary-only). NUNCA deja CONNECTED. Devuelve un DTO seguro (sin token).
 */
async function orquestarCallback(comp: ComposicionMetaOAuth, stateValor: string, code: string, ahora: string): Promise<{ estado: string; connectionId: string | null; scopesFaltantes: readonly string[] }> {
  const res = await procesarCallbackMeta(
    { stateStore: comp.stateStore, oauth: comp.oauth, secretWriter: comp.secretWriter, credRepo: comp.credRepo, connRepo: comp.connRepo, descubrir: async () => [], redirectUri: comp.redirectUri, ahora },
    { stateValor, code }, // sin organizationIdCallback: la org sale del state
  );
  if (res.estado === 'BINDING_PENDING' && res.connectionId !== null && res.organizationId !== null) {
    const org = res.organizationId;
    const cred = await comp.credRepo.obtener(org, res.connectionId);
    const reg = await comp.connRepo.obtener(org, res.connectionId);
    if (cred !== null && reg !== null) {
      const resuelto = await comp.secretWriter.resolver(ctxSistema(org), cred.secretRef);
      const candidatos = await resuelto.usar((token) => descubrirAssets(comp.crearGraphRead(token)));
      await comp.connRepo.guardar({ conexion: { ...reg.conexion, salud: 'UNKNOWN' }, candidatos });
    }
  }
  return { estado: res.estado, connectionId: res.connectionId, scopesFaltantes: res.scopesFaltantes };
}

/** CALLBACK PÚBLICO — se registra FUERA del gateway. Autoridad = state. Sin sesión ni Authorization. */
export function registerMetaCallbackPublico(app: FastifyInstance, deps: DepsMetaRoutes): void {
  const ahora = deps.ahora ?? (() => new Date().toISOString());
  const comp = deps.composicion;
  app.get('/acquisition/meta/oauth/callback', async (req, reply) => {
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const q = req.query as { state?: string; code?: string };
    if (!q.state || !q.code) return reply.code(400).send({ ok: false, error: 'FALTA_STATE_O_CODE' });
    const r = await orquestarCallback(comp, q.state, q.code, ahora());
    // DTO seguro: sin token/code/secretRef. No redirect controlado por query (evita open-redirect).
    return reply.send({ ok: true, datos: { estado: r.estado, connectionId: r.connectionId, scopesFaltantes: r.scopesFaltantes } });
  });
}

/** Rutas AUTENTICADAS — se registran DENTRO del gateway vertical (exigen sesión + org). */
export function registerMetaOAuthAutenticadas(app: FastifyInstance, deps: DepsMetaRoutes): void {
  const ahora = deps.ahora ?? (() => new Date().toISOString());
  const comp = deps.composicion;

  app.post('/acquisition/meta/oauth/start', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const st = crearEstadoOAuth({ nonce: randomBytes(32).toString('hex'), ahora: ahora(), ttlMs: 600_000 }, a.org, a.actor);
    await comp.stateStore.guardar(st);
    return reply.send({ ok: true, datos: { authorizationUrl: comp.oauth.authorizationUrl(st.valor), state: st.valor } });
  });

  app.get('/acquisition/meta/connection', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.send({ ok: true, datos: { estado: 'NOT_CONFIGURED' } });
    const reg = await comp.connRepo.obtener(a.org, `meta-${a.org}`);
    return reply.send({ ok: true, datos: reg === null ? { estado: 'NOT_CONNECTED' } : aConexionDTO(reg.conexion) });
  });

  app.get('/acquisition/meta/assets', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const reg = await comp.connRepo.obtener(a.org, `meta-${a.org}`);
    return reply.send({ ok: true, datos: { candidatos: (reg?.candidatos ?? []).map(aCandidatoDTO) } });
  });

  app.post('/acquisition/meta/binding', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const body = req.body as { externalId?: string; assetType?: TipoBindingMeta };
    if (!body?.externalId || !body?.assetType) return reply.code(400).send({ ok: false, error: 'FALTA_ID_O_TIPO' });
    const connectionId = `meta-${a.org}`;
    const candidato: CandidatoActivo = { provider: 'meta', assetType: body.assetType, externalId: body.externalId, displayName: null, provenance: 'GRAPH_OBSERVED' };
    const conf = await confirmarBindingMeta(
      { connRepo: comp.connRepo, scopesEfectivos: SCOPES_REQUERIDOS },
      a.org,
      connectionId,
      candidato,
      { organizationId: a.org, assetType: body.assetType, externalId: body.externalId, actorId: a.actor },
    );
    if (conf.rechazo !== 'NONE') return reply.code(409).send({ ok: false, error: conf.rechazo });
    const smoke = await ejecutarReadSmoke(comp, a.ctx, a.org, connectionId);
    return reply.send({ ok: true, datos: { estado: conf.estado, readSmoke: smoke.pass ? 'READ_SMOKE_PASS' : 'READ_SMOKE_FAIL', salud: smoke.salud, resumen: `PASS_${smoke.totalPass}_OF_${smoke.totalRun}`, checks: smoke.checks } });
  });

  /**
   * READ-SMOKE COMPLETO on-demand sobre la conexión EXISTENTE (autenticado, tenant-scoped). Reusa la
   * credencial ya almacenada (sin OAuth/binding/scope nuevos) y ejecuta la matriz 8/8 read-only. Fail-closed:
   * sin conexión / sin bindings ⇒ 409. NO vincula, NO escribe, NUNCA expone token/raw Graph.
   */
  app.post('/acquisition/meta/read-smoke', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const connectionId = `meta-${a.org}`;
    const reg = await comp.connRepo.obtener(a.org, connectionId);
    if (reg === null) return reply.code(409).send({ ok: false, error: 'NOT_CONNECTED' });
    if (reg.conexion.bindings.length === 0) return reply.code(409).send({ ok: false, error: 'SIN_BINDINGS' });
    const smoke = await ejecutarReadSmoke(comp, a.ctx, a.org, connectionId);
    return reply.send({ ok: true, datos: { estado: smoke.estado, salud: smoke.salud, pass: smoke.pass, resumen: `PASS_${smoke.totalPass}_OF_${smoke.totalRun}`, checks: smoke.checks } });
  });

  /**
   * RE-DISCOVERY READ-ONLY: reutiliza la credencial YA almacenada (sin OAuth nuevo) para re-enumerar los
   * activos accesibles por el token y refrescar SOLO la colección de candidatos. NO toca credencial,
   * ciphertext, credencialRef, bindings ni el estado de la conexión; NUNCA vincula ni pasa a CONNECTED.
   * El token se resuelve dentro del boundary del SecretStore y se descarta; jamás en la respuesta/logs.
   * Fail-closed en cada precondición (sin conexión / estado incompatible / sin credencial / Graph falla).
   */
  app.post('/acquisition/meta/assets/rediscover', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const connectionId = `meta-${a.org}`;
    const reg = await comp.connRepo.obtener(a.org, connectionId);
    if (reg === null) return reply.code(409).send({ ok: false, error: 'NOT_CONNECTED' });
    // Sólo estados con credencial vigente: BINDING_PENDING o CONNECTED_READ_ONLY.
    if (reg.conexion.estado !== 'BINDING_PENDING' && reg.conexion.estado !== 'CONNECTED_READ_ONLY') {
      return reply.code(409).send({ ok: false, error: 'ESTADO_INCOMPATIBLE' });
    }
    const cred = await comp.credRepo.obtener(a.org, connectionId);
    if (cred === null) return reply.code(409).send({ ok: false, error: 'NO_CREDENTIAL' });
    let candidatos: readonly CandidatoActivo[];
    try {
      const resuelto = await comp.secretWriter.resolver(a.ctx, cred.secretRef);
      candidatos = await resuelto.usar((token) => descubrirAssets(comp.crearGraphRead(token)));
    } catch (e) {
      // Fail-closed: NO muta conexión ni credencial. Clasifica el fallo para el cliente (sin token).
      const err = e instanceof MetaAutenticacionError ? 'REAUTH_REQUIRED' : e instanceof MetaPermisoError ? 'SCOPE_MISSING' : 'DISCOVERY_FAILED';
      return reply.code(502).send({ ok: false, error: err });
    }
    // Persiste SÓLO candidatos; conserva estado/bindings/salud/credencialRef exactamente como estaban.
    await comp.connRepo.guardar({ conexion: reg.conexion, candidatos });
    return reply.send({ ok: true, datos: { estado: reg.conexion.estado, candidatos: candidatos.map(aCandidatoDTO) } });
  });

  /**
   * SYNC READ-ONLY on-demand (autenticado, tenant-scoped): reusa la credencial existente y sincroniza
   * snapshots NORMALIZADOS por capacidad + estado de observabilidad. Sin OAuth/binding/scope/escritura.
   * Fail-closed: sin conexión / sin bindings / sin credencial ⇒ 409. No expone token ni raw Graph. NO
   * modifica la conexión OAuth: la observabilidad de sync vive en su propio estado.
   */
  app.post('/acquisition/meta/sync', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const connectionId = `meta-${a.org}`;
    const reg = await comp.connRepo.obtener(a.org, connectionId);
    if (reg === null) return reply.code(409).send({ ok: false, error: 'NOT_CONNECTED' });
    if (reg.conexion.bindings.length === 0) return reply.code(409).send({ ok: false, error: 'SIN_BINDINGS' });
    const cred = await comp.credRepo.obtener(a.org, connectionId);
    if (cred === null) return reply.code(409).send({ ok: false, error: 'NO_CREDENTIAL' });
    // `force` (re-lee todo, ignorando freshness) sólo para actor con permiso de gestión del negocio.
    const force = (req.body as { force?: unknown } | undefined)?.force === true;
    if (force && !permisosDe(req).has('business.manage')) return reply.code(403).send({ ok: false, error: 'FORCE_NO_AUTORIZADO' });
    const composicion = comp; // narrowed no-null para el closure de resolución perezosa
    let estado;
    try {
      // Resolución PEREZOSA del token: si toda la matriz está FRESH, ejecutarSync no invoca esto (cero Graph).
      estado = await ejecutarSync(
        {
          resolverGraph: (uso) => composicion.secretWriter.resolver(a.ctx, cred.secretRef).then((r) => r.usar((token) => uso(composicion.crearGraphRead(token)))),
          repo: composicion.syncRepo,
          ahora,
        },
        a.org,
        connectionId,
        reg.conexion.bindings,
        { force },
      );
    } catch {
      return reply.code(502).send({ ok: false, error: 'SYNC_FAILED' });
    }
    return reply.send({
      ok: true,
      datos: { lastSyncAt: estado.lastSyncAt, lastSuccessfulSyncAt: estado.lastSuccessfulSyncAt, lastErrorClass: estado.lastErrorClass, saludConexion: estado.saludConexion, capacidades: estado.capacidades },
    });
  });

  /**
   * READ MODEL del DIRECTOR (autenticado, tenant-scoped, read-only): expone el conocimiento Meta
   * sincronizado (snapshots NORMALIZADOS + freshness + metadata). NO llama a Graph. NUNCA expone token,
   * secretRef, ciphertext, raw Graph, URLs de paging ni PII de leads.
   */
  app.get('/acquisition/meta/director', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const connectionId = `meta-${a.org}`;
    const reg = await comp.connRepo.obtener(a.org, connectionId);
    if (reg === null) return reply.code(409).send({ ok: false, error: 'NOT_CONNECTED' });
    const ahoraIso = ahora();
    const vista = await construirVistaDirector(comp.syncRepo, a.org, connectionId, reg.conexion.bindings, ahoraIso);
    const historial = await comp.syncRepo.historial(a.org, connectionId);
    const inteligencia = construirConocimiento(vista, historial, ahoraIso);
    return reply.send({ ok: true, datos: { ...vista, inteligencia } });
  });

  /**
   * ON/OFF del scheduler automático por organización (autenticado). Exige `business.manage`. READ-ONLY:
   * sólo cambia si la conexión se sincroniza automáticamente; nunca toca token/bindings/escritura.
   */
  app.post('/acquisition/meta/sync/config', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== 'boolean') return reply.code(400).send({ ok: false, error: 'FALTA_ENABLED' });
    await comp.scheduleRepo.configurar(a.org, `meta-${a.org}`, enabled);
    return reply.send({ ok: true, datos: { syncEnabled: enabled } });
  });

  /**
   * OBSERVABILIDAD del scheduler/sync por organización (autenticado, read-only). Expone lastAttemptAt,
   * lastSuccessfulSyncAt, nextEligibleSyncAt, errorClass, consecutiveFailures, capabilitiesAffected,
   * syncEnabled + freshness por capacidad. Nunca token/secret/raw.
   */
  app.get('/acquisition/meta/sync/estado', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const connectionId = `meta-${a.org}`;
    const reg = await comp.connRepo.obtener(a.org, connectionId);
    if (reg === null) return reply.code(409).send({ ok: false, error: 'NOT_CONNECTED' });
    const schedule = await comp.scheduleRepo.obtener(a.org, connectionId);
    const vista = await construirVistaDirector(comp.syncRepo, a.org, connectionId, reg.conexion.bindings, ahora());
    return reply.send({
      ok: true,
      datos: {
        syncEnabled: schedule?.syncEnabled ?? true,
        lastAttemptAt: schedule?.lastAttemptAt ?? null,
        lastSuccessfulSyncAt: schedule?.lastSuccessfulSyncAt ?? vista.lastSuccessfulSyncAt,
        nextEligibleSyncAt: schedule?.nextEligibleSyncAt ?? null,
        lastErrorClass: schedule?.lastErrorClass ?? 'NONE',
        consecutiveFailures: schedule?.consecutiveFailures ?? 0,
        capabilitiesAffected: schedule?.capabilitiesAffected ?? [],
        health: vista.health,
        freshness: vista.capacidades.map((c) => ({ capability: c.capability, freshness: c.freshness, capturedAt: c.capturedAt })),
      },
    });
  });
}
