/**
 * apps/api · Superficie HTTP productiva del OAuth READ-ONLY de Meta (Parte 3b). Montada en el namespace
 * `/acquisition/meta/*`, tenant-scoped: la organización SIEMPRE se deriva del contexto AUTENTICADO
 * (`contextoDe`), nunca de la URL/body. El callback también es autenticado (la sesión del navegador viaja en
 * la redirección) y además está protegido por el `state` persistido (org+actor autoritativos, one-time).
 *
 * Fail-closed: si falta la config productiva (`composicion === null`), la API sigue sirviendo /health, pero
 * el status Meta = NOT_CONFIGURED y start/callback/binding responden 503. NUNCA se exponen token/secretRef/code
 * ni raw Graph en los DTOs. El callback JAMÁS deja CONNECTED_READ_ONLY: eso exige binding humano por ID.
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RequestContext } from '@soec/contracts';
import { contextoDe } from '../superficie-auth';
import type { ComposicionMetaOAuth } from './meta-runtime';
import { crearEstadoOAuth } from './meta-oauth';
import type { CandidatoActivo } from './meta-oauth';
import { SCOPES_REQUERIDOS } from './meta-oauth';
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

async function descubrirAssets(g: ReturnType<ComposicionMetaOAuth['crearGraphRead']>): Promise<readonly CandidatoActivo[]> {
  const [b, p, i] = await Promise.all([g.discoverBusinesses(), g.discoverPages(), g.discoverInstagram()]);
  return [...b, ...p, ...i];
}

/** Read-smoke read-only tras el binding: plausibilidad + clasificación de salud. No persiste raw Graph. */
async function readSmoke(comp: ComposicionMetaOAuth, ctx: RequestContext, org: string, connectionId: string): Promise<{ pass: boolean; salud: string; leidos: number }> {
  const reg = await comp.connRepo.obtener(org, connectionId);
  const cred = await comp.credRepo.obtener(org, connectionId);
  if (reg === null || cred === null) return { pass: false, salud: 'UNKNOWN', leidos: 0 };
  const resuelto = await comp.secretWriter.resolver(ctx, cred.secretRef);
  try {
    const leidos = await resuelto.usar(async (token) => {
      const g = comp.crearGraphRead(token);
      let n = 0;
      for (const b of reg.conexion.bindings) {
        if (b.assetType === 'page' || b.assetType === 'business') n += (await g.discoverPages()) ? 1 : 0;
        else if (b.assetType === 'instagram') n += (await g.readInstagramMedia(b.externalId)) ? 1 : 0;
        else if (b.assetType === 'adAccount') {
          await g.readAdAccount(b.externalId);
          await g.readCampaigns(b.externalId);
          n += 1;
        }
      }
      return n;
    });
    await comp.connRepo.guardar({ conexion: { ...reg.conexion, salud: 'HEALTHY' }, candidatos: reg.candidatos });
    return { pass: true, salud: 'HEALTHY', leidos };
  } catch (e) {
    const salud = e instanceof MetaAutenticacionError ? 'TOKEN_EXPIRED' : e instanceof MetaPermisoError ? 'SCOPE_MISSING' : 'DEGRADED';
    const estado = e instanceof MetaAutenticacionError ? 'REAUTH_REQUIRED' : 'DEGRADED';
    await comp.connRepo.guardar({ conexion: { ...reg.conexion, estado, salud }, candidatos: reg.candidatos });
    return { pass: false, salud, leidos: 0 };
  }
}

export function registerMetaOAuthRoutes(app: FastifyInstance, deps: DepsMetaRoutes): void {
  const ahora = deps.ahora ?? (() => new Date().toISOString());
  const comp = deps.composicion;

  // A) Iniciar OAuth (autenticado) → authorization URL + state persistido (org+actor autoritativos).
  app.post('/acquisition/meta/oauth/start', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const st = crearEstadoOAuth({ nonce: randomBytes(32).toString('hex'), ahora: ahora(), ttlMs: 600_000 }, a.org, a.actor);
    await comp.stateStore.guardar(st);
    return reply.send({ ok: true, datos: { authorizationUrl: comp.oauth.authorizationUrl(st.valor), state: st.valor } });
  });

  // B) Callback (autenticado + protegido por state). NUNCA deja CONNECTED_READ_ONLY.
  app.get('/acquisition/meta/oauth/callback', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const q = req.query as { state?: string; code?: string };
    if (!q.state || !q.code) return reply.code(400).send({ ok: false, error: 'FALTA_STATE_O_CODE' });

    // Actor binding: el actor que confirma debe ser el que inició el state.
    const st = await comp.stateStore.obtener(q.state);
    if (st !== null && st.actorId !== a.actor) return reply.code(403).send({ ok: false, error: 'ACTOR_MISMATCH' });

    const res = await procesarCallbackMeta(
      { stateStore: comp.stateStore, oauth: comp.oauth, secretWriter: comp.secretWriter, credRepo: comp.credRepo, connRepo: comp.connRepo, descubrir: async () => [], redirectUri: comp.redirectUri, ahora: ahora() },
      { stateValor: q.state, organizationIdCallback: a.org, code: q.code },
    );

    // Discovery real con el token recién guardado (boundary-only) + salud UNKNOWN hasta el read-smoke.
    if (res.estado === 'BINDING_PENDING' && res.connectionId !== null) {
      const cred = await comp.credRepo.obtener(a.org, res.connectionId);
      const reg = await comp.connRepo.obtener(a.org, res.connectionId);
      if (cred !== null && reg !== null) {
        const resuelto = await comp.secretWriter.resolver(a.ctx, cred.secretRef);
        const candidatos = await resuelto.usar((token) => descubrirAssets(comp.crearGraphRead(token)));
        await comp.connRepo.guardar({ conexion: { ...reg.conexion, salud: 'UNKNOWN' }, candidatos });
      }
    }
    return reply.send({ ok: true, datos: { estado: res.estado, connectionId: res.connectionId, scopesFaltantes: res.scopesFaltantes } });
  });

  // C) Estado de la conexión (autenticado + tenant-scoped) — DTO seguro, sin token/secretRef.
  app.get('/acquisition/meta/connection', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.send({ ok: true, datos: { estado: 'NOT_CONFIGURED' } });
    const reg = await comp.connRepo.obtener(a.org, `meta-${a.org}`);
    if (reg === null) return reply.send({ ok: true, datos: { estado: 'NOT_CONNECTED' } });
    return reply.send({ ok: true, datos: aConexionDTO(reg.conexion) });
  });

  // D) Activos descubiertos (autenticado + tenant-scoped) — IDs canónicos, sin raw/token.
  app.get('/acquisition/meta/assets', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    if (comp === null) return reply.code(503).send({ ok: false, error: 'META_NOT_CONFIGURED' });
    const reg = await comp.connRepo.obtener(a.org, `meta-${a.org}`);
    return reply.send({ ok: true, datos: { candidatos: (reg?.candidatos ?? []).map(aCandidatoDTO) } });
  });

  // E) Confirmar binding humano por ID canónico → CONNECTED_READ_ONLY + read-smoke.
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
