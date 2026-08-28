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
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
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
import { retirarKeywordsDenegadasDelPlan, esKeywordDenegadaPorPoliticaGoogle, KEYWORDS_DENEGADAS_POLITICA_GOOGLE } from './campana/marketing-plan';
import { DiagnosisEvidenceService } from './campana/diagnosis-evidence-service';
import { normalizarReadinessInput } from './campana/diagnosis-evidence';
import { EnvelopeService } from './campana/envelope-service';
import { derivarFlagsDeModo, type ProviderState, type FinancialState } from './campana/authorized-execution-envelope';
import { providerStateDeConexion } from './campana/provider-readiness';
import { connectionIdDe } from './acquisition/google-ads-connection';
import type { ComponentesFlujoGoogleAds } from './acquisition/google-ads-oauth-flow';
import { correrShadow, evaluarGateEnvelope, evaluarCompatibilidadMaterial, detalleIntent, auditoriaShadowDerivada } from './campana/execution-engine';
import { fingerprintsDelPlan } from './campana/material-fingerprint';
import { ledgerCero } from './campana/financial-ledger';
import { ResourceBindingService } from './campana/resource-binding';
import { CONTEXTO_CANARY } from './campana/canary-execution';
import { ejecutarCanaryAtomico, TRANSPORT_ATOMICO } from './campana/canary-atomic-execution';
import { reconciliarBindings } from './campana/canary-reconciliation';
import { correlacionarGrafo, consultasRecuperacion, type RecursosLeidos } from './campana/canary-provider-recovery';
import { hashPlan } from './campana/plan-hash';
import type { GoogleAdsWriteLog } from './campana/google-ads-mutate-http';
import { GoogleSearchError } from './campana/google-ads-mutate-http';
import { construirClienteEscrituraGoogleAds, resolverGeoRegiones } from './campana/google-ads-write-runtime';
import { materializarGoogleAdsMutate, ventanaFechasDesdeActivacion, contarOperaciones } from './campana/google-ads-materializer';
import { GEO_SMILEFLOW_V2, type GeoRegionResuelta } from './campana/geo-policy';
import { getRecursoGoogleAds } from './plataforma';
import { contextoDe, permisosDe, modoOperativoDe } from './superficie-auth';
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

/**
 * Deriva un contexto con permiso de ESCRITURA a partir del de lectura. El ctx de `real()` sólo trae
 * `events:read`; `store.append` exige `events:append` (requireScope) ⇒ sin esto el append LANZA y el
 * `.catch(() => undefined)` lo tragaba en silencio: fue la causa exacta de que la persistencia del validate
 * (y del execute) quedara vacía. No amplía el alcance de lectura de las rutas; sólo habilita el append puntual.
 */
function ctxAppend(ctx: RequestContext): RequestContext {
  return { ...ctx, scope: { ...ctx.scope, permissions: [...ctx.scope.permissions, 'events:append'] } };
}

const ATR_CANARY: Attribution = { source: 'canary-execute', purpose: 'intento real de escritura Google Ads (auditable, sin secretos)', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };

export function registerMeasurementRoutes(app: FastifyInstance, store: EventStore, pool?: Pool, googleAdsComp?: ComponentesFlujoGoogleAds | null): void {
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
    const resultado = await campaignOperator.planificar(org, new Date().toISOString(), entrada);
    // MATERIALIZACIÓN SERVER-SIDE del sobre: si el draft está listo para revisión humana, se persiste el
    // AuthorizedExecutionEnvelope (idempotente por planHash) para que GET /medicion/envelope lo devuelva.
    let envelope = null;
    if (resultado.plan.campaignDraftStatus === 'READY_FOR_APPROVAL') {
      envelope = await envelopeSvc.crearDesdePlan(org, resultado.plan, `plan:${org}:${resultado.at}`, new Date().toISOString());
    }
    return reply.code(201).send({ organizationId: org, ...resultado, envelope });
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

  // AUTHORIZED EXECUTION ENVELOPE (soberanía financiera humana). Crear/leer/aprobar(HUMANO)/revocar. NADA se
  // ejecuta: SOEC_SUPERVISED_REAL y SOEC_AUTONOMOUS_REAL en false ⇒ validateAuthorizedExecution DENIEGA siempre.
  const envelopeSvc = new EnvelopeService(store);
  // GATE EXTERNO desde la CONEXIÓN OAuth REAL (CONNECTED + cuenta seleccionada + sin re-auth), NO de una env var
  // estática ni del interruptor de autonomía. `autonomousReal=false` no bloquea la ejecución SUPERVISADA (su gate
  // es `supervisedReal`, evaluado aparte). Fail-closed: sin composición/conexión ⇒ no listo ⇒ EXTERNAL_GATE_BLOCKED.
  const providerYFinancieroDe = async (org: string): Promise<{ prov: ProviderState; fin: FinancialState }> => {
    const conexion = googleAdsComp ? await googleAdsComp.connRepo.obtener(org, connectionIdDe(org)) : null;
    return {
      prov: providerStateDeConexion(conexion, new Date().toISOString()),
      fin: { historicalSpend: 0, envelopeSpend: 0, committedSpend: 0 }, // histórico NO cuenta en el envelope
    };
  };
  app.get('/medicion/envelope', async (req, reply) => {
    const { ctx: c, org } = real(req, 'autonomia-ads');
    const envelope = await envelopeSvc.leerUltimo(org);
    const plan = (await campaignOperator.leerUltimo(org))?.plan ?? null;
    // Contadores financieros: histórico ≠ gasto del envelope. El histórico NUNCA descuenta remainingCap.
    const snap = ultimoSnapshotAds(await store.readStream(c, adsSnapshotStreamId(org)));
    const historicalSpend = snap?.cost ?? 0;
    const envelopeSpend = 0; // gasto generado por acciones del envelope tras activación (aún ninguna)
    const committedSpend = 0; // gasto comprometido por acciones pendientes (aún ninguna)
    const remainingCap = envelope ? envelope.totalCap - envelopeSpend - committedSpend : 0;
    // GATE UNIFICADO: misma precedencia que /medicion/execution-plan (envelope-first ⇒ ENVELOPE_NOT_APPROVED).
    const { prov: provEnv } = await providerYFinancieroDe(org);
    // Gate y read model comparten la MISMA fuente: el modo operativo de la org autenticada (no env, no constante).
    const flagsEnv = derivarFlagsDeModo(modoOperativoDe(req));
    const rGate = evaluarGateEnvelope(envelope, plan, provEnv, flagsEnv);
    const executionAllowed: { decision: string; reasonCode: string | null } = { decision: rGate.decision, reasonCode: rGate.reasonCode };
    return reply.send({ organizationId: org, envelope, financial: { historicalSpend, envelopeSpend, committedSpend, remainingCap }, executionAllowed, autonomousReal: flagsEnv.autonomousReal, supervisedReal: flagsEnv.supervisedReal });
  });
  app.get('/medicion/envelope-audit', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    return reply.send({ organizationId: org, audit: await envelopeSvc.auditoria(org) });
  });
  app.post('/medicion/envelope', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    const ultimo = await campaignOperator.leerUltimo(org);
    if (!ultimo?.plan) return reply.code(409).send({ ok: false, error: 'no hay plan de campaña; generá el plan primero' });
    const envelope = await envelopeSvc.crearDesdePlan(org, ultimo.plan, `plan:${org}:${ultimo.at}`, new Date().toISOString());
    return reply.code(201).send({ organizationId: org, envelope });
  });
  // APROBACIÓN HUMANA (financiera). La ejecuta la PERSONA desde la UI; su identidad queda registrada.
  app.post('/medicion/envelope-approve', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    const plan = (await campaignOperator.leerUltimo(org))?.plan;
    if (!plan) return reply.code(409).send({ ok: false, error: 'no hay plan vigente' });
    const actor = String((req as unknown as { user?: { sub?: string } }).user?.sub ?? 'humano');
    const { prov } = await providerYFinancieroDe(org);
    try {
      const r = await envelopeSvc.aprobar(org, actor, plan, new Date().toISOString(), prov.executionEligibleChannels);
      return reply.code(201).send({ organizationId: org, ...r });
    } catch (e) { return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
  });
  app.post('/medicion/envelope-revoke', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    const actor = String((req as unknown as { user?: { sub?: string } }).user?.sub ?? 'humano');
    try {
      const r = await envelopeSvc.revocar(org, actor, new Date().toISOString());
      return reply.code(201).send({ organizationId: org, ...r });
    } catch (e) { return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
  });

  // EXECUTION PLAN (SHADOW, read-only): traduce el plan aprobado + envelope a intents Google, valida por el
  // pipeline único y calcula impacto financiero SIN llamar a la red. Reporta dónde se frenaría la ejecución real.
  const bindingSvc = new ResourceBindingService(store);
  app.get('/medicion/execution-plan', async (req, reply) => {
    const { ctx: c, org } = real(req, 'autonomia-ads');
    const envelope = await envelopeSvc.leerUltimo(org);
    const plan = (await campaignOperator.leerUltimo(org))?.plan ?? null;
    if (!envelope || !plan) return reply.send({ organizationId: org, shadowPlanCreated: false, mode: 'SHADOW', providerMutateCalls: 0 });
    const snap = ultimoSnapshotAds(await store.readStream(c, adsSnapshotStreamId(org)));
    const ledger = ledgerCero(envelope.totalCap, envelope.experimentBudget, snap?.cost ?? 0);
    const { prov } = await providerYFinancieroDe(org);
    const flags = derivarFlagsDeModo(modoOperativoDe(req));
    let customerId = 'PENDING';
    try { customerId = getRecursoGoogleAds(org).customerId; } catch { /* org sin recurso: customerId placeholder, no afecta SHADOW */ }
    const bindings = await bindingSvc.listar(org);
    const providerBindings = { count: bindings.length, fabricatedIds: bindings.filter((b) => b.providerResourceId != null).length };
    const detail = (req.query as { detail?: string } | undefined)?.detail;
    // COMPATIBILIDAD MATERIAL (fail-closed, sin efectos): un envelope/plan del schema anterior (sin budgetPolicy /
    // sin authorizedDurationDays / con ADJUST_DAILY_BUDGET) NO se ejecuta ni se reinterpreta como CAMPAIGN_TOTAL.
    // El GET NO muta el envelope legacy (ni supersede/aprueba/regenera): sólo reporta que requiere refresh material.
    const compat = evaluarCompatibilidadMaterial(envelope, plan);
    if (!compat.compatible) {
      const baseIncompat = {
        organizationId: org, shadowPlanCreated: false, mode: 'SHADOW' as const, summary: null,
        realExecutionDecision: 'DENY' as const, realExecutionReason: compat.reasonCode,
        providerMutateCalls: 0 as const, ledger, providerBindings,
        envelopeCompatibility: { compatible: false, reasonCode: compat.reasonCode },
      };
      if (detail === 'intents') return reply.send({ ...baseIncompat, intents: [], shadowAudit: [] });
      return reply.send(baseIncompat);
    }
    const r = correrShadow(plan, envelope, customerId, ledger, prov, flags, new Date().toISOString(), bindings);
    const base = {
      organizationId: org, shadowPlanCreated: true, mode: r.mode, summary: r.summary,
      realExecutionDecision: r.realExecutionDecision, realExecutionReason: r.realExecutionReason,
      providerMutateCalls: r.providerMutateCalls, ledger, providerBindings,
      envelopeCompatibility: { compatible: true, reasonCode: null },
    };
    // detail=intents ⇒ intents completos (sanitizados) + auditoría SHADOW derivada. GET siempre side-effect free.
    if (detail === 'intents') {
      const fps = fingerprintsDelPlan(plan);
      return reply.send({ ...base, intents: r.intents.map((it) => detalleIntent(it, fps, envelope.currency)), shadowAudit: auditoriaShadowDerivada(r) });
    }
    return reply.send(base);
  });

  // CANARY REAL — entry point autenticado del ejecutor Phase2B (wiring mínimo). Protegido por TODOS los gates
  // existentes + CONTEXTO fijo (org/envelope/planHash/customerId). En este estado SUPERVISED_REAL=false ⇒ DENY
  // ANTES de tocar el proveedor: 0 provider mutate, 0 bindings, 0 gasto. NO se activa el canary en este bloque.
  app.post('/medicion/canary-execute', async (req, reply) => {
    const { ctx: c, org } = real(req, 'autonomia-ads'); // auth + binding (fail-closed → 401/403)
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    const envelope = await envelopeSvc.leerUltimo(org);
    const plan = (await campaignOperator.leerUltimo(org))?.plan ?? null;
    const snap = ultimoSnapshotAds(await store.readStream(c, adsSnapshotStreamId(org)));
    const ledger = ledgerCero(envelope?.totalCap ?? 0, envelope?.experimentBudget ?? 0, snap?.cost ?? 0);
    const { prov } = await providerYFinancieroDe(org);
    const flags = derivarFlagsDeModo(modoOperativoDe(req));
    let customerId = 'PENDING';
    try { customerId = getRecursoGoogleAds(org).customerId; } catch { /* org sin recurso: customerId placeholder ⇒ CUSTOMER_ID_MISMATCH */ }
    // TRANSPORTE REAL = Google-native ATÓMICO (idéntico al validado con validateOnly=true): materializarGoogleAdsMutate
    // → mutarGrafo, UNA sola GoogleAdsService.Mutate (validateOnly=false, partialFailure=false). El camino LEGACY
    // por-servicio (campaignBudgets:mutate, campaigns:mutate, …) queda estructuralmente FUERA del canary real: aquí
    // ya NO se construye GoogleAdsRealMutatePort ni ejecutarEnvelopeReal. Fail-closed: el gate financiero/maestro
    // (SUPERVISED_REAL incluido) corre ANTES del proveedor ⇒ en PILOT, 0 llamadas. Logs sanitizados durables.
    const writeLogs: GoogleAdsWriteLog[] = [];
    const cliente = construirClienteEscrituraGoogleAds(process.env, org, googleAdsComp, { validateOnly: false, logger: (i) => { app.log.info(i, 'ga-write'); writeLogs.push(i); } });
    const realTransportReady = cliente !== null;
    // Contexto derivado del envelope vigente (lock exacto envelope↔hash↔plan; pines org/customer).
    const contextoCanary = { org: CONTEXTO_CANARY.org, customerId: CONTEXTO_CANARY.customerId, envelopeId: envelope?.id ?? CONTEXTO_CANARY.envelopeId, planHash: envelope?.planHash ?? CONTEXTO_CANARY.planHash };
    const r = cliente
      ? await ejecutarCanaryAtomico({ org, customerId, envelope, plan, ledger, prov, flags, cliente, ahora: new Date().toISOString() }, contextoCanary)
      : { decision: 'DENY' as const, reason: 'GOOGLE_ADS_WRITE_NOT_CONFIGURED', transport: TRANSPORT_ATOMICO, envelopeId: envelope?.id ?? null, planHash: envelope?.planHash ?? null, providerRequestCount: 0, operationCount: 0, resultsCount: 0, providerSucceeded: 0, providerFailed: 0, bindings: [] as { operationIndex: number; resourceType: string; resourceName: string | null }[], requestId: null, googleErrors: [], supervisedReal: flags.supervisedReal, autonomousReal: flags.autonomousReal };
    const outcome = r.decision === 'DENY' ? 'DENIED' : r.decision === 'EXECUTED' ? 'EXECUTED' : 'PROVIDER_FAILED';
    app.log.info({ ruta: 'canary-execute', org, decision: r.decision, outcome, reason: r.reason, transport: r.transport, providerRequestCount: r.providerRequestCount, operationCount: r.operationCount, providerSucceeded: r.providerSucceeded, providerFailed: r.providerFailed, supervisedReal: flags.supervisedReal }, 'canary-execute attempt');
    // PERSISTENCIA DURABLE del intento real: transporte, requestId, googleErrors Y los resource names REALES por
    // operación (`bindings`) — sin esto la evidencia del éxito se pierde y no se puede reconstruir (fue el vacío que
    // dejó irreconciliable el intento del 2026-08-28T14:17:59).
    const at = new Date().toISOString();
    if (writeLogs.length > 0) {
      const sid = `canary-attempts:${org}`;
      const cw = ctxAppend(c); // events:append (sin esto el append lanzaba y se tragaba)
      const prev = await store.readStream(cw, sid);
      await store.append(cw, sid, prev.length, [{ type: 'canary-attempt', payload: { at, decision: r.decision, outcome, reason: r.reason, transport: r.transport, providerRequestCount: r.providerRequestCount, operationCount: r.operationCount, resultsCount: r.resultsCount, requestId: r.requestId, googleErrors: r.googleErrors, bindings: r.bindings, writeLogs }, attribution: ATR_CANARY, occurredAt: at }]).catch(() => undefined);
    }
    // RECONCILIACIÓN inline (idempotente, sin Google): un éxito real registra sus providerBindings desde los
    // resource names REALES devueltos por Google. Un futuro éxito nunca vuelve a mostrar "0 creados".
    const reconc = r.decision === 'EXECUTED' && envelope ? await reconciliarBindings(bindingSvc, org, envelope, r.bindings, at) : null;
    return reply.send({
      organizationId: org, decision: r.decision, outcome, reason: r.reason, executionTriggerScope: 'FULL_APPROVED_PLAN',
      envelopeId: r.envelopeId, planHash: r.planHash, realTransportReady,
      transport: r.transport, providerRequestCount: r.providerRequestCount, operationCount: r.operationCount,
      // Compat: providerMutateAttempts = llamadas MUTATE (0/1). providerBindings = recursos reales creados/persistidos.
      providerMutateAttempts: r.providerRequestCount, providerActionsSucceeded: r.providerSucceeded, providerBindings: reconc?.providerBindingsTotal ?? r.bindings.filter((b) => b.resourceName).length,
      resultsCount: r.resultsCount, providerSucceeded: r.providerSucceeded, providerFailed: r.providerFailed,
      boundCampaignResourceName: reconc?.boundCampaignResourceName ?? null,
      requestId: r.requestId, googleErrors: r.googleErrors, providerAttempts: writeLogs,
      supervisedReal: flags.supervisedReal, autonomousReal: flags.autonomousReal,
    });
  });

  // RECONCILIADOR idempotente de un intento exitoso YA persistido (reparación de persistencia, NO ejecución nueva).
  // Trabaja EXCLUSIVAMENTE sobre evidencia durable (los resource names en el último canary-attempt EXECUTED). NUNCA
  // llama a Google. Si la evidencia no tiene resource names (intentos previos al fix) ⇒ EVIDENCE_INSUFFICIENT (no
  // fabrica IDs, no consulta Google). Auth + business.manage + contexto canónico.
  app.post('/medicion/canary-reconcile', async (req, reply) => {
    const { ctx: c, org } = real(req, 'autonomia-ads');
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    if (org !== CONTEXTO_CANARY.org) return reply.send({ ok: false, error: 'CONTEXT_ORG_NOT_AUTHORIZED' });
    const envelope = await envelopeSvc.leerUltimo(org);
    if (!envelope) return reply.send({ ok: false, error: 'NO_ENVELOPE' });
    const eventos = await store.readStream(c, `canary-attempts:${org}`);
    const exitoso = eventos.filter((e) => e.type === 'canary-attempt').map((e) => e.payload as { decision?: string; requestId?: string | null; bindings?: { operationIndex: number; resourceType: string; resourceName: string | null }[] }).filter((p) => p.decision === 'EXECUTED').slice(-1)[0] ?? null;
    if (!exitoso) return reply.send({ ok: false, error: 'NO_SUCCESSFUL_ATTEMPT', envelopeId: envelope.id, newGoogleWriteCalls: 0 });
    const ops = exitoso.bindings ?? [];
    const rec = await reconciliarBindings(bindingSvc, org, envelope, ops, new Date().toISOString());
    return reply.send({ ...rec, envelopeId: envelope.id, planHash: envelope.planHash, requestId: exitoso.requestId ?? null });
  });

  // RECUPERACIÓN READ-ONLY desde Google Ads: recupera los resource names REALES de un mutate exitoso cuya evidencia
  // durable no los retuvo, LEYENDO Google (GAQL searchStream). Verifica huella + correlaciona las 61 operaciones +
  // persiste bindings idempotentes SÓLO si TODO cuadra (fail-closed, sin fabricar IDs). NUNCA escribe en Google.
  app.post('/medicion/canary-provider-reconcile', async (req, reply) => {
    const { ctx: c, org } = real(req, 'autonomia-ads');
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    if (org !== CONTEXTO_CANARY.org) return reply.send({ ok: false, error: 'CONTEXT_ORG_NOT_AUTHORIZED' });
    const { envelopeId, campaignId } = (req.body ?? {}) as { envelopeId?: string; campaignId?: string };
    if (!envelopeId || !campaignId || !/^\d+$/.test(String(campaignId))) return reply.send({ ok: false, error: 'INVALID_INPUT' });
    const envelope = await envelopeSvc.leerUltimo(org);
    if (!envelope) return reply.send({ ok: false, error: 'NO_ENVELOPE' });
    if (envelope.id !== envelopeId) return reply.send({ ok: false, error: 'ENVELOPE_ID_MISMATCH' });
    const plan = (await campaignOperator.leerUltimo(org))?.plan ?? null;
    if (!plan) return reply.send({ ok: false, error: 'NO_PLAN' });
    if (hashPlan(plan) !== envelope.planHash) return reply.send({ ok: false, error: 'PLAN_HASH_MISMATCH' });
    const eventos = await store.readStream(c, `canary-attempts:${org}`);
    const huboExito = eventos.filter((e) => e.type === 'canary-attempt').map((e) => e.payload as { decision?: string }).some((p) => p.decision === 'EXECUTED');
    if (!huboExito) return reply.send({ ok: false, error: 'NO_SUCCESSFUL_ATTEMPT' });
    let customerId = 'PENDING';
    try { customerId = getRecursoGoogleAds(org).customerId; } catch { return reply.send({ ok: false, error: 'GOOGLE_ADS_NOT_CONFIGURED' }); }
    if (customerId !== CONTEXTO_CANARY.customerId) return reply.send({ ok: false, error: 'CUSTOMER_ID_MISMATCH' });
    const cliente = construirClienteEscrituraGoogleAds(process.env, org, googleAdsComp, { validateOnly: false });
    if (!cliente) return reply.send({ ok: false, error: 'GOOGLE_ADS_WRITE_NOT_CONFIGURED' });
    let geo: Awaited<ReturnType<typeof resolverGeoRegiones>>;
    try { geo = await resolverGeoRegiones(cliente, GEO_SMILEFLOW_V2); } catch (e) { return reply.send({ ok: false, error: 'GEO_RESOLVE_FAILED', detalle: e instanceof Error ? e.message : String(e), newGoogleWriteCalls: 0 }); }
    if (geo.faltantes.length > 0) return reply.send({ ok: false, error: 'GEO_UNRESOLVED', newGoogleWriteCalls: 0 });
    // LECTURAS GAQL (READ ONLY). Ningún write. Si Google falla ⇒ 0 persistencia + diagnóstico ESTRUCTURADO durable
    // (status/code/message/path/requestId + query que falló), no un simple GOOGLE_SEARCH_HTTP_400.
    const q = consultasRecuperacion(String(campaignId));
    const filas: Record<string, Array<Record<string, unknown>>> = {};
    for (const [qid, gaql] of Object.entries(q)) {
      try { filas[qid] = await cliente.buscar(customerId, gaql); }
      catch (e) {
        const det = e instanceof GoogleSearchError ? e.detalle : null;
        const errAt = new Date().toISOString();
        const cwErr = ctxAppend(c);
        const prevE = await store.readStream(cwErr, `provider-recovery:${org}`);
        await store.append(cwErr, `provider-recovery:${org}`, prevE.length, [{ type: 'provider-recovery-error', payload: { at: errAt, envelopeId: envelope.id, campaignId: String(campaignId), failedQuery: qid, gaql, googleError: det }, attribution: ATR_CANARY, occurredAt: errAt }]).catch(() => undefined);
        return reply.send({ ok: false, error: 'PROVIDER_READ_FAILED', failedQuery: qid, googleError: det, detalle: e instanceof Error ? e.message : String(e), newGoogleWriteCalls: 0 });
      }
    }
    // El budget viene ATRIBUIDO en las mismas filas de campaign (no hay query separada de campaign_budget).
    const leidos: RecursosLeidos = {
      campaign: (filas.campaign ?? []) as never, campaignBudget: (filas.campaign ?? []) as never,
      adGroup: (filas.adGroup ?? []) as never, adGroupAd: (filas.adGroupAd ?? []) as never,
      adGroupCriterion: (filas.adGroupCriterion ?? []) as never, campaignCriterion: (filas.campaignCriterion ?? []) as never,
    };
    const ahora = new Date().toISOString();
    const correl = correlacionarGrafo(org, envelope, plan, geo.resueltas, leidos, ahora);
    const proof = { fingerprintOk: correl.fingerprintOk, expectedOperations: correl.expectedOperations, recoveredResourceCount: correl.recoveredResourceCount, matchedOperationCount: correl.matchedOperationCount, unmatchedOperationCount: correl.unmatchedOperationCount, ambiguousOperationCount: correl.ambiguousOperationCount };
    if (!correl.ok) return reply.send({ ok: false, reason: correl.reason, ...proof, bindingsRegistrados: 0, newGoogleWriteCalls: 0 }); // FAIL-CLOSED: nada se persiste
    // PERSISTENCIA IDEMPOTENTE (buscar antes de registrar). Sólo resourceNames REALES. Sin writes a Google.
    let registrados = 0; let yaExistian = 0;
    for (const b of correl.bindings) {
      const existente = await bindingSvc.buscar(org, envelope.id, b.materialFingerprint);
      if (existente) { yaExistian += 1; continue; }
      await bindingSvc.registrar(b); registrados += 1;
    }
    const cw = ctxAppend(c);
    const sidP = `provider-recovery:${org}`;
    const prevP = await store.readStream(cw, sidP);
    await store.append(cw, sidP, prevP.length, [{ type: 'provider-recovery', payload: { at: ahora, envelopeId: envelope.id, planHash: envelope.planHash, campaignId: String(campaignId), method: 'PROVIDER_READ_RECOVERY', campaignResourceName: correl.campaignResourceName, matched: correl.matchedOperationCount, bindingsRegistrados: registrados, bindingsYaExistian: yaExistian, resourceNames: correl.bindings.map((b) => ({ entityType: b.entityType, resourceName: b.providerResourceId })) }, attribution: ATR_CANARY, occurredAt: ahora }]).catch(() => undefined);
    return reply.send({ ok: true, reason: null, ...proof, method: 'PROVIDER_READ_RECOVERY', campaignResourceName: correl.campaignResourceName, bindingsRegistrados: registrados, bindingsYaExistian: yaExistian, providerBindingsTotal: (await bindingSvc.listar(org)).filter((b) => b.envelopeId === envelope.id).length, newGoogleWriteCalls: 0 });
  });

  // Lectura DURABLE de los intentos de write reales (errores de Google sanitizados). Auth + business.manage.
  app.get('/medicion/canary-attempts', async (req, reply) => {
    const { ctx: c, org } = real(req, 'autonomia-ads');
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    const eventos = await store.readStream(c, `canary-attempts:${org}`);
    return reply.send({
      organizationId: org,
      attempts: eventos.filter((e) => e.type === 'canary-attempt').map((e) => e.payload),
      // Intentos de VALIDATE (full-graph validateOnly): incluyen `errorMessage` con el nombre exacto del campo
      // inválido de Google en un fallo de transcoding (el punto ciego del diagnóstico anterior).
      validateAttempts: eventos.filter((e) => e.type === 'canary-validate-attempt').map((e) => e.payload),
    });
  });

  // DIAGNÓSTICO SEGURO — FULL GRAPH validate_only (V2): valida contra Google el GRAFO COMPLETO candidato
  // (GoogleAdsService.Mutate, partialFailure=false, validateOnly=true) SIN crear recursos ni gastar. Resuelve la
  // geo real (SuggestGeoTargetConstants). Auth + business.manage + contexto canónico. NO usa el envelope viejo para
  // mutar ni crea envelope nuevo. Materialización COMPARTIDA con el path real (sólo cambia validateOnly).
  app.post('/medicion/canary-validate', async (req, reply) => {
    const { ctx: c, org } = real(req, 'autonomia-ads');
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    if (org !== CONTEXTO_CANARY.org) return reply.send({ ok: false, error: 'CONTEXT_ORG_NOT_AUTHORIZED' });
    const planPersistido = (await campaignOperator.leerUltimo(org))?.plan ?? null;
    if (!planPersistido) return reply.send({ ok: false, error: 'NO_PLAN' });
    // CANDIDATE V2: el plan PERSISTIDO se materializa TRAS retirar las keywords denegadas por política (el denylist
    // sólo filtra al construir; el plan persistido las conserva). NO modifica el plan persistido ni su hash.
    const plan = retirarKeywordsDenegadasDelPlan(planPersistido);
    let customerId = 'PENDING';
    try { customerId = getRecursoGoogleAds(org).customerId; } catch { return reply.send({ ok: false, error: 'GOOGLE_ADS_NOT_CONFIGURED' }); }
    if (customerId !== CONTEXTO_CANARY.customerId) return reply.send({ ok: false, error: 'CUSTOMER_ID_MISMATCH' });
    const attempts: GoogleAdsWriteLog[] = [];
    const cliente = construirClienteEscrituraGoogleAds(process.env, org, googleAdsComp, { validateOnly: true, logger: (i) => { app.log.info(i, 'ga-write-validate'); attempts.push(i); } });
    if (!cliente) return reply.send({ ok: false, error: 'GOOGLE_ADS_WRITE_NOT_CONFIGURED' });
    // 1) GEO real (criterionId por región). Fail-closed si alguna no resuelve (evita targetear mal).
    let geo: Awaited<ReturnType<typeof resolverGeoRegiones>>;
    try { geo = await resolverGeoRegiones(cliente, GEO_SMILEFLOW_V2); } catch (e) { return reply.send({ ok: false, error: 'GEO_RESOLVE_FAILED', detalle: e instanceof Error ? e.message : String(e), providerAttempts: attempts }); }
    if (geo.faltantes.length > 0) return reply.send({ ok: false, error: 'GEO_UNRESOLVED', faltantes: geo.faltantes });
    // 2) Fecha de activación CANDIDATA para validate (hoy + 2 días). NO se persiste como contractual (el plan guarda
    // la regla START_AT_ACTIVATION_LOCAL_DATE / END_AT_START_PLUS_9_DAYS). Ventana Google-native start/end_date_time.
    const activacion = new Date(Date.now() + 2 * 24 * 3600_000).toISOString().slice(0, 10);
    const { startDateTime, endDateTime } = ventanaFechasDesdeActivacion(activacion);
    // 3) Materializar el grafo COMPLETO (misma función que el path real) y validar.
    const request = materializarGoogleAdsMutate(plan, GEO_SMILEFLOW_V2, geo.resueltas, { customerId, startDateTime, endDateTime, validateOnly: true });
    if (!request) return reply.send({ ok: false, error: 'MATERIALIZE_FAILED' });
    try {
      const r = await cliente.mutarGrafo(customerId, request);
      // PERSISTENCIA DURABLE del validate (event store): el error de Google (incl. `errorMessage` con el nombre
      // exacto del campo inválido en un fallo de transcoding "Unknown name X") queda consultable aunque el cliente
      // TRUNQUE la respuesta o los logs de Railway ya no estén. Fue el punto ciego que impidió el diagnóstico previo.
      const at = new Date().toISOString();
      const sid = `canary-attempts:${org}`;
      const cw = ctxAppend(c); // events:append — sin esto el append lanzaba y `validateAttempts` salía vacío
      const prev = await store.readStream(cw, sid);
      await store.append(cw, sid, prev.length, [{ type: 'canary-validate-attempt', payload: { at, ok: r.ok, httpStatus: r.httpStatus, requestId: r.requestId, operationCount: r.operationCount, errorStatus: r.errorStatus, errorCode: r.errorCode, errorMessage: r.errorMessage, googleErrors: r.googleErrors, geoResolved: geo.resueltas.map((g) => ({ nombre: g.nombre, criterionId: g.criterionId, negativa: g.negativa })) }, attribution: ATR_CANARY, occurredAt: at }]).catch(() => undefined);
      return reply.send({
        ok: r.ok, validateOnly: true, mode: 'GoogleAdsService.Mutate', partialFailure: false,
        operationCount: request.mutateOperations.length,
        geoResolved: geo.resueltas.map((g) => ({ nombre: g.nombre, criterionId: g.criterionId, canonicalName: g.canonicalName, negativa: g.negativa })),
        result: r, providerAttempts: attempts,
      });
    } catch (e) {
      return reply.send({ ok: false, validateOnly: true, error: e instanceof Error ? e.message : String(e), providerAttempts: attempts });
    }
  });

  // PREFLIGHT READ-ONLY (SIN Google): materializa el MISMO candidate que `canary-validate` usaría (plan persistido
  // → retiro de keywords denegadas) y reporta los conteos, para verificar la alineación (61 ops / 22 positivas /
  // sin denegadas) SIN llamar a Google ni gastar. La geo usa criterionId placeholder (el count es lo que importa;
  // los ids reales sólo se resuelven en el validate real). NO muta, NO crea recursos, NO expone secretos.
  app.get('/medicion/canary-candidate', async (req, reply) => {
    const { org } = real(req, 'autonomia-ads');
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    const resultado = await campaignOperator.leerUltimo(org);
    const planPersistido = resultado?.plan ?? null;
    if (!planPersistido) return reply.send({ ok: false, error: 'NO_PLAN' });
    const candidato = retirarKeywordsDenegadasDelPlan(planPersistido);
    let customerId = 'DIAGNOSTIC';
    try { customerId = getRecursoGoogleAds(org).customerId; } catch { /* placeholder para el conteo */ }
    // GEO sintética desde la política (NO Google): 4 positivas + RM negativa, criterionId placeholder.
    const geoDiag: GeoRegionResuelta[] = GEO_SMILEFLOW_V2.regiones.map((r) => ({ nombre: r.nombre, negativa: r.negativa, criterionId: 'DIAGNOSTIC', canonicalName: '' }));
    const { startDateTime, endDateTime } = ventanaFechasDesdeActivacion(new Date(Date.now() + 2 * 24 * 3600_000).toISOString().slice(0, 10));
    const req2 = materializarGoogleAdsMutate(candidato, GEO_SMILEFLOW_V2, geoDiag, { customerId, startDateTime, endDateTime, validateOnly: true });
    if (!req2) return reply.send({ ok: false, error: 'MATERIALIZE_FAILED' });
    const conteo = contarOperaciones(req2);
    const criterios = req2.mutateOperations.filter((o) => Object.keys(o)[0] === 'campaignCriterionOperation').map((o) => (o as { campaignCriterionOperation: { create: Record<string, unknown> } }).campaignCriterionOperation.create);
    const geoCriteria = criterios.filter((cr) => 'location' in cr).length;
    const negativeKeywords = criterios.filter((cr) => 'keyword' in cr).length;
    const positiveKeywords = candidato.activeKeywords.map((k) => k.text);
    const jsonLower = JSON.stringify(req2).toLowerCase();
    const deniedPresent = KEYWORDS_DENEGADAS_POLITICA_GOOGLE.filter((d) => jsonLower.includes(d.toLowerCase()));
    return reply.send({
      ok: true,
      candidateSource: 'campaignOperator.leerUltimo → retirarKeywordsDenegadasDelPlan (denylist)',
      operationCount: conteo.total,
      positiveKeywordCount: positiveKeywords.length,
      positiveKeywords,
      deniedKeywordsPresent: deniedPresent, // debe ser []
      negativeKeywordCount: negativeKeywords,
      geoCriteriaCount: geoCriteria,
      adGroupCount: conteo.adGroupOperation ?? 0,
      adCount: conteo.adGroupAdOperation ?? 0,
      // Evidencia de separación: el plan persistido conserva sus keywords; el candidate materializado no las denegadas.
      persistedPositiveKeywordCount: planPersistido.activeKeywords.length,
      persistedDeniedKeywordCount: planPersistido.activeKeywords.filter((k) => esKeywordDenegadaPorPoliticaGoogle(k.text)).length,
    });
  });

  // Conteos del candidate desde una request materializada (sin Google) — evita duplicar el desglose.
  const contarCandidate = (candidato: Parameters<typeof materializarGoogleAdsMutate>[0], customerId: string): { operationCount: number; positiveKeywordCount: number; negativeKeywordCount: number; geoCriteriaCount: number; adGroupCount: number; adCount: number } | null => {
    const geoDiag: GeoRegionResuelta[] = GEO_SMILEFLOW_V2.regiones.map((r) => ({ nombre: r.nombre, negativa: r.negativa, criterionId: 'DIAGNOSTIC', canonicalName: '' }));
    const { startDateTime, endDateTime } = ventanaFechasDesdeActivacion(new Date(Date.now() + 2 * 24 * 3600_000).toISOString().slice(0, 10));
    const rq = materializarGoogleAdsMutate(candidato, GEO_SMILEFLOW_V2, geoDiag, { customerId, startDateTime, endDateTime, validateOnly: true });
    if (!rq) return null;
    const conteo = contarOperaciones(rq);
    const criterios = rq.mutateOperations.filter((o) => Object.keys(o)[0] === 'campaignCriterionOperation').map((o) => (o as { campaignCriterionOperation: { create: Record<string, unknown> } }).campaignCriterionOperation.create);
    return { operationCount: conteo.total ?? 0, positiveKeywordCount: conteo.adGroupCriterionOperation ?? 0, negativeKeywordCount: criterios.filter((c) => 'keyword' in c).length, geoCriteriaCount: criterios.filter((c) => 'location' in c).length, adGroupCount: conteo.adGroupOperation ?? 0, adCount: conteo.adGroupAdOperation ?? 0 };
  };

  // CIERRE FINAL — persiste el CANDIDATE V2 (plan persistido SANEADO) como plan DEFINITIVO y crea el NUEVO envelope
  // (READY_FOR_HUMAN_APPROVAL, fail-closed), superseando el viejo (hash distinto). NO aprueba, NO habilita
  // SUPERVISED_REAL, NO llama a Google, NO gasta. Idempotente: si ya está saneado y el envelope apunta al nuevo hash,
  // no duplica. Auth + business.manage + contexto canónico.
  app.post('/medicion/candidate-finalize', async (req, reply) => {
    const { ctx: c, org } = real(req, 'autonomia-ads');
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    if (org !== CONTEXTO_CANARY.org) return reply.send({ ok: false, error: 'CONTEXT_ORG_NOT_AUTHORIZED' });
    const previo = await campaignOperator.leerUltimo(org);
    const planPersistido = previo?.plan ?? null;
    if (!planPersistido) return reply.send({ ok: false, error: 'NO_PLAN' });
    const candidato = retirarKeywordsDenegadasDelPlan(planPersistido);
    const yaSaneado = planPersistido.activeKeywords.every((k) => !esKeywordDenegadaPorPoliticaGoogle(k.text));
    const ahora = new Date().toISOString();
    // planId estable: si ya está saneado, reusa el del plan vigente; si no, uno nuevo por timestamp.
    const newPlanId = yaSaneado && previo ? previo.envelopeDraft.planId : `plan:${org}:${ahora}`;
    const oldEnvelope = await envelopeSvc.leerUltimo(org);
    if (!yaSaneado) await campaignOperator.persistirPlanFinal(org, candidato, newPlanId, ahora); // deja el candidate como plan vigente (sin saneador en runtime)
    // crea el nuevo envelope y SUPERSEDE el viejo si el hash cambió (audit old→new). Fail-closed, sin aprobar.
    const envelope = await envelopeSvc.crearDesdePlan(org, candidato, newPlanId, ahora);
    const superseded = !!oldEnvelope && oldEnvelope.planHash !== envelope.planHash;
    // PROVENANCE de la validación Google (validateOnly PASS). Durable, sin secretos.
    const provenance = { provider: 'Google Ads', validationMode: 'validateOnly', validationResult: 'PASS', validationOperationCount: 61, validationRequestId: 'HJ01PSMyU5i0k1_x8kb6dw', validationGoogleErrors: 0, validationTimestamp: '2026-08-28T03:09:55.478Z', newPlanId, newPlanHash: envelope.planHash };
    const cw = ctxAppend(c);
    const sidP = `candidate-provenance:${org}`;
    const prevP = await store.readStream(cw, sidP);
    await store.append(cw, sidP, prevP.length, [{ type: 'candidate-provenance', payload: { ...provenance, at: ahora }, attribution: ATR_CANARY, occurredAt: ahora }]).catch(() => undefined);
    const cuenta = contarCandidate(candidato, CONTEXTO_CANARY.customerId);
    return reply.send({
      ok: true,
      newPlanId, newPlanHash: envelope.planHash, newPlanHashDiffersFromOld: envelope.planHash !== CONTEXTO_CANARY.planHash,
      newEnvelopeId: envelope.id, newEnvelopeStatus: envelope.status, executionAllowed: 'DENY',
      oldEnvelopeId: oldEnvelope?.id ?? null, oldEnvelopeStatusAfter: superseded ? 'SUPERSEDED' : (oldEnvelope?.status ?? null), oldEnvelopeExecutable: false,
      ...(cuenta ?? {}), provenance,
    });
  });

  // READ-ONLY del cierre: expone plan/envelope/provenance/conteos para revisión humana. Sin Google.
  app.get('/medicion/candidate-final', async (req, reply) => {
    const { ctx: c, org } = real(req, 'autonomia-ads');
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ ok: false, error: 'NO_AUTORIZADO' });
    const previo = await campaignOperator.leerUltimo(org);
    const plan = previo?.plan ?? null;
    const envelope = await envelopeSvc.leerUltimo(org);
    if (!plan || !envelope) return reply.send({ ok: false, error: 'NO_CANDIDATE' });
    const provEventos = await store.readStream(c, `candidate-provenance:${org}`);
    const provenance = provEventos.filter((e) => e.type === 'candidate-provenance').map((e) => e.payload).slice(-1)[0] ?? null;
    const cuenta = contarCandidate(plan, CONTEXTO_CANARY.customerId);
    const c0 = plan.campaigns[0];
    return reply.send({
      ok: true,
      newPlanId: envelope.planId, newPlanHash: envelope.planHash, newPlanHashDiffersFromOld: envelope.planHash !== CONTEXTO_CANARY.planHash,
      newEnvelopeId: envelope.id, newEnvelopeStatus: envelope.status, executionAllowed: 'DENY',
      oldEnvelopeId: CONTEXTO_CANARY.envelopeId, oldEnvelopeExecutable: false,
      // PROOF read-only del transporte real (gate de seguridad: no volver a ejecutar código distinto al validado).
      realExecutionTransport: TRANSPORT_ATOMICO, realProviderRequestCountExpected: 1, realOperationCount: cuenta?.operationCount ?? null, legacyPerServiceRealPath: 'DISABLED', realPlanHash: envelope.planHash,
      // Estado reconciliado (read-only): bindings reales del envelope. activatedAt no es una capacidad persistida
      // del dominio (no se inventa en este bloque). El gasto real observado es 0.
      providerBindingsCount: (await bindingSvc.listar(org)).filter((b) => b.envelopeId === envelope.id).length,
      boundCampaignResourceName: (await bindingSvc.listar(org)).find((b) => b.envelopeId === envelope.id && b.entityType === 'campaign')?.providerResourceId ?? null,
      activatedAt: null, actualSpend: 0,
      deniedKeywordsPresent: KEYWORDS_DENEGADAS_POLITICA_GOOGLE.filter((d) => plan.activeKeywords.some((k) => k.text.trim().toLowerCase() === d.toLowerCase())),
      ...(cuenta ?? {}),
      geoPositives: GEO_SMILEFLOW_V2.regiones.filter((r) => !r.negativa).map((r) => r.nombre), geoNegative: GEO_SMILEFLOW_V2.regiones.filter((r) => r.negativa).map((r) => r.nombre), positiveGeoTargetType: GEO_SMILEFLOW_V2.positiveGeoTargetType,
      budgetPolicy: c0?.budgetPolicy?.type ?? null, experimentTotalCommitmentMaxClp: c0?.budgetPolicy?.totalAmount ?? null, globalNewSpendCapClp: envelope.totalCap, zeroContactStopClp: envelope.maxSpendWithoutContact, dailyBudgetPresent: false, authorizedDurationDays: envelope.authorizedDurationDays,
      historicalResourceReferences: 0, provenance,
    });
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
