/**
 * WIRING del funnel a la estrategia del Director dentro del plan de acción (persistido, dry-run).
 * Verifica que la evidencia REAL del funnel (snapshot + contactos Growth) llega al motor de estrategia,
 * que las decisiones se PERSISTEN con el plan, y que NADA muta Google Ads (AUTONOMOUS_REAL=false).
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService, type EntradaObservacionReal } from '@soec/motor-medicion';
import { adsSnapshotStreamId, EVENTO_ADS_SNAPSHOT } from '../src/ingesta/ingesta-google-ads-service';
import { LecturaDirectorRealService } from '../src/real-director/lectura-director-real';
import { ORG_SMILEFLOW as ORG_REAL } from '../src/plataforma';
import { PlanAccionDryRunService } from '../src/autonomia-ads/plan-accion-service';

const AHORA = '2026-08-23T12:00:00.000Z';
const ATR: Attribution = { source: 't', purpose: 't', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('seed'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}
// Snapshot REAL de SmileFlow: PAUSADA, con tráfico y gasto.
async function seedSnapshot(store: EventStore): Promise<void> {
  const c = ctx(ORG_REAL);
  const ev = await store.readStream(c, adsSnapshotStreamId(ORG_REAL));
  await store.append(c, adsSnapshotStreamId(ORG_REAL), ev.length, [{
    type: EVENTO_ADS_SNAPSHOT,
    payload: { campaignId: '24120966895', campaignName: 'SmileFlow Search Chile', status: 'PAUSED', impressions: 1361, clicks: 50, cost: 30137, at: AHORA },
    attribution: ATR, occurredAt: AHORA,
  }]);
}
const contacto = (i: number): EntradaObservacionReal => ({
  provider: 'smileflow-growth', externalEventId: `growth:lead:${i}`, eventName: 'lead_created',
  occurredAt: AHORA, kpiId: 'contacto', metrica: 'contacto', valor: 1, unidad: 'conteo', calidad: 'alta', cobertura: 1,
  source: 'smileflow-growth', diagnostico: false,
});
async function seedContactos(store: InMemoryEventStore, n: number): Promise<void> {
  const svc = new ObservacionService(store, {} as never);
  for (let i = 0; i < n; i += 1) await svc.registrarReal(ctx(ORG_REAL), contacto(i).externalEventId, contacto(i), ATR, AHORA);
}

describe('plan-accion · estrategia del Director (wiring del funnel)', () => {
  it('funnel_is_wired_into_plan_inputs + genera estrategia con 0 contactos', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store);
    await new LecturaDirectorRealService(store).recalcular(ORG_REAL, AHORA);

    const plan = await new PlanAccionDryRunService(store).generar(ORG_REAL, AHORA);
    // El funnel llegó al motor: reconoce tráfico con gasto y CERO contactos.
    expect(plan.estrategia.funnelZeroConversion).toBe(true);
    expect(plan.estrategia.hechos.join(' ')).toContain('30137'); // gasto real presente en los hechos
    expect(plan.estrategia.decisiones.length).toBeGreaterThanOrEqual(2);
  });

  it('marketing_decisions_are_persisted (leerUltimo recupera la estrategia)', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store);
    await new LecturaDirectorRealService(store).recalcular(ORG_REAL, AHORA);
    const svc = new PlanAccionDryRunService(store);
    await svc.generar(ORG_REAL, AHORA);

    const persistido = await svc.leerUltimo(ORG_REAL);
    expect(persistido?.estrategia.decisiones.some((d) => d.tipo === 'FUNNEL_ZERO_CONVERSION')).toBe(true);
    expect(persistido?.estrategia.decisiones.some((d) => d.tipo === 'REQUEST_AUTHORIZED_BUDGET')).toBe(true);
  });

  it('no_google_ads_mutation + autonomous_real_remains_false (decisiones ≠ mutaciones)', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store);
    await new LecturaDirectorRealService(store).recalcular(ORG_REAL, AHORA);

    const plan = await new PlanAccionDryRunService(store).generar(ORG_REAL, AHORA);
    expect(plan.autonomousReal).toBe(false);
    // Sin política de irrelevancia ⇒ CERO palancas de Ads (negativa) aunque haya estrategia humana.
    expect(plan.totalPropuestas).toBe(0);
    expect(plan.items).toEqual([]);
  });

  it('con contactos reales > 0 ⇒ no dispara funnel-zero-conversion (control negativo)', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store);
    await seedContactos(store, 2);
    await new LecturaDirectorRealService(store).recalcular(ORG_REAL, AHORA);

    const plan = await new PlanAccionDryRunService(store).generar(ORG_REAL, AHORA);
    expect(plan.estrategia.funnelZeroConversion).toBe(false);
    expect(plan.estrategia.decisiones.some((d) => d.tipo === 'FUNNEL_ZERO_CONVERSION')).toBe(false);
  });
});
