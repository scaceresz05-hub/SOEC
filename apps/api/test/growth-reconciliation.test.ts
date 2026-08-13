/**
 * CONTRATO de RECONCILIACIÓN convergente Growth → SOEC (fix del hueco de `registrarReal` first-wins).
 *
 * Escenario exacto del bug: un evento se ingiere con is_test=false; la FUENTE lo reclasifica a is_test=true
 * DESPUÉS; una reconciliación acotada debe hacer que SOEC termine reflejando is_test=true (diagnostico=true),
 * SIN re-ingerir ni borrar, y SIN reclasificar un evento REAL distinto.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, SalidaAdaptador } from '@soec/adaptadores';
import { ObservacionService } from '@soec/motor-medicion';
import { IngestaSmileFlowGrowth } from '../src/ingesta/ingesta-smileflow-service';
import { esDiagnostico, observacionIdDe, type EventoGrowth } from '../src/ingesta/mapa-growth';
import { construirPanel, type ObsPanel, type Sync } from '../src/ingesta/panel-resultados';

const AHORA = '2026-08-13T12:00:00.000Z';
const ORG = 'org-smileflow';
function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}

// Evento comercial REAL (como demo_cta_clicked #411): NUNCA debe reclasificarse a TEST.
const REAL: EventoGrowth = { event_id: 411, event_name: 'demo_cta_clicked', occurred_at: AHORA, anon_id: 'real', path: '/', utm_source: 'google', utm_campaign: 'c', value: null, lead_id: null, is_test: false };
// Lead que la fuente reclasifica de REAL→TEST tras la ingesta.
let leadIsTest = false;
const LEAD = (): EventoGrowth => ({ event_id: 14, event_name: 'lead_created', occurred_at: AHORA, anon_id: 'sess14', path: '/', utm_source: null, utm_campaign: null, value: null, lead_id: 14, is_test: leadIsTest });

function adaptador(getEventos: () => EventoGrowth[]): AdaptadorExterno {
  return {
    nombre: 'fake', capacidad: 'ingesta-growth', version: '0',
    soportaReal: () => false,
    salud: async () => ({ estado: 'SALUDABLE', detalle: 'x' }),
    ejecutar: async (_c, sol): Promise<SalidaAdaptador> => {
      const cursor = Number(sol.peticion.parametros.cursor ?? '0');
      const datos = cursor === 0 ? getEventos() : [];
      return { estado: 'OK', salida: { body: JSON.stringify({ datos, next_cursor: datos.length ? 999 : null }) }, error: null };
    },
  };
}

function obsPanelDe(st: { datos: { provenanciaReal?: { diagnostico: boolean } | null } | null }, ev: EventoGrowth): ObsPanel {
  return {
    provider: 'smileflow-growth', eventName: ev.event_name, metrica: ev.event_name, valor: 1,
    occurredAt: ev.occurred_at, diagnostico: st.datos?.provenanciaReal?.diagnostico ?? false,
    utmCampaign: ev.utm_campaign, utmContent: null, limitaciones: [], externalEventId: String(ev.event_id),
  };
}

describe('Reconciliación convergente Growth → SOEC', () => {
  it('is_test false→true reconcilia sin re-ingerir; REAL preservado; idempotente; panel converge', async () => {
    leadIsTest = false;
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    const ingesta = new IngestaSmileFlowGrowth({ adaptador: adaptador(() => [REAL, LEAD()]), observaciones, store, org: ORG });

    // 1) Ingesta inicial: el lead entra como comercial (is_test=false) — reproduce el estado del bug.
    await ingesta.correrUnaVez(ctx(ORG), { ahora: AHORA });
    const cargarLead = () => observaciones.cargar(ctx(ORG), observacionIdDe(LEAD()));
    expect((await cargarLead()).datos?.provenanciaReal?.diagnostico).toBe(false);

    // 2) La FUENTE reclasifica el lead a TEST. Un tick normal NO lo re-ingiere (cursor avanzado); la
    //    reconciliación acotada sí converge el flag.
    leadIsTest = true;
    const r = await ingesta.reconciliarDiagnostico(ctx(ORG), { ahora: AHORA });
    expect(r.reconciliados).toBe(1); // sólo el lead cambió
    expect((await cargarLead()).datos?.provenanciaReal?.diagnostico).toBe(true); // INGESTION_RECONCILES_IS_TEST

    // REAL_EVENT_MUST_NOT_BE_RECLASSIFIED_AS_TEST: el evento REAL sigue REAL.
    const obsReal = await observaciones.cargar(ctx(ORG), observacionIdDe(REAL));
    expect(obsReal.datos?.provenanciaReal?.diagnostico).toBe(false);

    // 3) Idempotente: una segunda reconciliación no cambia nada.
    const r2 = await ingesta.reconciliarDiagnostico(ctx(ORG), { ahora: AHORA });
    expect(r2.reconciliados).toBe(0);

    // 4) El panel converge: el lead sale del embudo comercial y entra en diagnóstico; el REAL sigue comercial.
    const panel = construirPanel([obsPanelDe(await cargarLead(), LEAD()), obsPanelDe(obsReal, REAL)], [{ provider: 'smileflow-growth', ok: true, at: AHORA, estado: 'OK' } as Sync], null);
    expect(panel.growthFunnel.comercial.lead_created).toBe(0);
    expect(panel.growthFunnel.diagnostico.lead_created).toBe(1);
    expect(panel.growthFunnel.comercial.demo_cta_clicked).toBe(1); // REAL preservado
  });

  it('reconciliar no crea observaciones para eventos inexistentes (fail-closed)', async () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    const ingesta = new IngestaSmileFlowGrowth({ adaptador: adaptador(() => [LEAD()]), observaciones, store, org: ORG });
    // Sin ingesta previa: reconciliar no debe crear nada.
    const r = await ingesta.reconciliarDiagnostico(ctx(ORG), { ahora: AHORA });
    expect(r.reconciliados).toBe(0);
    expect(await observaciones.listarIds(ctx(ORG))).toHaveLength(0);
  });
});
