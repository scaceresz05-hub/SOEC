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
import { contextoDe } from '../superficie-auth';
import type { ComposicionMetaOAuth } from './meta-runtime';
import { crearEstadoOAuth, SCOPES_REQUERIDOS, type CandidatoActivo } from './meta-oauth';
import { procesarCallbackMeta, confirmarBindingMeta, aConexionDTO, aCandidatoDTO } from './meta-oauth-flow';
import type { TipoBindingMeta } from './meta-onboarding';
import { MetaAutenticacionError, MetaPermisoError } from './meta-http';

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
  const [b, p, i] = await Promise.all([g.discoverBusinesses(), g.discoverPages(), g.discoverInstagram()]);
  return [...b, ...p, ...i];
}

/** Read-smoke read-only tras el binding: plausibilidad + clasificación de salud. No persiste raw Graph. */
async function readSmoke(comp: ComposicionMetaOAuth, ctx: RequestContext, org: string, connectionId: string): Promise<{ pass: boolean; salud: string }> {
  const reg = await comp.connRepo.obtener(org, connectionId);
  const cred = await comp.credRepo.obtener(org, connectionId);
  if (reg === null || cred === null) return { pass: false, salud: 'UNKNOWN' };
  const resuelto = await comp.secretWriter.resolver(ctx, cred.secretRef);
  try {
    await resuelto.usar(async (token) => {
      const g = comp.crearGraphRead(token);
      for (const b of reg.conexion.bindings) {
        if (b.assetType === 'page' || b.assetType === 'business') await g.discoverPages();
        else if (b.assetType === 'instagram') await g.readInstagramMedia(b.externalId);
        else if (b.assetType === 'adAccount') {
          await g.readAdAccount(b.externalId);
          await g.readCampaigns(b.externalId);
        }
      }
      return 'ok';
    });
    await comp.connRepo.guardar({ conexion: { ...reg.conexion, salud: 'HEALTHY' }, candidatos: reg.candidatos });
    return { pass: true, salud: 'HEALTHY' };
  } catch (e) {
    const salud = e instanceof MetaAutenticacionError ? 'TOKEN_EXPIRED' : e instanceof MetaPermisoError ? 'SCOPE_MISSING' : 'DEGRADED';
    const estado = e instanceof MetaAutenticacionError ? 'REAUTH_REQUIRED' : 'DEGRADED';
    await comp.connRepo.guardar({ conexion: { ...reg.conexion, estado, salud }, candidatos: reg.candidatos });
    return { pass: false, salud };
  }
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
    const smoke = await readSmoke(comp, a.ctx, a.org, connectionId);
    return reply.send({ ok: true, datos: { estado: conf.estado, readSmoke: smoke.pass ? 'READ_SMOKE_PASS' : 'READ_SMOKE_FAIL', salud: smoke.salud } });
  });
}
