/**
 * Rutas de medición y optimización (F2-MET-01) + superficie REAL por organización.
 *
 * MULTIEMPRESA (D-1/D-4): las rutas REALES ya NO fijan la organización en código. La organización
 * proviene EXCLUSIVAMENTE del contexto autenticado que inyecta el gateway, y cada petición pasa por
 * `bindExperienciaReal`, que exige negocio + perfil registrados para ESA organización.
 *
 *   petición de org-X  →  datos de org-X, o error explícito
 *   organización sin configuración  →  404 ORGANIZATION_NOT_CONFIGURED (nunca datos de otra)
 *
 * NO hay endpoint para gastar, publicar públicamente ni saltar la autorización.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ActorId, OrganizationId, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import { MeasurementExperience } from './measurement-experience';
import { construirPanel, type ObsPanel, type Sync } from './ingesta/panel-resultados';
import { adsSnapshotStreamId, ultimoSnapshotAds, adsRefreshStateStreamId, ultimoRefreshState, EVENTO_REFRESH_STATE, type AdsRefreshState } from './ingesta/ingesta-google-ads-service';
import { construirIngestaGoogleAds, googleAdsConfigurado } from './ingesta/google-ads-runtime';
import { PgBudgetAuthorizationRepo } from './autonomia-ads/budget-authorization-pg';
import { evaluarGuardrail } from './autonomia-ads/guardrail-financiero';
import { evaluarEstrategiaDirector } from './autonomia-ads/estrategia-director';
import type { Pool } from 'pg';
import { LecturaDirectorRealService } from './real-director/lectura-director-real';
import { PlanAccionDryRunService, type PerfilUsuario, type CapLookup } from './autonomia-ads/plan-accion-service';
import { G2AService } from './autonomia-ads/g2a-service';
import { CampaignOperatorDryRunService, type EntradaOperador } from './campana/campaign-operator-service';
import type { CanalId } from './campana/marketing-plan';
import { DiagnosisEvidenceService } from './campana/diagnosis-evidence-service';
import { normalizarReadinessInput } from './campana/diagnosis-evidence';
import { contextoDe } from './superficie-auth';
import {
  bindExperienciaReal,
  type ExperienciaReal,
  type OrganizationExperienceBinding,
} from './plataforma';

/**
 * Contexto REAL de lectura: organización del gateway + binding verificado. FAIL-CLOSED — si la
 * organización no está registrada o la experiencia no está habilitada para ella, lanza.
 */
function real(
  req: FastifyRequest,
  experiencia: ExperienciaReal,
): { ctx: RequestContext; org: string; binding: OrganizationExperienceBinding } {
  const autenticado = contextoDe(req);
  const binding = bindExperienciaReal(autenticado, experiencia);
  const o = OrganizationId(binding.organizationId);
  const ctx: RequestContext = {
    organizationId: o,
    actor: ActorId(String(autenticado.actor)),
    scope: { organizationId: o, permissions: ['events:read'] },
    correlationId: autenticado.correlationId,
  };
  return { ctx, org: binding.organizationId, binding };
}

export function registerMeasurementRoutes(app: FastifyInstance, store: EventStore, pool?: Pool): void {
  const exp = new MeasurementExperience(store);
  const budgetRepo = pool ? new PgBudgetAuthorizationRepo(pool) : null;

  // LECTURA de observaciones REALES (M8, puerta gobernada) — separadas del eje simulado (med:*).
  // Con muestra mínima NO se emite recomendación: se reporta el HECHO real y conclusión NO_EVALUABLE.
  app.get('/medicion/reales', async (req, reply) => {
    const { ctx: c, org, binding } = real(req, 'medicion-real');
    const obs = new ObservacionService(store, {} as never);
    const ids = await obs.listarIds(c);
    const observaciones: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const st = await obs.cargar(c, id);
      const d = st.datos;
      if (!d || d.naturaleza !== 'REAL' || !d.provenanciaReal) continue;
      const p = d.provenanciaReal;
      observaciones.push({
        externalEventId: p.externalEventId,
        eventName: p.eventName,
        naturaleza: d.naturaleza,
        estado: st.estado,
        occurredAt: p.occurredAt,
        provider: p.provider,
        diagnostico: p.diagnostico,
        elegibleParaAprendizaje: !p.diagnostico,
        utmSource: p.utmSource,
        utmCampaign: p.utmCampaign,
      });
    }
    // Orden por instante de ocurrencia (desc); externalEventId es string (multi-proveedor).
    observaciones.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
    const comerciales = observaciones.filter((o) => o.elegibleParaAprendizaje).length;

    // Estado de última sincronización por fuente REGISTRADA de ESTA organización (no una lista global).
    const sincronizaciones: Array<Record<string, unknown>> = [];
    for (const fuente of binding.fuentes) {
      const eventos = await store.readStream(c, `ingesta-estado:${fuente.provider}:${org}`);
      let ultimo: { ok?: boolean; at?: string; error?: string } | null = null;
      for (const e of eventos)
        if (e.type === 'sync.registrada')
          ultimo = e.payload as { ok?: boolean; at?: string; error?: string };
      sincronizaciones.push({
        provider: fuente.provider,
        estadoFuente: fuente.estado,
        ok: ultimo?.ok ?? null,
        at: ultimo?.at ?? null,
      });
    }
    const porProveedor: Record<string, number> = {};
    for (const o of observaciones)
      porProveedor[String(o.provider)] = (porProveedor[String(o.provider)] ?? 0) + 1;

    return reply.send({
      ok: true,
      organizationId: org,
      total: observaciones.length,
      comerciales,
      diagnosticos: observaciones.length - comerciales,
      porProveedor,
      sincronizaciones,
      // Muestra insuficiente: NUNCA se calcula una métrica comercial ni se recomienda; se afirma el hecho.
      conclusion: 'NO_EVALUABLE_CON_DATOS_REALES',
      observaciones,
    });
  });

  // PANEL DE RESULTADOS: presentación pura de datos REALES ya persistidos (no ingesta, no cálculo de atribución).
  app.get('/medicion/panel', async (req, reply) => {
    const { ctx: c, org, binding } = real(req, 'medicion-real');
    const obs = new ObservacionService(store, {} as never);
    const ids = await obs.listarIds(c);
    const observaciones: ObsPanel[] = [];
    for (const id of ids) {
      const st = await obs.cargar(c, id);
      const d = st.datos;
      if (!d || d.naturaleza !== 'REAL' || !d.provenanciaReal) continue;
      const p = d.provenanciaReal;
      observaciones.push({
        provider: p.provider,
        eventName: p.eventName,
        metrica: d.metrica ?? null,
        valor: d.valor ?? null,
        occurredAt: p.occurredAt,
        diagnostico: p.diagnostico,
        utmCampaign: p.utmCampaign ?? null,
        utmContent: p.utmContent ?? null,
        limitaciones: d.limitaciones ?? [],
        externalEventId: p.externalEventId,
      });
    }
    // Estado de última sincronización por fuente REGISTRADA de ESTA organización, con estado fino.
    const sincronizaciones: Sync[] = [];
    for (const fuente of binding.fuentes) {
      const eventos = await store.readStream(c, `ingesta-estado:${fuente.provider}:${org}`);
      type UltimoSync = { ok?: boolean; at?: string; estado?: 'OK' | 'PARCIAL' | 'FALLO' };
      let ultimo: UltimoSync | null = null;
      for (const e of eventos) if (e.type === 'sync.registrada') ultimo = e.payload as UltimoSync;
      sincronizaciones.push({
        provider: fuente.provider,
        ok: ultimo?.ok ?? null,
        at: ultimo?.at ?? null,
        estado: ultimo?.estado ?? null,
      });
    }

    // Snapshot acumulado vigente (stream dedicado last-wins): cabecera + cifras Ads frescas de cada sync.
    const snapshotActual = ultimoSnapshotAds(await store.readStream(c, adsSnapshotStreamId(org)));
    // Estado del último refresh a Google Ads (observabilidad: cuándo se consultó y si falló, p.ej. OAuth caducado).
    const lastRefresh = ultimoRefreshState(await store.readStream(c, adsRefreshStateStreamId(org)));

    const panelBase = construirPanel(observaciones, sincronizaciones, snapshotActual, new Date().toISOString());

    // GUARDRAIL FINANCIERO (P0, READ-ONLY): separa el presupuesto DIARIO de Google del cap TOTAL autorizado
    // por el humano. El cap sale del registro de autorizaciones (vacío ⇒ SIN_CAP; NO se inventa un tope).
    let googleAdsGuardrail: Record<string, unknown> | null = null;
    let estrategiaDirector: ReturnType<typeof evaluarEstrategiaDirector> | null = null;
    if (snapshotActual) {
      const cap = budgetRepo ? (await budgetRepo.obtenerVigente(org, snapshotActual.campaignId))?.authorizedTotalAmount ?? null : null;
      const gf = (panelBase as unknown as { growthFunnel?: { comercial?: Record<string, number> } }).growthFunnel;
      const contactos = gf?.comercial?.lead_created ?? 0;
      googleAdsGuardrail = {
        campaignId: snapshotActual.campaignId,
        campaignName: snapshotActual.campaignName,
        campaignStatus: snapshotActual.status, // PAUSED visible; el histórico de métricas NO se borra
        dailyBudget: snapshotActual.dailyBudget ?? null, // GOOGLE_DAILY_BUDGET, distinto del cap total
        gastoAcumulado: snapshotActual.cost,
        capAutorizado: cap,
        moneda: 'CLP',
        ...evaluarGuardrail({ gastoActual: snapshotActual.cost ?? 0, capAutorizado: cap, contactosReales: contactos, moneda: 'CLP' }),
      };

      // ESTRATEGIA DEL DIRECTOR (READ-ONLY): evidencia del funnel + términos → diagnóstico/hipótesis/decisiones.
      // Misma evidencia que el guardrail (no una segunda fuente). Ninguna decisión ejecuta nada.
      const terminos = (panelBase as unknown as { searchTerms?: { termino: string; impresiones: number; clics: number }[] }).searchTerms ?? [];
      estrategiaDirector = evaluarEstrategiaDirector({
        impresiones: snapshotActual.impressions ?? 0,
        clics: snapshotActual.clicks ?? 0,
        gasto: snapshotActual.cost ?? 0,
        contactosReales: contactos,
        capAutorizado: cap,
        campaignStatus: snapshotActual.status,
        moneda: 'CLP',
        terminos,
      });
    }

    return reply.send({
      organizationId: org,
      ...panelBase,
      adsRefresh: lastRefresh, // { queriedAt, ok, estado, ventana, error, dataThrough } | null
      googleAdsConfigured: googleAdsConfigurado(process.env, org),
      googleAdsGuardrail, // { campaignStatus, dailyBudget, gastoAcumulado, capAutorizado, estado, decisionRequerida, ... } | null
      estrategiaDirector, // { funnelZeroConversion, diagnostico, hipotesis, estrategia, decisiones[], ... } | null
    });
  });

  /**
   * Refresh MANUAL de Google Ads (READ ONLY). Reutiliza el MISMO caso de uso que el scheduler/script
   * (`construirIngestaGoogleAds` → `IngestaGoogleAds.correrUnaVez`). Consulta REAL a Google Ads, normaliza y
   * persiste; si OAuth/consulta falla, el fallo queda VISIBLE (fail-closed) y NO se fabrica frescura. Nunca
   * escribe en Google Ads. Si la org no está configurada ⇒ NOT_CONFIGURED (sin inventar datos).
   */
  app.post('/medicion/refresh-ads', async (req, reply) => {
    const { org } = real(req, 'medicion-real');
    const o = OrganizationId(org);
    const cAppend: RequestContext = { organizationId: o, actor: ActorId('panel-refresh'), scope: { organizationId: o, permissions: ['events:read', 'events:append'] }, correlationId: `panel-refresh-${org}` };
    const queriedAt = new Date().toISOString();

    const ingesta = construirIngestaGoogleAds(store, process.env, org);
    if (ingesta === null) {
      return reply.send({ ok: false, estado: 'NOT_CONFIGURED', queriedAt, mensaje: 'Google Ads no está conectado para este negocio.' });
    }
    const r = await ingesta.correrUnaVez(cAppend, { ahora: queriedAt });
    const okReal = r.estado === 'OK';
    const error = r.fallos.length > 0 ? r.fallos[0]!.replace(/^[^:]+:\s*/, '') : null; // clase/mensaje, sin secretos
    // dataThrough = ÚLTIMA fecha realmente devuelta por Google (no la ventana solicitada ni capturedAt).
    const estadoState: AdsRefreshState = { queriedAt, ok: okReal, estado: r.estado, ventana: r.ventana, error, dataThrough: r.dataThrough };
    // Persistimos el estado del intento (LAST-WINS): hace VISIBLE que se consultó y si falló.
    const prev = await store.readStream(cAppend, adsRefreshStateStreamId(org));
    await store.append(cAppend, adsRefreshStateStreamId(org), prev.length, [{ type: EVENTO_REFRESH_STATE, payload: estadoState, attribution: { source: 'google-ads', purpose: 'refresh-manual', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' }, occurredAt: queriedAt }]).catch(() => undefined);

    return reply.send({ ok: okReal, estado: r.estado, queriedAt, ventana: r.ventana, snapshotFilas: r.snapshotFilas, nuevos: r.nuevos, error });
  });

  // LECTURA DEL DIRECTOR sobre datos REALES (org-smileflow). GET = lectura pura (sin efectos);
  // POST recalcular = recorre M8 → MeasurementService → M9 → ResultadoCampania y persiste el resultado.
  const lecturaDirector = new LecturaDirectorRealService(store);
  app.get('/medicion/lectura-director', async (req, reply) => {
    const { org } = real(req, 'director-real');
    const lectura = await lecturaDirector.leerUltima(org);
    if (!lectura)
      return reply.send({
        veredicto: 'NO_EVALUABLE',
        naturaleza: 'REAL',
        organizationId: org,
        motivo: 'aún no se ha calculado la lectura sobre datos reales',
      });
    return reply.send({ organizationId: org, ...lectura });
  });
  app.post('/medicion/lectura-director/recalcular', async (req, reply) => {
    const { org } = real(req, 'director-real');
    return reply.code(201).send(await lecturaDirector.recalcular(org, new Date().toISOString()));
  });

  // PLAN DE ACCIÓN (G1 · ASISTIDO DRY-RUN). GET = plan pura (sin efectos); POST genera y persiste.
  // NADA se ejecuta: AUTONOMOUS_REAL apagado, el Executor sólo simula.
  const capLookup: CapLookup | undefined = budgetRepo
    ? async (o, campaignId) => (await budgetRepo.obtenerVigente(o, campaignId))?.authorizedTotalAmount ?? null
    : undefined;
  const planAccion = new PlanAccionDryRunService(store, capLookup);
  app.get('/medicion/plan-accion', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    const plan = await planAccion.leerUltimo(org);
    if (!plan)
      return reply.send({
        modo: 'DRY_RUN',
        autonomousReal: false,
        organizationId: org,
        totalPropuestas: 0,
        resumenSimple: 'Aún no se ha generado el plan de acción.',
        items: [],
      });
    return reply.send({ organizationId: org, ...plan });
  });
  app.post('/medicion/plan-accion/generar', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    const { perfil } = (req.body ?? {}) as { perfil?: PerfilUsuario };
    return reply
      .code(201)
      .send(await planAccion.generar(org, new Date().toISOString(), perfil ? { perfil } : {}));
  });

  // G2-A · bandeja de aprobaciones (lenguaje simple) + aprobar/rechazar. AUTONOMOUS_REAL=false ⇒ dry-run, 0 mutate.
  const g2a = new G2AService(store);
  app.get('/medicion/g2a-bandeja', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    return reply.send({
      ok: true,
      organizationId: org,
      bandeja: await g2a.bandeja(org, new Date().toISOString()),
    });
  });
  app.post('/medicion/g2a-aprobar', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    const { intencionId, actorHumano } = (req.body ?? {}) as {
      intencionId?: string;
      actorHumano?: string;
    };
    if (!intencionId || !actorHumano)
      return reply.code(400).send({ ok: false, error: 'faltan intencionId/actorHumano' });
    try {
      const r = await g2a.aprobarYEjecutar(org, intencionId, actorHumano, new Date().toISOString());
      return reply.code(201).send({ ok: true, organizationId: org, ...r });
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post('/medicion/g2a-rechazar', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    const { intencionId, actorHumano, motivo } = (req.body ?? {}) as {
      intencionId?: string;
      actorHumano?: string;
      motivo?: string;
    };
    if (!intencionId || !actorHumano)
      return reply.code(400).send({ ok: false, error: 'faltan intencionId/actorHumano' });
    await g2a.rechazar(
      org,
      intencionId,
      actorHumano,
      motivo ?? 'rechazada',
      new Date().toISOString(),
    );
    return reply.code(201).send({ ok: true });
  });

  // CAMPAIGN OPERATOR (DRY-RUN): objetivo + presupuesto + período → MARKETING_PLAN + CAMPAIGN_DRAFTS +
  // CHANNEL_ALLOCATION + criterios + AUTHORIZED_EXECUTION_ENVELOPE (DRAFT). NADA se gasta ni se escribe:
  // AUTONOMOUS_REAL=false, envelope en DRAFT. GET = lectura pura del último plan simulado.
  const campaignOperator = new CampaignOperatorDryRunService(store, capLookup, process.env);
  app.get('/medicion/campaign-operator', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    const ultimo = await campaignOperator.leerUltimo(org);
    if (!ultimo) return reply.send({ modo: 'DRY_RUN', autonomousReal: false, organizationId: org, plan: null, envelopeDraft: null });
    return reply.send({ organizationId: org, ...ultimo });
  });
  app.post('/medicion/campaign-operator-plan', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    const b = (req.body ?? {}) as { objetivo?: string; presupuestoTotal?: number; periodoDias?: number; canales?: CanalId[]; landingUrl?: string; historicalCpa?: number | null };
    if (!b.objetivo || typeof b.presupuestoTotal !== 'number' || typeof b.periodoDias !== 'number')
      return reply.code(400).send({ ok: false, error: 'faltan objetivo/presupuestoTotal/periodoDias' });
    const entrada: EntradaOperador = { objetivo: b.objetivo, presupuestoTotal: b.presupuestoTotal, periodoDias: b.periodoDias, ...(b.canales ? { canales: b.canales } : {}), ...(b.landingUrl ? { landingUrl: b.landingUrl } : {}), ...(b.historicalCpa != null ? { historicalCpa: b.historicalCpa } : {}) };
    return reply.code(201).send({ organizationId: org, ...(await campaignOperator.planificar(org, new Date().toISOString(), entrada)) });
  });

  // INGESTA de EVIDENCIA DE DIAGNÓSTICO (readiness del funnel). GET = lectura; POST = registrar (auditable).
  // El diagnóstico se hace FUERA de SOEC; esta vía lo incorpora para que el planner no vuelva a exigirlo.
  const diagnosisEvidence = new DiagnosisEvidenceService(store);
  app.get('/medicion/diagnosis-evidence', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    return reply.send({ organizationId: org, readiness: await diagnosisEvidence.leerUltima(org) });
  });
  app.post('/medicion/diagnosis-evidence', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    // Writer↔reader alineados: valueProps y validatedDestinations se aceptan en primer nivel y se PRESERVAN.
    const norm = normalizarReadinessInput(req.body, new Date().toISOString());
    if (!norm.ok) return reply.code(400).send({ ok: false, error: norm.error });
    return reply.code(201).send({ organizationId: org, readiness: await diagnosisEvidence.registrar(org, norm.readiness, new Date().toISOString()) });
  });

  app.post('/medicion/preparar', async (_req, reply) => {
    await exp.preparar();
    return reply.code(201).send({ ok: true });
  });
  app.get('/medicion/estado', async (_req, reply) => reply.send(await exp.estado()));
  app.post('/medicion/sincronizar', async (req, reply) => {
    const { escenario } = (req.body ?? {}) as {
      escenario?: 'alto' | 'bajo' | 'insuficiente' | 'gasto_excedido';
    };
    return reply.code(201).send(await exp.sincronizarTodo(escenario ?? 'bajo'));
  });
  app.post('/medicion/optimizar', async (_req, reply) =>
    reply.code(201).send(await exp.optimizarTodo()),
  );
}
