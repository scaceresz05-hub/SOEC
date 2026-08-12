/**
 * Rutas de medición y optimización (F2-MET-01). Conducen el ciclo medir → evaluar →
 * optimizar → replanificar sobre datos sintéticos. NO hay endpoint para gastar,
 * publicar públicamente ni saltar la autorización.
 */
import type { FastifyInstance } from 'fastify';
import { ActorId, OrganizationId, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import { MeasurementExperience } from './measurement-experience';
import { construirPanel, type ObsPanel, type Sync } from './ingesta/panel-resultados';
import { adsSnapshotStreamId, ultimoSnapshotAds } from './ingesta/ingesta-google-ads-service';
import { LecturaDirectorRealService, ORG_REAL } from './real-director/lectura-director-real';
import { PlanAccionDryRunService, type PerfilUsuario } from './autonomia-ads/plan-accion-service';
import { G2AService, ORG_REAL as ORG_G2A } from './autonomia-ads/g2a-service';

// Organización donde la ingesta real (one-shot smileflow-growth) deposita las observaciones REAL.
const ORG_INGESTA_REAL = 'org-smileflow';
function ctxReal(): RequestContext {
  const o = OrganizationId(ORG_INGESTA_REAL);
  return { organizationId: o, actor: ActorId('medicion-lectura'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'medicion-reales' };
}

export function registerMeasurementRoutes(app: FastifyInstance, store: EventStore): void {
  const exp = new MeasurementExperience(store);

  // LECTURA de observaciones REALES (M8, puerta gobernada) — separadas del eje simulado (med:*).
  // Con muestra mínima NO se emite recomendación: se reporta el HECHO real y conclusión NO_EVALUABLE.
  app.get('/medicion/reales', async (_req, reply) => {
    const obs = new ObservacionService(store, {} as never);
    const c = ctxReal();
    const ids = await obs.listarIds(c);
    const observaciones: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const st = await obs.cargar(c, id);
      const d = st.datos;
      if (!d || d.naturaleza !== 'REAL' || !d.provenanciaReal) continue;
      const p = d.provenanciaReal;
      observaciones.push({
        externalEventId: p.externalEventId, eventName: p.eventName, naturaleza: d.naturaleza, estado: st.estado,
        occurredAt: p.occurredAt, provider: p.provider, diagnostico: p.diagnostico,
        elegibleParaAprendizaje: !p.diagnostico, utmSource: p.utmSource, utmCampaign: p.utmCampaign,
      });
    }
    // Orden por instante de ocurrencia (desc); externalEventId es string (multi-proveedor).
    observaciones.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
    const comerciales = observaciones.filter((o) => o.elegibleParaAprendizaje).length;

    // Estado de última sincronización por fuente (ingesta autónoma).
    const PROVIDERS = ['smileflow-growth', 'google-ads'] as const;
    const sincronizaciones: Array<Record<string, unknown>> = [];
    for (const provider of PROVIDERS) {
      const eventos = await store.readStream(c, `ingesta-estado:${provider}:${ORG_INGESTA_REAL}`);
      let ultimo: { ok?: boolean; at?: string; error?: string } | null = null;
      for (const e of eventos) if (e.type === 'sync.registrada') ultimo = e.payload as { ok?: boolean; at?: string; error?: string };
      sincronizaciones.push({ provider, ok: ultimo?.ok ?? null, at: ultimo?.at ?? null });
    }
    const porProveedor: Record<string, number> = {};
    for (const o of observaciones) porProveedor[String(o.provider)] = (porProveedor[String(o.provider)] ?? 0) + 1;

    return reply.send({
      ok: true,
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
  app.get('/medicion/panel', async (_req, reply) => {
    const obs = new ObservacionService(store, {} as never);
    const c = ctxReal();
    const ids = await obs.listarIds(c);
    const observaciones: ObsPanel[] = [];
    for (const id of ids) {
      const st = await obs.cargar(c, id);
      const d = st.datos;
      if (!d || d.naturaleza !== 'REAL' || !d.provenanciaReal) continue;
      const p = d.provenanciaReal;
      observaciones.push({
        provider: p.provider, eventName: p.eventName, metrica: d.metrica ?? null, valor: d.valor ?? null,
        occurredAt: p.occurredAt, diagnostico: p.diagnostico, utmCampaign: p.utmCampaign ?? null,
        utmContent: p.utmContent ?? null, limitaciones: d.limitaciones ?? [], externalEventId: p.externalEventId,
      });
    }
    // Estado de última sincronización por fuente (mismo patrón que /medicion/reales), con estado fino.
    const PROVIDERS = ['smileflow-growth', 'google-ads'] as const;
    const sincronizaciones: Sync[] = [];
    for (const provider of PROVIDERS) {
      const eventos = await store.readStream(c, `ingesta-estado:${provider}:${ORG_INGESTA_REAL}`);
      type UltimoSync = { ok?: boolean; at?: string; estado?: 'OK' | 'PARCIAL' | 'FALLO' };
      let ultimo: UltimoSync | null = null;
      for (const e of eventos) if (e.type === 'sync.registrada') ultimo = e.payload as UltimoSync;
      sincronizaciones.push({ provider, ok: ultimo?.ok ?? null, at: ultimo?.at ?? null, estado: ultimo?.estado ?? null });
    }

    // Snapshot acumulado vigente (stream dedicado last-wins): cabecera + cifras Ads frescas de cada sync.
    const snapshotActual = ultimoSnapshotAds(await store.readStream(c, adsSnapshotStreamId(ORG_INGESTA_REAL)));

    return reply.send(construirPanel(observaciones, sincronizaciones, snapshotActual));
  });

  // LECTURA DEL DIRECTOR sobre datos REALES (org-smileflow). GET = lectura pura (sin efectos);
  // POST recalcular = recorre M8 → MeasurementService → M9 → ResultadoCampania y persiste el resultado.
  const lecturaDirector = new LecturaDirectorRealService(store);
  app.get('/medicion/lectura-director', async (_req, reply) => {
    const lectura = await lecturaDirector.leerUltima(ORG_REAL);
    if (!lectura) return reply.send({ veredicto: 'NO_EVALUABLE', naturaleza: 'REAL', motivo: 'aún no se ha calculado la lectura sobre datos reales' });
    return reply.send(lectura);
  });
  app.post('/medicion/lectura-director/recalcular', async (_req, reply) => {
    return reply.code(201).send(await lecturaDirector.recalcular(ORG_REAL, new Date().toISOString()));
  });

  // PLAN DE ACCIÓN (G1 · ASISTIDO DRY-RUN). GET = plan pura (sin efectos); POST genera y persiste.
  // NADA se ejecuta: AUTONOMOUS_REAL apagado, el Executor sólo simula.
  const planAccion = new PlanAccionDryRunService(store);
  app.get('/medicion/plan-accion', async (_req, reply) => {
    const plan = await planAccion.leerUltimo(ORG_REAL);
    if (!plan) return reply.send({ modo: 'DRY_RUN', autonomousReal: false, totalPropuestas: 0, resumenSimple: 'Aún no se ha generado el plan de acción.', items: [] });
    return reply.send(plan);
  });
  app.post('/medicion/plan-accion/generar', async (req, reply) => {
    const { perfil } = (req.body ?? {}) as { perfil?: PerfilUsuario };
    return reply.code(201).send(await planAccion.generar(ORG_REAL, new Date().toISOString(), perfil ? { perfil } : {}));
  });

  // G2-A · bandeja de aprobaciones (lenguaje simple) + aprobar/rechazar. AUTONOMOUS_REAL=false ⇒ dry-run, 0 mutate.
  const g2a = new G2AService(store);
  app.get('/medicion/g2a-bandeja', async (_req, reply) => reply.send({ ok: true, bandeja: await g2a.bandeja(ORG_G2A, new Date().toISOString()) }));
  app.post('/medicion/g2a-aprobar', async (req, reply) => {
    const { intencionId, actorHumano } = (req.body ?? {}) as { intencionId?: string; actorHumano?: string };
    if (!intencionId || !actorHumano) return reply.code(400).send({ ok: false, error: 'faltan intencionId/actorHumano' });
    try {
      const r = await g2a.aprobarYEjecutar(ORG_G2A, intencionId, actorHumano, new Date().toISOString());
      return reply.code(201).send({ ok: true, ...r });
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post('/medicion/g2a-rechazar', async (req, reply) => {
    const { intencionId, actorHumano, motivo } = (req.body ?? {}) as { intencionId?: string; actorHumano?: string; motivo?: string };
    if (!intencionId || !actorHumano) return reply.code(400).send({ ok: false, error: 'faltan intencionId/actorHumano' });
    await g2a.rechazar(ORG_G2A, intencionId, actorHumano, motivo ?? 'rechazada', new Date().toISOString());
    return reply.code(201).send({ ok: true });
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
