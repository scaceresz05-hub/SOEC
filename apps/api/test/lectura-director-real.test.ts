/**
 * E2E del puente REAL: snapshot acumulado (evidencia REAL) + M8 → MeasurementService → M9 →
 * ResultadoCampania → Lectura Director. Verifica el veredicto honesto y los invariantes (naturaleza REAL,
 * diagnóstico excluido, aislamiento de tenant, atribución honesta, ninguna acción automática).
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService, type EntradaObservacionReal } from '@soec/motor-medicion';
import { adsSnapshotStreamId, EVENTO_ADS_SNAPSHOT } from '../src/ingesta/ingesta-google-ads-service';
import { LecturaDirectorRealService, ORG_REAL } from '../src/real-director/lectura-director-real';

const AHORA = '2026-08-11T12:00:00.000Z';
const ATR: Attribution = { source: 't', purpose: 't', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('seed'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}

async function seedSnapshot(store: EventStore, org: string, snap: { impressions: number; clicks: number; cost: number }): Promise<void> {
  const c = ctx(org);
  const eventos = await store.readStream(c, adsSnapshotStreamId(org));
  await store.append(c, adsSnapshotStreamId(org), eventos.length, [{
    type: EVENTO_ADS_SNAPSHOT,
    payload: { campaignId: '24120966895', campaignName: 'SmileFlow Search Chile', status: 'ENABLED', ...snap, at: AHORA },
    attribution: ATR, occurredAt: AHORA,
  }]);
}

const obsAds = (metrica: string, valor: number, diagnostico = false): EntradaObservacionReal => ({
  provider: 'google-ads', externalEventId: `google-ads:campaign:24120966895:2026-08-10:${metrica}${diagnostico ? ':diag' : ''}`,
  eventName: `ads_metric:${metrica}`, occurredAt: '2026-08-10T00:00:00Z', kpiId: metrica, metrica, valor, unidad: metrica === 'cost' ? 'monetario' : 'conteo',
  calidad: 'alta', cobertura: 1, source: 'google-ads', utmCampaign: 'SmileFlow Search Chile', diagnostico,
});

/** Siembra: snapshot real (273/7/6028) + observaciones M8 (una diagnóstico) + snapshot ajeno de otro tenant. */
async function sembrar(store: InMemoryEventStore): Promise<void> {
  await seedSnapshot(store, ORG_REAL, { impressions: 273, clicks: 7, cost: 6028 });
  const svc = new ObservacionService(store, {} as never);
  await svc.registrarReal(ctx(ORG_REAL), obsAds('impressions', 100).externalEventId, obsAds('impressions', 100), ATR, AHORA);
  await svc.registrarReal(ctx(ORG_REAL), obsAds('impressions', 999, true).externalEventId, obsAds('impressions', 999, true), ATR, AHORA); // DIAGNÓSTICO
  // Otro tenant con un snapshot enorme: NO debe verse (aislamiento).
  await seedSnapshot(store, 'pyme-met-demo', { impressions: 999999, clicks: 9999, cost: 9999999 });
}

describe('LecturaDirectorRealService.recalcular', () => {
  it('datos reales insuficientes ⇒ VEREDICTO OBSERVAR, naturaleza REAL, sin recomendación', async () => {
    const store = new InMemoryEventStore();
    await sembrar(store);
    const lectura = await new LecturaDirectorRealService(store).recalcular(ORG_REAL, AHORA);

    expect(lectura.veredicto).toBe('OBSERVAR');
    expect(lectura.naturaleza).toBe('REAL');
    expect(lectura.recomendacion).toBeNull(); // no se fabrica optimización
    // HECHOS REALES desde el snapshot acumulado; 0 conversiones atribuibles
    expect(lectura.hechos.impresiones).toBe(273);
    expect(lectura.hechos.clics).toBe(7);
    expect(lectura.hechos.gasto).toBe(6028);
    expect(lectura.hechos.conversionesAtribuiblesAds).toBe(0);
    expect(lectura.hechos.cpc).toBeCloseTo(6028 / 7, 4);
    // INTERPRETACIÓN honesta
    expect(lectura.interpretacion.clasificacionDesempeno).toBe('evidencia_insuficiente');
    expect(lectura.interpretacion.evidenciaSuficiente).toBe(false);
    // ROI: gasto real sin conversión atribuible ⇒ NO_CONCLUYENTE por contrato
    expect(lectura.interpretacion.roi.clasificacion).toBe('NO_CONCLUYENTE');
    expect(lectura.interpretacion.faltantes.some((f) => f.includes('sin conversión'))).toBe(true);
  });

  it('AISLAMIENTO de tenant: el snapshot de otro org NO infla los hechos', async () => {
    const store = new InMemoryEventStore();
    await sembrar(store);
    const lectura = await new LecturaDirectorRealService(store).recalcular(ORG_REAL, AHORA);
    expect(lectura.fuente).toBe(ORG_REAL);
    expect(lectura.hechos.impresiones).toBe(273); // NO 999999
  });

  it('leerUltima devuelve la lectura persistida (last-wins)', async () => {
    const store = new InMemoryEventStore();
    await sembrar(store);
    const svc = new LecturaDirectorRealService(store);
    expect(await svc.leerUltima(ORG_REAL)).toBeNull();
    await svc.recalcular(ORG_REAL, AHORA);
    expect((await svc.leerUltima(ORG_REAL))?.veredicto).toBe('OBSERVAR');
  });

  it('FRESCURA: recalcular refleja el snapshot MÁS reciente (no se congela en el primero del período)', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store, ORG_REAL, { impressions: 273, clicks: 7, cost: 6028 });
    const svc = new LecturaDirectorRealService(store);
    const a = await svc.recalcular(ORG_REAL, AHORA);
    expect(a.hechos.impresiones).toBe(273);
    // llega un snapshot posterior (el acumulado creció); recalcular debe verlo, no quedar en 273
    await seedSnapshot(store, ORG_REAL, { impressions: 500, clicks: 12, cost: 9000 });
    const b = await svc.recalcular(ORG_REAL, '2026-08-11T13:00:00.000Z');
    expect(b.hechos.impresiones).toBe(500);
    expect(b.hechos.clics).toBe(12);
  });

  it('sin snapshot ni datos ⇒ NO_EVALUABLE (la ausencia no es un resultado)', async () => {
    const store = new InMemoryEventStore();
    const lectura = await new LecturaDirectorRealService(store).recalcular(ORG_REAL, AHORA);
    expect(lectura.veredicto).toBe('NO_EVALUABLE');
    expect(lectura.recomendacion).toBeNull();
  });
});
