import { makePool, PgEventStore, runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { metaOAuthMigrations } from './acquisition/meta-oauth-pg';
import { metaSyncMigrations } from './acquisition/meta-sync-pg';
import { accionMigrations } from './accion/accion-pg';
import { autonomiaMigrations } from './autonomia/autonomia-pg';
import { metaWriteMigrations } from './campana/meta-write-pg';
import { dataDeletionMigrations } from './acquisition/meta-data-deletion';
import { crearComposicionMetaOAuth } from './acquisition/meta-runtime';
import { iniciarMetaScheduler, INTERVALO_SCHEDULER_MS } from './acquisition/meta-scheduler';
import { randomUUID } from 'node:crypto';
import { runGoogleAdsMigrationsSeguro, PgGoogleAdsSyncLease } from './acquisition/google-ads-oauth-pg';
import { budgetAuthorizationMigrations } from './autonomia-ads/budget-authorization-pg';
import { crearComposicionGoogleAdsOAuth } from './acquisition/google-ads-runtime-oauth';
import { GoogleAdsScheduler } from './ingesta/google-ads-scheduler';
import { StopMonitorService, iniciarStopMonitor } from './campana/stop-monitor';
import { crearDepsStopMonitor, construirLectorMetricasCampania } from './campana/stop-monitor-composition';
import { construirAdapterPausaGoogleAds, construirClienteEscrituraGoogleAds } from './campana/google-ads-write-runtime';
import { EnvelopeService } from './campana/envelope-service';
import { ResourceBindingService } from './campana/resource-binding';
import { DiagnosisEvidenceService } from './campana/diagnosis-evidence-service';
import { fechaCalendario } from './campana/campaign-live';
import { DirectorCycleService, iniciarDirectorCycle } from './autonomia-ads/director-cycle';
import { DecisionService } from './autonomia-ads/decision-service';
import { ejecutarBootstrap } from '@soec/identity';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { jobHealthMigrations, PgRepositorioSaludJobs, type NombreJob } from './operacion/job-health-pg';
import { negocioMigrations, RepositorioNegocios } from './negocio/negocio-pg';
import { migrarNegociosDelRegistro } from './negocio/migracion-registro';
import { crearDescubridorDeNegocios } from './negocio/descubrimiento';
import { iniciarIngestaServidor, planDeIngesta, sincronizarSaludDelPlan } from './ingesta/ingesta-runtime';
import { conexionMigrations } from './conexion/conexion-pg';
import { migrarConexionesDelRegistro } from './conexion/migracion-conexiones';
import { crearDepositoSecretosConexion, crearAlmacenDeLecturaDeSecretos } from './conexion/secreto-conexion';
import { crearDescubridorPorCapacidad, crearElegiblesPorCapacidad, iniciarRefrescoDeNegocios, refrescarNegociosDelRuntime } from './conexion/snapshot';
import { politicaMigrations } from './politica/politica-pg';
import { onboardingMigrations } from './onboarding/onboarding-pg';
import { investigacionMigrations } from './investigacion/investigacion-pg';
import { planMigrations } from './investigacion/plan-pg';
import { ejecucionMigrations } from './ejecucion/ejecucion-pg';
import { optimizacionMigrations } from './optimizacion/optimizacion-pg';
import { migrarPoliticasDelRegistro } from './politica/migracion-politica';
import { PoliticaService } from './politica/politica-service';
import { estadoKillSwitch, crearEvaluadorPausaSeguridad } from './gobierno';
import { buildApp } from './app';

/**
 * Arranque de la API con postura de seguridad explícita:
 *  - SOEC_AUTH_REQUIRED (default true): en producción, obligatorio.
 *  - SOEC_LEGACY_DEMO_ACCESS_ENABLED (default false): re-registra la demo sin auth SOLO en
 *    test/dev; en producción el arranque FALLA si se intenta habilitar.
 * La ausencia de sesión NUNCA es autorización.
 */
const esProduccion = (process.env.NODE_ENV ?? process.env.SOEC_ENV) === 'production';
const authRequired = (process.env.SOEC_AUTH_REQUIRED ?? 'true') === 'true';
const legacyDemoAccess = process.env.SOEC_LEGACY_DEMO_ACCESS_ENABLED === 'true';

// Orígenes permitidos para operaciones mutativas (CSRF, F-01). En producción DEBE ser una lista
// explícita; en dev se asume el front local. NUNCA se deriva del request.
const allowedOrigins = (process.env.SOEC_ALLOWED_ORIGINS ?? (esProduccion ? '' : 'http://localhost:3080,http://localhost:3000'))
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Rate limiting (F-06): configurable por entorno; defaults razonables para una sola instancia.
const rateLimit = {
  loginMax: Number(process.env.SOEC_RL_LOGIN_MAX ?? 5),
  ipMax: Number(process.env.SOEC_RL_IP_MAX ?? 30),
  resetMax: Number(process.env.SOEC_RL_RESET_MAX ?? 5),
  windowMin: Number(process.env.SOEC_RL_WINDOW_MIN ?? 15),
};

if (esProduccion && legacyDemoAccess) {
  console.error('FATAL: SOEC_LEGACY_DEMO_ACCESS_ENABLED=true está PROHIBIDO en producción. Arranque abortado.');
  process.exit(1);
}
if (esProduccion && !authRequired) {
  console.error('FATAL: SOEC_AUTH_REQUIRED debe ser true en producción. Arranque abortado.');
  process.exit(1);
}
if (esProduccion && allowedOrigins.length === 0) {
  console.error('FATAL: SOEC_ALLOWED_ORIGINS debe declarar al menos un origen en producción (protección CSRF). Arranque abortado.');
  process.exit(1);
}
if (legacyDemoAccess) {
  console.warn('ADVERTENCIA: acceso DEMO LEGACY habilitado (rutas /experience/* SIN autenticacion). Solo test/dev/demo. NO usar con datos u organizaciones reales.');
}

/**
 * ESCALONAMIENTO DEL ARRANQUE (camino de ANALÍTICA).
 *
 * Al arrancar, tres componentes leían Google Ads en el mismo segundo: el scheduler de ingesta (3 consultas),
 * la sonda de fechas (1) y el ciclo del director (hasta 7). Once consultas en menos de un segundo agotan el
 * límite de ráfaga del proveedor: cada arranque devolvía un 429, con la lectura recuperándose sola después.
 * Aquí cada uno arranca en su propio momento, con un desfase pequeño y algo de jitter para que dos réplicas
 * no coincidan. No cambia ninguna cadencia periódica ni se aumenta ninguna cuota.
 *
 * El camino de SEGURIDAD (stop monitor) NO se escalona ni se retrasa: su primera evaluación sigue cayendo en
 * su cadencia de 5 min y puede pausar en cuanto una regla dispare. Proteger el dinero manda sobre ahorrar
 * llamadas.
 */
const jitter = (ms: number): number => Math.floor(ms * (0.8 + Math.random() * 0.4));
const RETRASO_SCHEDULER_ADS_MS = jitter(20_000);
const RETRASO_SONDA_FECHAS_MS = jitter(45_000);
const RETRASO_DIRECTOR_MS = jitter(75_000);

/** Cadencia de la ingesta server-side: 15 min, la misma que tenía la tarea externa que reemplaza. */
const INTERVALO_INGESTA_MS = 15 * 60_000;
/** Cadencia declarada del scheduler de Google Ads (para el read model de salud). */
const INTERVALO_INGESTA_ADS_MS = 3 * 60 * 60_000;
/** Cadencia de refresco del snapshot de negocios (conexiones y capacidades como dato). */
const INTERVALO_SNAPSHOT_MS = 60_000;

const pool = makePool();

async function main(): Promise<void> {
  await runMigrations(pool, identityMigrations); // asegura el esquema de identidad
  await runMigrations(pool, metaOAuthMigrations); // esquema de persistencia OAuth Meta (Parte 2)
  await runMigrations(pool, metaSyncMigrations); // esquema de sync read-only + observabilidad Meta
  await runMigrations(pool, accionMigrations); // Safe Action Plane (V2-A): mandatos + action ledger
  await runMigrations(pool, autonomiaMigrations); // V2-C: shadow runs (autonomía en sombra)
  await runMigrations(pool, metaWriteMigrations); // V2 pre-real: reconciliación del write path (dormante)
  await runMigrations(pool, dataDeletionMigrations); // Meta data deletion callback (App Review)
  await runGoogleAdsMigrationsSeguro(pool); // OAuth Google Ads multi-tenant (google_ads_*) bajo advisory lock (boot concurrente seguro)
  await runMigrations(pool, budgetAuthorizationMigrations); // P0: autorización de presupuesto TOTAL por humano (guardrail financiero)
  await runMigrations(pool, jobHealthMigrations); // Autonomy Fase 0: salud observable de los trabajos de fondo
  await runMigrations(pool, negocioMigrations); // Autonomy Fase A: el negocio como dato (SSOT en PostgreSQL)
  // Migración idempotente de los negocios que nacieron como módulos TypeScript. No crea organizaciones
  // nuevas ni regenera identidades: sólo persiste lo que ya existía, para que el runtime lea de la base.
  const migracionNegocios = await migrarNegociosDelRegistro(pool);
  console.log(JSON.stringify({ negociosComoDato: migracionNegocios }));
  await runMigrations(pool, conexionMigrations); // Autonomy Fase B: conexiones y capacidades como dato
  // Las conexiones y las capacidades que vivían en módulos TypeScript pasan a ser filas, sin cambiar lo que
  // hoy hace cada empresa y sin mover ningún secreto (se conserva la referencia `env:` tal cual).
  const migracionConexiones = await migrarConexionesDelRegistro(pool);
  console.log(JSON.stringify({ conexionesComoDato: migracionConexiones }));
  await runMigrations(pool, politicaMigrations); // Autonomy Fase C: la política de evaluación como dato
  // Se migra SÓLO lo que existe: SmileFlow completa, CP con su embudo (queda incompleta y lo dice), C Y P nada.
  const migracionPoliticas = await migrarPoliticasDelRegistro(pool);
  console.log(JSON.stringify({ politicaComoDato: migracionPoliticas }));
  await runMigrations(pool, onboardingMigrations); // Autonomy Fase D: asistente de incorporación
  await runMigrations(pool, investigacionMigrations); // Autonomy Fase E: investigación con evidencia
  await runMigrations(pool, planMigrations); // Autonomy Fase E: planes de campaña en borrador
  await runMigrations(pool, ejecucionMigrations); // Autonomy Fase F: peticiones de ejecución, conversiones y medición
  await runMigrations(pool, optimizacionMigrations); // Autonomy Fase G: ciclos, snapshots, decisiones y aprendizaje
  // No hay migración de datos: el asistente se apoya en lo que ya está persistido y precarga lo que SOEC
  // sabe. Una empresa histórica lo abre y encuentra sus respuestas puestas, no un formulario vacío.
  // PRIMER SNAPSHOT: desde aquí el runtime resuelve `organización → negocio / perfil / fuentes` contra la
  // BASE. Se fija ANTES de atender la primera petición para que ninguna resuelva con el registro histórico.
  const snapshotInicial = await refrescarNegociosDelRuntime(pool);
  console.log(JSON.stringify({ negociosDelRuntime: 'snapshot_inicial', organizaciones: snapshotInicial.organizaciones, detalle: snapshotInicial.detalle }));
  const boot = await ejecutarBootstrap(pool);
  if (boot.ejecutado) console.log(JSON.stringify({ bootstrap: boot }));

  const app = buildApp({
    store: new PgEventStore(pool),
    intelligence: new DeterministicIntelligenceProvider(),
    pool,
    legacyDemoAccess,
    secureCookies: esProduccion,
    allowedOrigins,
    rateLimit,
  });

  const port = Number(process.env.PORT ?? 3000);
  const addr = await app.listen({ port, host: '0.0.0.0' });
  console.log(JSON.stringify({ listening: addr, authRequired, legacyDemoAccess, produccion: esProduccion, allowedOrigins }));

  // ── GOBIERNO y SALUD del runtime autónomo ───────────────────────────────────────────────────
  // El kill switch se declara en el arranque para que el log diga qué postura tiene el despliegue.
  const ks = estadoKillSwitch(process.env);
  console.log(JSON.stringify({ externalMutationsAllowed: ks.mutacionesExternasHabilitadas, killSwitchDeclarado: ks.valorDeclarado }));
  const salud = new PgRepositorioSaludJobs(pool);
  /** Latido de un bucle: traduce su evento de log a un registro de salud consultable. */
  const latido = (job: NombreJob, org: string, intervaloMs: number) => (evento: unknown): void => {
    console.log(JSON.stringify(evento));
    const at = new Date().toISOString();
    const next = new Date(Date.parse(at) + intervaloMs).toISOString();
    const err = (evento as { error?: unknown } | null)?.error;
    const promesa = typeof err === 'string' && err.length > 0
      ? salud.marcarFallo(job, org, at, err, next)
      : salud.marcarExito(job, org, at, next);
    void promesa.catch(() => undefined); // la observabilidad nunca puede tumbar el bucle que observa
  };

  // REFRESCO del snapshot de negocios: una empresa creada y conectada desde la interfaz entra en operación
  // en el siguiente minuto, sin desplegar. Si la base falla, se conserva el snapshot vigente.
  iniciarRefrescoDeNegocios(pool, INTERVALO_SNAPSHOT_MS, (i) => console.log(JSON.stringify(i)));
  console.log(JSON.stringify({ negociosDelRuntime: 'refresco_iniciado', intervaloMs: INTERVALO_SNAPSHOT_MS }));

  // Scheduler autónomo READ-ONLY de sync Meta (freshness-aware, tenant-aware). Habilitado por defecto;
  // apagable con SOEC_META_SCHEDULER_ENABLED=false. Sólo arranca si Meta está configurado (composición != null).
  if (process.env.SOEC_META_SCHEDULER_ENABLED !== 'false') {
    const compSched = crearComposicionMetaOAuth(pool, process.env);
    if (compSched !== null) {
      iniciarMetaScheduler(
        { comp: compSched, scheduleRepo: compSched.scheduleRepo, ahora: () => new Date().toISOString() },
        INTERVALO_SCHEDULER_MS,
        (r) => latido('metaScheduler', '', INTERVALO_SCHEDULER_MS)({ metaScheduler: 'tick', ok: r.ok, ...(r.error ? { error: r.error } : {}) }),
      );
      console.log(JSON.stringify({ metaScheduler: 'started', intervaloMs: INTERVALO_SCHEDULER_MS }));
    } else {
      console.log(JSON.stringify({ metaScheduler: 'idle_no_meta_config' }));
      void salud.marcarDeshabilitado('metaScheduler', '', 'META_NOT_CONFIGURED').catch(() => undefined);
    }
  } else {
    void salud.marcarDeshabilitado('metaScheduler', '', 'SOEC_META_SCHEDULER_ENABLED=false').catch(() => undefined);
  }

  // Scheduler READ-ONLY multi-tenant de Google Ads. DORMIDO por defecto: sólo agenda si
  // GOOGLE_ADS_SCHEDULER_ENABLED=true (se activa recién tras la certificación + gate humano). In-proceso
  // (no Windows Task); aísla fallos por tenant. Sólo corre si Google Ads está configurado (composición != null).
  const habilitadoGoogleAds = process.env.GOOGLE_ADS_SCHEDULER_ENABLED === 'true';
  const compGoogleAds = crearComposicionGoogleAdsOAuth(pool, process.env);
  if (compGoogleAds !== null) {
    const scheduler = new GoogleAdsScheduler({
      store: new PgEventStore(pool),
      env: process.env,
      comp: compGoogleAds,
      connRepo: compGoogleAds.connRepo,
      lease: new PgGoogleAdsSyncLease(pool), // exclusión distribuida: dos réplicas no sincronizan la misma conexión
      holder: `${process.env.RAILWAY_REPLICA_ID ?? 'local'}:${randomUUID()}`,
      habilitado: habilitadoGoogleAds,
      retrasoInicialMs: RETRASO_SCHEDULER_ADS_MS, // escalonado: no comparte segundo con la sonda ni con el director
      ahora: () => new Date().toISOString(),
      log: (evento) => latido('googleAdsScheduler', '', INTERVALO_INGESTA_ADS_MS)({ googleAdsScheduler: evento, ...(typeof (evento as { error?: unknown }).error === 'string' ? { error: (evento as { error?: string }).error } : {}) }),
    });
    const { agendado } = scheduler.iniciar();
    console.log(JSON.stringify({ googleAdsScheduler: agendado ? 'started' : 'dormant_disabled', retrasoInicialMs: agendado ? RETRASO_SCHEDULER_ADS_MS : null }));
    if (!agendado) void salud.marcarDeshabilitado('googleAdsScheduler', '', 'GOOGLE_ADS_SCHEDULER_ENABLED != true').catch(() => undefined);
  } else {
    console.log(JSON.stringify({ googleAdsScheduler: 'idle_no_google_ads_config' }));
    void salud.marcarDeshabilitado('googleAdsScheduler', '', 'GOOGLE_ADS_NOT_CONFIGURED').catch(() => undefined);
  }

  // MONITOR AUTOMÁTICO de STOPS: conecta las reglas EXISTENTES (evaluarStopVigente) a un loop in-proceso. Activo por
  // defecto (apagable con SOEC_STOP_MONITOR_ENABLED=false). SIN capacidad de escritura a Google (0 provider writes):
  // evalúa y REGISTRA la decisión; su única acción es STOP_CAMPAIGN (reducción de riesgo). Con la campaña PAUSED ⇒
  // NOOP. Cadencia 5 min: protege un experimento de 15.000 CLP sin polling agresivo.
  if (process.env.SOEC_STOP_MONITOR_ENABLED !== 'false') {
    // A QUÉ NEGOCIOS protege: los que tienen la capacidad `MONITOR_SEGURIDAD` habilitada en la BASE. Ninguna
    // organización va fijada en código. Hoy la migración la habilitó sólo para quien ya tenía pausa automática
    // declarada, así que la cobertura es exactamente la de antes; mañana se amplía habilitándola, sin desplegar.
    const protegidos = await crearDescubridorPorCapacidad(pool, 'MONITOR_SEGURIDAD')();
    const repoNegocios = new RepositorioNegocios(pool);
    // El permiso para pausar sale de `business_governance` (la base), con el registro como respaldo.
    const evaluadorPausa = crearEvaluadorPausaSeguridad((org) => repoNegocios.gobierno(org), process.env);
    const intervaloMs = 5 * 60_000;
    if (protegidos.length === 0) {
      console.log(JSON.stringify({ stopMonitor: 'sin_negocios_con_capacidad', capacidad: 'MONITOR_SEGURIDAD' }));
      void salud.marcarDeshabilitado('stopMonitor', '', 'ningún negocio tiene la capacidad MONITOR_SEGURIDAD').catch(() => undefined);
    }
    for (const [i, org] of protegidos.entries()) {
      // El monitor recibe SÓLO el adapter PAUSE-ONLY (capacidad estructural = pausar; jamás crear/habilitar/editar) +
      // un lector de métricas READ-ONLY que consulta el spend/status de LA campaña del binding (no la histórica).
      const pauseAdapter = construirAdapterPausaGoogleAds(process.env, org, compGoogleAds, (info) => console.log(JSON.stringify({ stopMonitorPause: info })));
      const readClient = construirClienteEscrituraGoogleAds(process.env, org, compGoogleAds, {});
      const lectorMetricas = readClient ? construirLectorMetricasCampania((cid, q) => readClient.buscar(cid, q)) : null;
      const svc = new StopMonitorService(crearDepsStopMonitor(new PgEventStore(pool), pauseAdapter, lectorMetricas, evaluadorPausa));
      iniciarStopMonitor(svc, org, intervaloMs, latido('stopMonitor', org, intervaloMs));
      // SIN retraso inicial: es el camino de SEGURIDAD. Su primer tick cae a los 5 min, como siempre.
      console.log(JSON.stringify({ stopMonitor: 'started', intervaloMs, org, pauseWired: pauseAdapter !== null, metricsWired: lectorMetricas !== null, caminoSeguridad: true }));
      // SONDA DE FECHAS (READ-ONLY, boot): confirma que campaign.start_date/end_date (v25) se leen de LA campaña vigente.
      // Observabilidad honesta de la fuente de fechas; ninguna escritura, ningún efecto sobre la campaña.
      // Sonda diferida y escalonada por negocio: es OBSERVABILIDAD, no seguridad, y no debe amontonar lecturas.
      if (readClient) setTimeout(() => void (async (): Promise<void> => {
        try {
          const st = new PgEventStore(pool);
          const env = await new EnvelopeService(st).leerUltimo(org);
          const binds = env ? await new ResourceBindingService(st).listar(org) : [];
          const rn = env ? binds.find((b) => b.envelopeId === env.id && b.entityType === 'campaign')?.providerResourceId ?? null : null;
          const cid = rn?.match(/^customers\/(\d+)\//)?.[1] ?? null;
          const campId = rn?.match(/campaigns\/(\d+)$/)?.[1] ?? null;
          if (!cid || !campId) { console.log(JSON.stringify({ campaignDatesProbe: 'no_binding', org })); return; }
          // v25: los campos son start_date_time / end_date_time ("yyyy-MM-dd HH:mm:ss", zona del customer).
          const rows = await readClient.buscar(cid, `SELECT campaign.id, campaign.start_date_time, campaign.end_date_time FROM campaign WHERE campaign.id = ${campId}`);
          const c = (rows[0] as { campaign?: { startDateTime?: unknown; endDateTime?: unknown } } | undefined)?.campaign;
          console.log(JSON.stringify({ campaignDatesProbe: { ok: true, org, campaignId: campId, startDateTimeRaw: c?.startDateTime ?? null, endDateTimeRaw: c?.endDateTime ?? null, startDate: fechaCalendario(c?.startDateTime), endDate: fechaCalendario(c?.endDateTime) } }));
        } catch (e) { console.log(JSON.stringify({ campaignDatesProbe: 'error', org, error: e instanceof Error ? e.message : String(e) })); }
      })(), RETRASO_SONDA_FECHAS_MS + i * 5_000).unref?.();
    }
  } else {
    console.log(JSON.stringify({ stopMonitor: 'disabled' }));
    void salud.marcarDeshabilitado('stopMonitor', '', 'SOEC_STOP_MONITOR_ENABLED=false').catch(() => undefined);
  }

  // DIRECTOR AUTÓNOMO: ciclo SERVER-SIDE (no depende de la UI). En cada ciclo lee evidencia READ-ONLY, y al cerrar
  // un experimento (stop/pausa/fin) PERSISTE post-mortem + learning + decision pack + notificación (idempotente).
  // 0 escrituras a Google. Cadencia 5 min + una corrida inmediata al boot (el resultado nace antes de cualquier UI).
  if (process.env.SOEC_DIRECTOR_CYCLE_ENABLED !== 'false') {
    // PARA QUÉ NEGOCIOS corre: los que tienen la capacidad `CICLO_DIRECTOR` habilitada en la BASE. Crear una
    // empresa NO enciende su director: la capacidad nace apagada y sólo la habilita una persona.
    const conDirector = await crearDescubridorPorCapacidad(pool, 'CICLO_DIRECTOR')();
    const directorCycle = new DirectorCycleService(new PgEventStore(pool), {
      envelopes: new EnvelopeService(new PgEventStore(pool)),
      bindings: new ResourceBindingService(new PgEventStore(pool)),
      diagnosis: new DiagnosisEvidenceService(new PgEventStore(pool)),
      clienteFactory: (o) => construirClienteEscrituraGoogleAds(process.env, o, compGoogleAds, {}),
    });
    if (conDirector.length === 0) {
      console.log(JSON.stringify({ directorCycle: 'sin_negocios_con_capacidad', capacidad: 'CICLO_DIRECTOR' }));
      void salud.marcarDeshabilitado('directorCycle', '', 'ningún negocio tiene la capacidad CICLO_DIRECTOR').catch(() => undefined);
    }
    // PUERTA DE EVALUACIÓN (Fase C): sin política completa el ciclo se SALTA con sus motivos. Un negocio
    // incompleto no es un error del servidor y no impide que los demás corran.
    const politicaSvc = new PoliticaService(pool);
    const puedeEvaluar = async (org: string): Promise<{ ok: boolean; faltantes: readonly string[] }> => {
      try {
        const c = await politicaSvc.completitud(org);
        return { ok: c.estado === 'EVALUATION_PROFILE_COMPLETE', faltantes: c.faltantes.map((f) => f.campo) };
      } catch {
        // Si la comprobación falla, NO se bloquea el ciclo de quien ya venía funcionando: se deja correr.
        return { ok: true, faltantes: [] };
      }
    };
    for (const [i, org] of conDirector.entries()) {
      iniciarDirectorCycle(directorCycle, org, 5 * 60_000, latido('directorCycle', org, 5 * 60_000), RETRASO_DIRECTOR_MS + i * 5_000, puedeEvaluar);
      console.log(JSON.stringify({ directorCycle: 'started', org, retrasoInicialMs: RETRASO_DIRECTOR_MS + i * 5_000 }));
      // Observabilidad del BUCLE DE DECISIÓN al boot (READ-ONLY, mismo SSOT que la UI): decisión vigente + su semántica
      // financiera. Corre unos segundos DESPUÉS del boot para leer el resultado ya persistido por la corrida inmediata
      // del ciclo (evita la carrera boot-tick/probe). No dispara análisis ni escribe en Google.
      setTimeout(() => void (async (): Promise<void> => {
        try {
          const dsvc = new DecisionService(new PgEventStore(pool), { leerResultado: (o) => directorCycle.leerResultado(o) });
          const est = await dsvc.estado(org); const c = est.current;
          console.log(JSON.stringify({ decisionProbe: c
            ? { org, decisionId: c.decisionId, type: c.decisionType, status: c.decisionStatus, financialCommitmentClp: c.financialCommitmentClp, providerWritesExpected: c.providerWritesExpected, historicalBudget: c.historicalCampaignBudgetClp, historicalSpend: c.historicalSpendClp, confidence: c.confidence, historyLen: est.history.length }
            : { org, current: null, historyLen: est.history.length } }));
        } catch (e) { console.log(JSON.stringify({ decisionProbe: 'error', org, error: e instanceof Error ? e.message : String(e) })); }
      })(), 20_000 + i * 5_000).unref?.();
    }
  } else {
    console.log(JSON.stringify({ directorCycle: 'disabled' }));
    void salud.marcarDeshabilitado('directorCycle', '', 'SOEC_DIRECTOR_CYCLE_ENABLED=false').catch(() => undefined);
  }

  // ── INGESTA SERVER-SIDE MULTIEMPRESA ────────────────────────────────────────────────────────
  // Reemplaza la tarea de Windows (`scripts/ingesta-tick.cmd`) que corría en el PC del desarrollador y llevaba
  // deshabilitada desde 2026-08-27. Descubre del registro qué organizaciones son ingeribles (ninguna fijada en
  // código), corre cada una aislada y registra su salud. Apagable con SOEC_INGESTA_ENABLED=false.
  if (process.env.SOEC_INGESTA_ENABLED !== 'false') {
    const storeIngesta = new PgEventStore(pool);
    // DESCUBRIMIENTO desde la base: las organizaciones ingeribles salen del repositorio persistente, no de
    // un array en código. Una empresa creada desde la interfaz entra sin desplegar nada.
    const descubrir = crearDescubridorDeNegocios(pool);
    // ELEGIBILIDAD COMO DATO: se ingiere a quien tiene la capacidad `INGESTA_GROWTH` habilitada. El almacén de
    // secretos combina el entorno (credenciales históricas) con el depósito cifrado por tenant, de modo que una
    // empresa conectada desde la interfaz se ingiere sin ninguna variable de entorno nueva.
    const elegibles = crearElegiblesPorCapacidad(pool, 'INGESTA_GROWTH');
    const secretStore = crearAlmacenDeLecturaDeSecretos(crearDepositoSecretosConexion(pool, process.env), process.env);
    const plan = await planDeIngesta(storeIngesta, process.env, descubrir, { elegibles, secretStore });
    // Las organizaciones que hoy NO son ingeribles quedan marcadas como deshabilitadas con su motivo, para que
    // el read model no conserve un estado viejo de cuando sí lo eran.
    void sincronizarSaludDelPlan({ store: storeIngesta, env: process.env, salud, descubrir, elegibles, secretStore }).catch(() => undefined);
    iniciarIngestaServidor({ store: storeIngesta, env: process.env, salud, descubrir, elegibles, secretStore, log: (i) => console.log(JSON.stringify(i)) }, INTERVALO_INGESTA_MS);
    console.log(JSON.stringify({ ingesta: 'started', intervaloMs: INTERVALO_INGESTA_MS, organizaciones: plan.map((p) => ({ org: p.org, fuentes: p.fuentes, omitidas: p.omitidas })) }));
  } else {
    console.log(JSON.stringify({ ingesta: 'disabled' }));
    void salud.marcarDeshabilitado('ingestion', '', 'SOEC_INGESTA_ENABLED=false').catch(() => undefined);
  }
}

main().catch(async (err: unknown) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
