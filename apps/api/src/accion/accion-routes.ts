/**
 * apps/api · SAFE ACTION PLANE (V2-A) · Superficie HTTP (autenticada, tenant-scoped).
 *
 * Autorización/gobierno de mandatos = HUMANO (permiso business.manage). La simulación de acciones pasa por
 * el Action Plane (policy → budget guard → ledger); en V2-A el master switch REAL es false ⇒ DRY_RUN, cero
 * gasto real. Ningún camino permite que la máquina autónoma cree/eleve presupuesto.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, permisosDe } from '../superficie-auth';
import { crearReposAccion } from './accion-pg';
import { crearMandatoAutorizado, fijarKillSwitch, pausar, reanudar, reautorizar, revocar, restanteMinor, AutorizacionInvalidaError, type ProveedorDeGasto } from './mandato';
import { presupuestoAutorizado } from './mandato-financiero';
import { aUnidadesMenores, normalizarMoneda } from '../dinero';
import { ACCIONES_EXPERIMENTO_BUSQUEDA } from '../campana/acciones';
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

  /**
   * ─────────────────────────────────────────────────────────────────────────────────────────────────────────
   * SUPERFICIE HUMANA DEL MANDATO FINANCIERO — «Presupuesto autorizado».
   *
   * Habla en pesos, no en unidades menores; en «máximo diario», no en micros; y no menciona sobres, Customer
   * ID, MCC ni autonomía, porque nada de eso es asunto de quien firma el dinero. Escribe en el MISMO recurso
   * que el plano de acción: no hay dos cifras que puedan contradecirse.
   *
   * Autorizar aquí NO enciende ninguna capacidad. Es una condición del gasto, no un permiso para gastar.
   * ─────────────────────────────────────────────────────────────────────────────────────────────────────────
   */
  /**
   * MONEDA DEL NEGOCIO, no del cliente. La declara la empresa al crearse y es la única con la que se puede
   * autorizar: dejar que la pantalla la propusiera sería dejar que un error de la pantalla cambiara de moneda
   * el dinero de alguien. Sin moneda declarada no se autoriza nada — «30.000» sin saber de qué es peor que
   * no decir nada (ver `dinero.ts`).
   */
  const monedaDelNegocio = async (org: string): Promise<string | null> => {
    const r = await pool.query('select currency from business_profile where organization_id = $1', [org]);
    return r.rows[0] === undefined ? null : normalizarMoneda(String((r.rows[0] as { currency: string }).currency));
  };

  app.get('/mandato-financiero', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    const m = await mandatoRepo.actual(a.org);
    return reply.send({
      organizationId: a.org,
      presupuesto: presupuestoAutorizado(m, ahora()),
      canal: m?.provider ?? null,
      monedaDelNegocio: await monedaDelNegocio(a.org),
    });
  });

  app.post('/mandato-financiero', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    // Sólo una persona con gobierno del negocio autoriza dinero. Y `authorizedBy` sale de la sesión, nunca del
    // cuerpo: si el cliente pudiera declarar quién autorizó, la autorización no probaría nada.
    if (!puedeGobernar(req)) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    const b = (req.body ?? {}) as { moneda?: string; totalMaximo?: number; maximoDiario?: number | null; canal?: string; dias?: number };
    const moneda = normalizarMoneda(b.moneda);
    if (moneda === null) return reply.code(400).send({ ok: false, error: 'MONEDA_INVALIDA' });
    const delNegocio = await monedaDelNegocio(a.org);
    if (delNegocio === null) return reply.code(409).send({ ok: false, error: 'NEGOCIO_SIN_MONEDA' });
    // Dos monedas distintas no se comparan ni se convierten: se rechaza y se dice cuál es la del negocio.
    if (delNegocio !== moneda) return reply.code(400).send({ ok: false, error: 'MONEDA_DISTINTA_DEL_NEGOCIO', monedaDelNegocio: delNegocio });
    const canal: ProveedorDeGasto | null = b.canal === 'GOOGLE_ADS' || b.canal === 'META_ADS' ? b.canal : null;
    if (canal === null) return reply.code(400).send({ ok: false, error: 'CANAL_INVALIDO' });
    const totalMinor = aUnidadesMenores(b.totalMaximo, moneda);
    if (totalMinor === null) return reply.code(400).send({ ok: false, error: 'TOTAL_INVALIDO' });
    const diarioMinor = b.maximoDiario === null || b.maximoDiario === undefined ? null : aUnidadesMenores(b.maximoDiario, moneda);
    if (b.maximoDiario !== null && b.maximoDiario !== undefined && diarioMinor === null) {
      return reply.code(400).send({ ok: false, error: 'DIARIO_INVALIDO' });
    }
    const dias = Number.isInteger(b.dias) && Number(b.dias) > 0 ? Number(b.dias) : 30;
    const desde = ahora();
    const hasta = new Date(Date.parse(desde) + dias * 24 * 3600_000).toISOString();
    /**
     * IDEMPOTENCIA POR AUTORIZACIÓN. El id deriva de lo autorizado —negocio, canal, moneda, topes— y no del
     * instante: pulsar dos veces el botón, o reintentar tras un timeout, no crea dos presupuestos. Cambiar una
     * cifra sí es otra autorización, y por tanto otro mandato.
     */
    const huella = createHash('sha256').update([a.org, canal, moneda, String(totalMinor), String(diarioMinor ?? '-')].join('|')).digest('hex').slice(0, 24);
    const id = `mandato:${huella}`;
    try {
      const previo = await mandatoRepo.obtener(a.org, id);
      if (previo !== null) {
        // Ya autorizado exactamente esto: se devuelve lo que hay. No se reescribe `authorizedAt` ni la versión,
        // porque la autorización original es la que ocurrió.
        return reply.code(200).send({ organizationId: a.org, presupuesto: presupuestoAutorizado(previo, ahora()), canal: previo.provider, creado: false });
      }
      const m = crearMandatoAutorizado(
        {
          organizationId: a.org,
          objective: 'presupuesto autorizado por la persona responsable del negocio',
          currency: moneda,
          provider: canal,
          authorizedBudgetMinor: totalMinor,
          dailyCapMinor: diarioMinor,
          periodStart: desde,
          periodEnd: hasta,
          allowedMetaAssets: [],
          allowedActionTypes: [...ACCIONES_EXPERIMENTO_BUSQUEDA],
        },
        a.actor, id, desde,
      );
      await mandatoRepo.guardar(m);
      app.log.info({ evento: 'MANDATO_FINANCIERO_AUTORIZADO', organizationId: a.org, mandatoId: m.id, canal, moneda, totalMinor, diarioMinor, autorizacion: 'HUMAN_EXPLICIT', actor: a.actor });
      return reply.code(201).send({ organizationId: a.org, presupuesto: presupuestoAutorizado(m, ahora()), canal: m.provider, creado: true });
    } catch (e) {
      if (e instanceof AutorizacionInvalidaError) return reply.code(400).send({ ok: false, error: 'AUTORIZACION_INVALIDA', mensaje: e.message });
      throw e;
    }
  });

  app.get('/acquisition/action/ledger/:mandatoId', async (req, reply) => {
    const a = ctx(req, reply); if (!a) return;
    const { mandatoId } = req.params as { mandatoId: string };
    const asientos = await ledgerRepo.listar(a.org, mandatoId);
    return reply.send({ ok: true, datos: { asientos: asientos.map((x) => ({ actionType: x.actionType, assetId: x.assetId, costMinor: x.costMinor, currency: x.currency, estado: x.estado, modo: x.modo, bloqueos: x.bloqueos, decidedAt: x.decidedAt })) } });
  });
}
