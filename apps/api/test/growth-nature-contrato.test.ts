/**
 * CONTRATO de naturaleza REAL/TEST en la evidencia comercial (Growth → SOEC).
 *
 * Garantiza, a nivel de datos/contrato (no sólo de UI), que:
 *   - REAL_LEAD_REACHES_GROWTH_PIPELINE: un evento REAL entra al embudo comercial y es elegible como
 *     evidencia (diagnostico=false).
 *   - TEST_LEAD_DOES_NOT_REACH_REAL_M8: un evento marcado is_test se ingiere y queda auditable, pero
 *     NUNCA cuenta como evidencia comercial (diagnostico=true ⇒ fuera de los totales comerciales del panel).
 *   - La fuente de verdad es el flag estructural `is_test` del puente, no el nombre/el texto del lead.
 *   - Aislamiento por organización: la ingesta de una org no aparece en otra.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, SalidaAdaptador } from '@soec/adaptadores';
import { ObservacionService } from '@soec/motor-medicion';
import { IngestaSmileFlowGrowth } from '../src/ingesta/ingesta-smileflow-service';
import { esDiagnostico, mapearEventoGrowth, observacionIdDe, type EventoGrowth } from '../src/ingesta/mapa-growth';
import { construirPanel, type ObsPanel, type Sync } from '../src/ingesta/panel-resultados';

const AHORA = '2026-08-12T12:00:00.000Z';

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('ingesta'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}

const EV_REAL: EventoGrowth = { event_id: 500, event_name: 'demo_requested', occurred_at: AHORA, anon_id: 'sess-real', path: '/', utm_source: 'google', utm_campaign: 'c1', value: null, lead_id: 100, is_test: false };
const EV_TEST: EventoGrowth = { event_id: 501, event_name: 'demo_requested', occurred_at: AHORA, anon_id: 'sess-e2e', path: '/', utm_source: 'google', utm_campaign: 'c1', value: null, lead_id: 101, is_test: true };

function adaptadorCon(eventos: EventoGrowth[]): AdaptadorExterno {
  return {
    nombre: 'fake', capacidad: 'ingesta-growth', version: '0',
    soportaReal: () => false,
    salud: async () => ({ estado: 'SALUDABLE', detalle: 'fake' }),
    ejecutar: async (): Promise<SalidaAdaptador> => ({ estado: 'OK', salida: { body: JSON.stringify({ datos: eventos, next_cursor: null }) }, error: null }),
  };
}

describe('Contrato naturaleza REAL/TEST · mapeo puro', () => {
  it('is_test estructural es la fuente de verdad (no el nombre/el texto)', () => {
    expect(esDiagnostico(EV_TEST)).toBe(true);
    expect(esDiagnostico(EV_REAL)).toBe(false);
    // Sin is_test explícito ⇒ REAL (no diagnóstico) salvo marcadores heredados de compatibilidad.
    expect(esDiagnostico({ ...EV_REAL, is_test: undefined })).toBe(false);
    expect(esDiagnostico({ ...EV_REAL, is_test: undefined, utm_source: 'diag' })).toBe(true); // compat aux
  });

  it('mapearEventoGrowth propaga diagnostico desde is_test', () => {
    expect(mapearEventoGrowth(EV_TEST).diagnostico).toBe(true);
    expect(mapearEventoGrowth(EV_REAL).diagnostico).toBe(false);
  });
});

describe('Contrato naturaleza REAL/TEST · panel comercial', () => {
  it('TEST_LEAD_DOES_NOT_REACH_REAL_M8 / REAL_LEAD_REACHES_GROWTH_PIPELINE', () => {
    const obs: ObsPanel[] = [EV_REAL, EV_TEST].map((ev) => ({
      provider: 'smileflow-growth', eventName: ev.event_name, metrica: ev.event_name, valor: 1,
      occurredAt: ev.occurred_at, diagnostico: esDiagnostico(ev), utmCampaign: ev.utm_campaign,
      utmContent: null, limitaciones: [], externalEventId: String(ev.event_id),
    }));
    const syncs: Sync[] = [{ provider: 'smileflow-growth', ok: true, at: AHORA, estado: 'OK' }];
    const panel = construirPanel(obs, syncs, null);
    // REAL cuenta como evidencia comercial:
    expect(panel.growthFunnel.comercial.demo_requested).toBe(1);
    // TEST NO cuenta como comercial, pero queda visible en el bucket de diagnóstico (auditable):
    expect(panel.growthFunnel.diagnostico.demo_requested).toBe(1);
  });
});

describe('Contrato naturaleza REAL/TEST · ingesta real', () => {
  it('la observación REAL preserva diagnostico=false y la TEST diagnostico=true', async () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    const ingesta = new IngestaSmileFlowGrowth({ adaptador: adaptadorCon([EV_REAL, EV_TEST]), observaciones, store, org: 'org-smileflow' });
    await ingesta.correrUnaVez(ctx('org-smileflow'), { ahora: AHORA });

    const real = await observaciones.cargar(ctx('org-smileflow'), observacionIdDe(EV_REAL));
    const test = await observaciones.cargar(ctx('org-smileflow'), observacionIdDe(EV_TEST));
    expect(real.datos?.naturaleza).toBe('REAL');
    expect(real.datos?.provenanciaReal?.diagnostico).toBe(false);
    expect(test.datos?.naturaleza).toBe('REAL'); // sigue siendo dato REAL (observado), pero…
    expect(test.datos?.provenanciaReal?.diagnostico).toBe(true); // …excluido de la evidencia comercial
  });

  it('aislamiento por organización: lo ingerido en una org no aparece en otra', async () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    const ingesta = new IngestaSmileFlowGrowth({ adaptador: adaptadorCon([EV_REAL]), observaciones, store, org: 'org-smileflow' });
    await ingesta.correrUnaVez(ctx('org-smileflow'), { ahora: AHORA });

    expect(await observaciones.listarIds(ctx('org-smileflow'))).toHaveLength(1);
    expect(await observaciones.listarIds(ctx('org-otra'))).toHaveLength(0);
  });
});
