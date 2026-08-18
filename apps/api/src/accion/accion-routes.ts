/**
 * apps/api · SAFE ACTION PLANE (V2-A) · Superficie HTTP (autenticada, tenant-scoped).
 *
 * Autorización/gobierno de mandatos = HUMANO (permiso business.manage). La simulación de acciones pasa por
 * el Action Plane (policy → budget guard → ledger); en V2-A el master switch REAL es false ⇒ DRY_RUN, cero
 * gasto real. Ningún camino permite que la máquina autónoma cree/eleve presupuesto.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, permisosDe } from '../superficie-auth';
import { crearReposAccion } from './accion-pg';
import { crearMandatoAutorizado, fijarKillSwitch, pausar, reanudar, reautorizar, revocar, restanteMinor, AutorizacionInvalidaError } from './mandato';
import { procesarAccion } from './action-plane';
import type { AccionPropuesta } from './budget-guard';

function ctx(req: FastifyRequest, reply: FastifyReply): { org: string; actor: string; ctx: ReturnType<typeof contextoDe> } | null {
  try {
    const c = contextoDe(req);
    return { org: String(c.organizationId), actor: String(c.actor), ctx: c };
  } catch {
    reply.code(401).send({ ok: false, error: 'NO_AUTENTICADO' });
    return null;
  }
}
const puedeGobernar = (req: FastifyRequest): boolean => permisosDe(req).has('business.manage');

export function registerAccionRoutes(app: FastifyInstance, pool: Pool | undefined): void {
  if (!pool) return;
  const { mandatoRepo, ledgerRepo } = crearReposAccion(pool);
  const autonomousReal = process.env.SOEC_AUTONOMOUS_REAL === 'true'; // V2-A: false por defecto ⇒ dry-run
  const globalKillSwitch = process.env.SOEC_KILL_SWITCH === 'true';
  const ahora = () => new Date().toISOString();

  const dto = (m: Awaited<ReturnType<typeof mandatoRepo.obtener>>) =>
    m === null ? null : { id: m.id, objective: m.objective, currency: m.currency, authorizedBudgetMinor: m.authorizedBudgetMinor, spentMinor: m.spentMinor, remainingMinor: restanteMinor(m), periodStart: m.periodStart, periodEnd: m.periodEnd, allowedMetaAssets: m.allowedMetaAssets, allowedActionTypes: m.allowedActionTypes, status: m.status, killSwitch: m.killSwitch, authorizedBy: m.authorizedBy, authorizedAt: m.authorizedAt, version: m.version };

  // Crear mandato — SÓLO humano (business.manage). authorizedBy = actor de la sesión.
  app.post('/acquisition/action/mandate', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    if (!puedeGobernar(req)) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    const b = (req.body ?? {}) as Partial<AccionPropuesta> & { objective?: string; currency?: string; authorizedBudgetMinor?: number; periodStart?: string; periodEnd?: string; allowedMetaAssets?: string[]; allowedActionTypes?: string[] };
    try {
      const m = crearMandatoAutorizado(
        { organizationId: a.org, objective: String(b.objective ?? ''), currency: String(b.currency ?? ''), authorizedBudgetMinor: Number(b.authorizedBudgetMinor), periodStart: String(b.periodStart ?? ''), periodEnd: String(b.periodEnd ?? ''), allowedMetaAssets: b.allowedMetaAssets ?? [], allowedActionTypes: b.allowedActionTypes ?? [] },
        a.actor, randomUUID(), ahora(),
      );
      await mandatoRepo.guardar(m);
      return reply.code(201).send({ ok: true, datos: dto(m) });
    } catch (e) {
      if (e instanceof AutorizacionInvalidaError) return reply.code(400).send({ ok: false, error: 'AUTORIZACION_INVALIDA', mensaje: e.message });
      throw e;
    }
  });

  app.get('/acquisition/action/mandate', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    return reply.send({ ok: true, datos: dto(await mandatoRepo.actual(a.org)) });
  });

  // Gobierno del mandato (humano): pausar/reanudar/revocar/kill-switch/reautorizar.
  app.post('/acquisition/action/mandate/:id/gobernar', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    if (!puedeGobernar(req)) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    const { id } = req.params as { id: string };
    const m = await mandatoRepo.obtener(a.org, id);
    if (m === null) return reply.code(404).send({ ok: false, error: 'NO_ENCONTRADO' });
    const b = (req.body ?? {}) as { accion?: string; killSwitch?: boolean; authorizedBudgetMinor?: number; periodEnd?: string };
    try {
      let out = m;
      if (b.accion === 'pausar') out = pausar(m);
      else if (b.accion === 'reanudar') out = reanudar(m, ahora());
      else if (b.accion === 'revocar') out = revocar(m);
      else if (b.accion === 'killswitch') out = fijarKillSwitch(m, b.killSwitch === true, ahora());
      else if (b.accion === 'reautorizar') out = reautorizar(m, Number(b.authorizedBudgetMinor), String(b.periodEnd), a.actor, ahora());
      else return reply.code(400).send({ ok: false, error: 'ACCION_INVALIDA' });
      await mandatoRepo.guardar(out);
      return reply.send({ ok: true, datos: dto(out) });
    } catch (e) {
      if (e instanceof AutorizacionInvalidaError) return reply.code(400).send({ ok: false, error: 'AUTORIZACION_INVALIDA', mensaje: e.message });
      throw e;
    }
  });

  // Simular una acción propuesta contra el mandato vigente (dry-run en V2-A). Persiste al ledger.
  app.post('/acquisition/action/simulate', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    const m = await mandatoRepo.actual(a.org);
    if (m === null) return reply.code(409).send({ ok: false, error: 'SIN_MANDATO' });
    const b = (req.body ?? {}) as { actionType?: string; assetId?: string; costMinor?: number; idempotencyKey?: string };
    const accion: AccionPropuesta = { organizationId: a.org, mandatoId: m.id, idempotencyKey: String(b.idempotencyKey ?? randomUUID()), actionType: String(b.actionType ?? ''), assetId: String(b.assetId ?? ''), costMinor: Number(b.costMinor ?? 0), currency: m.currency, propuestaPor: 'director' };
    const r = await procesarAccion({ ledger: ledgerRepo, ahora, autonomousReal, globalKillSwitch, nuevoId: () => randomUUID() }, m, accion);
    if (r.mandatoActualizado.spentMinor !== m.spentMinor || r.mandatoActualizado.status !== m.status) await mandatoRepo.guardar(r.mandatoActualizado);
    return reply.send({ ok: true, datos: { permitido: r.veredicto.permitido, modo: r.veredicto.modo, estado: r.asiento.estado, bloqueos: r.veredicto.bloqueos, gastoComprometidoMinor: r.gastoComprometidoMinor, remainingMinor: restanteMinor(r.mandatoActualizado) } });
  });

  app.get('/acquisition/action/ledger/:mandatoId', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    const { mandatoId } = req.params as { mandatoId: string };
    const asientos = await ledgerRepo.listar(a.org, mandatoId);
    return reply.send({ ok: true, datos: { asientos: asientos.map((x) => ({ actionType: x.actionType, assetId: x.assetId, costMinor: x.costMinor, currency: x.currency, estado: x.estado, modo: x.modo, bloqueos: x.bloqueos, decidedAt: x.decidedAt })) } });
  });
}
