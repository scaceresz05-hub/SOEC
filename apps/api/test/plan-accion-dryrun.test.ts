/**
 * E2E G1 (ASISTIDO DRY-RUN): evidencia real → Lectura Director → PlanificadorDeCambios → gates →
 * aprobación simulada → Executor DRY-RUN → auditoría. SIN efecto externo (AUTONOMOUS_REAL apagado).
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService, type EntradaObservacionReal } from '@soec/motor-medicion';
import { adsSnapshotStreamId, EVENTO_ADS_SNAPSHOT } from '../src/ingesta/ingesta-google-ads-service';
import { LecturaDirectorRealService } from '../src/real-director/lectura-director-real';
import { ORG_SMILEFLOW as ORG_REAL } from '../src/plataforma';
import { PlanAccionDryRunService } from '../src/autonomia-ads/plan-accion-service';
import { planificarCambios, type InsumosPlan } from '../src/autonomia-ads/intencion';
import { evaluarGates, type ContextoGates } from '../src/autonomia-ads/gates';
import { simularEjecucion } from '../src/autonomia-ads/executor-dryrun';
import { LIMITES_SMILEFLOW, type LimitesAutonomia } from '../src/autonomia-ads/limites-smileflow';

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

  it('términos reales con muestra + 0 clics SIN política ⇒ 0 propuestas, pero SÍ oportunidades tácticas (fix)', async () => {
    // Comportamiento CORREGIDO: 0 clics ≠ irrelevancia. Sin política del negocio, SOEC NO excluye
    // "reparacion de autos" ni "dentalink agenda": los observa como oportunidad táctica (revisar mensaje).
    const store = new InMemoryEventStore();
    await seedSnapshot(store, { impressions: 292, clicks: 7, cost: 6028 });
    await new LecturaDirectorRealService(store).recalcular(ORG_REAL, AHORA);
    await seedTerminos(store, [{ t: 'reparacion de autos', impr: 40, clics: 0 }, { t: 'dentalink agenda', impr: 40, clics: 0 }]);

    const plan = await new PlanAccionDryRunService(store).generar(ORG_REAL, AHORA, { perfil: 'ASISTIDO' });
    expect(plan.totalPropuestas).toBe(0);          // estratégico: NADA que ejecutar (no false-negative)
    expect(plan.items).toEqual([]);
    expect(plan.veredicto).toBe('OBSERVAR');
    expect(plan.oportunidadesTacticas.length).toBeGreaterThan(0); // táctico: revisar mensaje
    expect(plan.oportunidadesTacticas.every((o) => o.accion === 'OPTIMIZAR_MENSAJE')).toBe(true);
  });

  it('recorrido COMPLETO dry-run CUANDO hay evidencia de irrelevancia (política) ⇒ gates/executor sin efecto', () => {
    // Con una política de irrelevancia del negocio, un término 0-clics con muestra SÍ es negativa justificada;
    // el pipeline (gates + executor DRY-RUN) se ejercita igual, sin efecto externo.
    const limites: LimitesAutonomia = { ...LIMITES_SMILEFLOW, politicaIrrelevancia: ['empleo'] };
    const insumos: InsumosPlan = {
      org: ORG_REAL, customerId: '24120966895', campaniaRef: 'cmp', evidenciaSuficiente: false,
      clasificacionDesempeno: 'sin_datos', roiClasificacion: 'NO_EVALUABLE', decisionTipo: null,
      terminos: [{ termino: 'empleo dentista', impresiones: 40, clics: 0 }], limites,
    };
    const intenciones = planificarCambios(insumos);
    expect(intenciones).toHaveLength(1);
    const intencion = intenciones[0]!;
    expect(intencion.palanca).toBe('agregar_negativa');

    const ctxGates: ContextoGates = {
      autonomousReal: false, killSwitchActivo: false, pausado: false, nivelAutonomia: 'EJECUTAR_CON_APROBACION',
      autorizacionVigente: true, limiteDisponible: true, aprobacionHumana: true, cambiosHoy: 0,
      cooldownVigente: false, customerIdAutorizado: '24120966895',
    };
    const gates = evaluarGates(intencion, ctxGates, limites);
    expect(gates.modo).toBe('DRY_RUN');
    expect(gates.puedeEjecutarReal).toBe(false);
    expect(gates.bloqueos).toContain('INTERRUPTOR_MAESTRO_REAL');

    const sim = simularEjecucion(intencion, gates);
    expect(sim.ejecutado).toBe(false);
    expect(sim.mutateSimulado.length).toBeGreaterThan(0);
    expect(sim.rollback.descripcion.length).toBeGreaterThan(0);
  });
});
