/**
 * E2E G1 (ASISTIDO DRY-RUN): evidencia real → Lectura Director → PlanificadorDeCambios → gates →
 * aprobación simulada → Executor DRY-RUN → auditoría. SIN efecto externo (AUTONOMOUS_REAL apagado).
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService, type EntradaObservacionReal } from '@soec/motor-medicion';
import { adsSnapshotStreamId, EVENTO_ADS_SNAPSHOT } from '../src/ingesta/ingesta-google-ads-service';
import { LecturaDirectorRealService, ORG_REAL } from '../src/real-director/lectura-director-real';
import { PlanAccionDryRunService } from '../src/autonomia-ads/plan-accion-service';

const AHORA = '2026-08-11T12:00:00.000Z';
const ATR: Attribution = { source: 't', purpose: 't', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('seed'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}
async function seedSnapshot(store: EventStore, snap: { impressions: number; clicks: number; cost: number }): Promise<void> {
  const c = ctx(ORG_REAL);
  const ev = await store.readStream(c, adsSnapshotStreamId(ORG_REAL));
  await store.append(c, adsSnapshotStreamId(ORG_REAL), ev.length, [{ type: EVENTO_ADS_SNAPSHOT, payload: { campaignId: '24120966895', campaignName: 'SmileFlow Search Chile', status: 'ENABLED', ...snap, at: AHORA }, attribution: ATR, occurredAt: AHORA }]);
}
const term = (t: string, metrica: string, valor: number): EntradaObservacionReal => ({
  provider: 'google-ads', externalEventId: `google-ads:searchterm:${t}:${metrica}`, eventName: 'ads_search_term',
  occurredAt: '2026-08-10T00:00:00Z', kpiId: metrica, metrica, valor, unidad: 'conteo', calidad: 'alta', cobertura: 1,
  source: 'google-ads', utmContent: t, diagnostico: false,
});
async function seedTerminos(store: InMemoryEventStore, filas: { t: string; impr: number; clics: number }[]): Promise<void> {
  const svc = new ObservacionService(store, {} as never);
  for (const f of filas) {
    await svc.registrarReal(ctx(ORG_REAL), term(f.t, 'search_term_impressions', f.impr).externalEventId, term(f.t, 'search_term_impressions', f.impr), ATR, AHORA);
    await svc.registrarReal(ctx(ORG_REAL), term(f.t, 'search_term_clicks', f.clics).externalEventId, term(f.t, 'search_term_clicks', f.clics), ATR, AHORA);
  }
}

describe('PlanAccionDryRunService.generar (E2E G1)', () => {
  it('términos reales de poca muestra ⇒ 0 propuestas, veredicto OBSERVAR, nada ejecutado', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store, { impressions: 292, clicks: 7, cost: 6028 });
    await new LecturaDirectorRealService(store).recalcular(ORG_REAL, AHORA);
    await seedTerminos(store, [{ t: 'dentalink agenda', impr: 6, clics: 0 }]);

    const plan = await new PlanAccionDryRunService(store).generar(ORG_REAL, AHORA);
    expect(plan.modo).toBe('DRY_RUN');
    expect(plan.autonomousReal).toBe(false);
    expect(plan.veredicto).toBe('OBSERVAR');
    expect(plan.totalPropuestas).toBe(0);
    expect(plan.items).toEqual([]);
  });

  it('un término con muestra suficiente ⇒ recorrido COMPLETO en dry-run, sin efecto externo', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store, { impressions: 292, clicks: 7, cost: 6028 });
    await new LecturaDirectorRealService(store).recalcular(ORG_REAL, AHORA);
    await seedTerminos(store, [{ t: 'reparacion de autos', impr: 40, clics: 0 }, { t: 'dentalink agenda', impr: 6, clics: 0 }]);

    const svc = new PlanAccionDryRunService(store);
    const plan = await svc.generar(ORG_REAL, AHORA, { perfil: 'ASISTIDO' });

    expect(plan.totalPropuestas).toBe(1); // solo el término con muestra suficiente
    const it = plan.items[0]!;
    // Decision → intención tipada en lenguaje simple
    expect(it.intencion.palanca).toBe('agregar_negativa');
    expect(it.intencion.entidadRef).toBe('reparacion de autos');
    // gates: en G1 NUNCA se puede ejecutar de verdad
    expect(it.gates.modo).toBe('DRY_RUN');
    expect(it.gates.puedeEjecutarReal).toBe(false);
    expect(it.gates.bloqueos).toContain('INTERRUPTOR_MAESTRO_REAL');
    // aprobación simulada (ASISTIDO)
    expect(it.aprobacion.requerida).toBe(true);
    expect(it.aprobacion.simulada).toBe(true);
    // Executor DRY-RUN: NUNCA ejecutado; describe mutate + rollback
    expect(it.simulacion.ejecutado).toBe(false);
    expect(it.simulacion.mutateSimulado.length).toBeGreaterThan(0);
    expect(it.simulacion.rollback.descripcion.length).toBeGreaterThan(0);

    // auditoría persistida
    const leido = await svc.leerUltimo(ORG_REAL);
    expect(leido?.totalPropuestas).toBe(1);
  });

  it('perfil CONSERVADOR ⇒ el nivel no autoriza ejecutar (queda como recomendación)', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store, { impressions: 292, clicks: 7, cost: 6028 });
    await new LecturaDirectorRealService(store).recalcular(ORG_REAL, AHORA);
    await seedTerminos(store, [{ t: 'reparacion de autos', impr: 40, clics: 0 }]);
    const plan = await new PlanAccionDryRunService(store).generar(ORG_REAL, AHORA, { perfil: 'CONSERVADOR' });
    expect(plan.items[0]!.gates.bloqueos).toContain('NIVEL_AUTONOMIA');
  });
});
