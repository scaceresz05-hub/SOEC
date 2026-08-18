/**
 * apps/api · V2-B/V2-C · Superficie HTTP (autenticada, tenant-scoped) para campaña y autonomía en DRY-RUN/SHADOW.
 *
 * Todo pasa por el mandato vigente + Action Plane certificado (policy → budget guard → ledger). El master
 * switch REAL (SOEC_AUTONOMOUS_REAL) gobierna si algo se ejecuta de verdad; por defecto es false ⇒ DRY_RUN/
 * SHADOW, META_WRITE_CALLS reales = 0, gasto real = 0. Ninguna ruta permite a la máquina crear/elevar dinero.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe } from '../superficie-auth';
import { crearReposAccion } from '../accion/accion-pg';
import { restanteMinor } from '../accion/mandato';
import type { DepsActionPlane } from '../accion/action-plane';
import { construirCampaignPlan } from './campaign-plan';
import { ejecutarCampana } from './campaign-execution';
import { seleccionarMetaWritePort } from './meta-write-factory';
import { SCOPES_ESCRITURA_REQUERIDOS } from './write-capability';
import type { ObjetivoCampana, PerfilNegocio, Placement } from './content-engine';
import { correrCicloAutonomo } from '../autonomia/autonomous-loop';
import type { ObservacionAnuncio } from '../autonomia/performance';
import { PgShadowRunRepo } from '../autonomia/autonomia-pg';

function ctx(req: FastifyRequest, reply: FastifyReply): { org: string } | null {
  try {
    const c = contextoDe(req);
    return { org: String(c.organizationId) };
  } catch {
    reply.code(401).send({ ok: false, error: 'NO_AUTENTICADO' });
    return null;
  }
}

function perfilDe(org: string, b: Record<string, unknown>): PerfilNegocio {
  const p = (b['perfil'] ?? {}) as Record<string, unknown>;
  return {
    organizationId: org,
    nombre: String(p['nombre'] ?? 'Tu negocio'),
    rubro: String(p['rubro'] ?? 'servicios'),
    serviciosDeclarados: Array.isArray(p['serviciosDeclarados']) ? (p['serviciosDeclarados'] as unknown[]).map(String) : [],
    ...(p['comuna'] ? { comuna: String(p['comuna']) } : {}),
    ...(p['tono'] ? { tono: String(p['tono']) as PerfilNegocio['tono'] } : {}),
  };
}

const OBJETIVOS: readonly ObjetivoCampana[] = ['RECONOCIMIENTO', 'CONSIDERACION', 'MENSAJES', 'TRAFICO'];
function objetivoDe(v: unknown): ObjetivoCampana {
  return OBJETIVOS.includes(v as ObjetivoCampana) ? (v as ObjetivoCampana) : 'RECONOCIMIENTO';
}
function placementDe(v: unknown): Placement {
  return v === 'facebook' ? 'facebook' : 'instagram';
}

export function registerCampanaRoutes(app: FastifyInstance, pool: Pool | undefined): void {
  if (!pool) return;
  const { mandatoRepo, ledgerRepo } = crearReposAccion(pool);
  const shadowRepo = new PgShadowRunRepo(pool, () => randomUUID());
  const autonomousReal = process.env.SOEC_AUTONOMOUS_REAL === 'true'; // por defecto false ⇒ dry-run/shadow
  const globalKillSwitch = process.env.SOEC_KILL_SWITCH === 'true';
  const configReady = process.env.META_WRITE_CONFIG_READY === 'true';
  const grantedScopes = (process.env.META_GRANTED_SCOPES ?? 'ads_read').split(',').map((s) => s.trim()).filter(Boolean);
  const ahora = () => new Date().toISOString();
  const deps = (): DepsActionPlane => ({ ledger: ledgerRepo, ahora, autonomousReal, globalKillSwitch, nuevoId: () => randomUUID() });
  // Selección de port FAIL-CLOSED: en modo seguro SIEMPRE dry-run. El write path real está implementado pero
  // no configurado (sin transporte/reconciliación aquí) ⇒ la factory jamás devuelve real en esta superficie.
  const seleccion = () => seleccionarMetaWritePort({ autonomousReal, configReady, grantedScopes });

  // Estado del write path (para la UI y el veredicto). Nunca expone token/secreto.
  app.get('/acquisition/write/status', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    const sel = seleccion();
    return reply.send({ ok: true, datos: { modo: sel.modo, real: sel.modo === 'REAL', motivo: sel.motivo, autonomousReal, configReady, scopesRequeridos: SCOPES_ESCRITURA_REQUERIDOS, scopesConcedidos: grantedScopes, metaWriteCalls: 0, realMoneySpent: 0 } });
  });

  // Construir un plan de campaña (puro, sin persistir). Requiere mandato vigente para conocer restante/moneda/activo.
  app.post('/acquisition/campaign/plan', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    const m = await mandatoRepo.actual(a.org);
    if (m === null) return reply.code(409).send({ ok: false, error: 'SIN_MANDATO', mensaje: 'Autoriza primero un mandato de presupuesto.' });
    const adAccount = m.allowedMetaAssets[0];
    if (!adAccount) return reply.code(409).send({ ok: false, error: 'SIN_ACTIVO', mensaje: 'El mandato no tiene un activo (cuenta publicitaria) autorizado.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const plan = construirCampaignPlan({
      perfil: perfilDe(a.org, b), objetivo: objetivoDe(b['objetivo']), placement: placementDe(b['placement']),
      adAccountId: adAccount, moneda: m.currency, presupuestoDeseadoMinor: Number(b['presupuestoDeseadoMinor'] ?? 0), restanteMandatoMinor: restanteMinor(m),
      ...(b['servicioFoco'] ? { servicioFoco: String(b['servicioFoco']) } : {}),
    });
    return reply.send({ ok: true, datos: plan });
  });

  // Simular la ejecución de una campaña (dry-run) por el Action Plane. Persiste asientos al ledger.
  app.post('/acquisition/campaign/simulate', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    const m = await mandatoRepo.actual(a.org);
    if (m === null) return reply.code(409).send({ ok: false, error: 'SIN_MANDATO' });
    const adAccount = m.allowedMetaAssets[0];
    if (!adAccount) return reply.code(409).send({ ok: false, error: 'SIN_ACTIVO' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const plan = construirCampaignPlan({
      perfil: perfilDe(a.org, b), objetivo: objetivoDe(b['objetivo']), placement: placementDe(b['placement']),
      adAccountId: adAccount, moneda: m.currency, presupuestoDeseadoMinor: Number(b['presupuestoDeseadoMinor'] ?? 0), restanteMandatoMinor: restanteMinor(m),
      ...(b['servicioFoco'] ? { servicioFoco: String(b['servicioFoco']) } : {}),
    });
    const planId = String(b['planId'] ?? `plan-${m.id}-${ahora()}`);
    const d = deps();
    const r = await ejecutarCampana(d, seleccion().port, m, plan, planId);
    if (r.gastoComprometidoMinor > 0) { const act = await mandatoRepo.obtener(a.org, m.id); if (act) await mandatoRepo.guardar(act); }
    return reply.send({ ok: true, datos: { plan, ejecucion: r } });
  });

  // Correr un ciclo autónomo en SHADOW sobre observaciones aportadas. Persiste el ShadowRun + asientos.
  app.post('/acquisition/autonomy/shadow-run', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    const m = await mandatoRepo.actual(a.org);
    if (m === null) return reply.code(409).send({ ok: false, error: 'SIN_MANDATO' });
    const adAccount = m.allowedMetaAssets[0];
    if (!adAccount) return reply.code(409).send({ ok: false, error: 'SIN_ACTIVO' });
    const b = (req.body ?? {}) as { observaciones?: unknown };
    const obs: ObservacionAnuncio[] = Array.isArray(b.observaciones)
      ? b.observaciones.map((o) => {
          const x = o as Record<string, unknown>;
          return { adRef: String(x['adRef'] ?? ''), impresiones: Number(x['impresiones'] ?? 0), clics: Number(x['clics'] ?? 0), gastoMinor: Number(x['gastoMinor'] ?? 0), resultados: Number(x['resultados'] ?? 0), ventanaHoras: Number(x['ventanaHoras'] ?? 24) };
        })
      : [];
    const run = await correrCicloAutonomo(deps(), seleccion().port, { mandato: m, adAccountId: adAccount, observaciones: obs });
    await shadowRepo.guardar(run);
    return reply.send({ ok: true, datos: run });
  });

  app.get('/acquisition/autonomy/shadow/:mandatoId', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    const { mandatoId } = req.params as { mandatoId: string };
    return reply.send({ ok: true, datos: { runs: await shadowRepo.ultimos(a.org, mandatoId, 20) } });
  });
}
