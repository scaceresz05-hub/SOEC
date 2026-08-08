/**
 * Rutas de medición y optimización (F2-MET-01). Conducen el ciclo medir → evaluar →
 * optimizar → replanificar sobre datos sintéticos. NO hay endpoint para gastar,
 * publicar públicamente ni saltar la autorización.
 */
import type { FastifyInstance } from 'fastify';
import { ActorId, OrganizationId, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import { MeasurementExperience } from './measurement-experience';

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
    observaciones.sort((a, b) => Number(b.externalEventId) - Number(a.externalEventId));
    const comerciales = observaciones.filter((o) => o.elegibleParaAprendizaje).length;
    return reply.send({
      ok: true,
      total: observaciones.length,
      comerciales,
      diagnosticos: observaciones.length - comerciales,
      // Muestra insuficiente: NUNCA se calcula una métrica comercial ni se recomienda; se afirma el hecho.
      conclusion: 'NO_EVALUABLE_CON_DATOS_REALES',
      observaciones,
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
