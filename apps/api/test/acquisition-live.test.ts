/**
 * Live outcome wiring — normalización desde SSOT, exclusión de TEST y economía honesta (FASE 25-26).
 *
 * Prueban la lógica de transformación con entradas construidas (sin depender de datos ambientales),
 * y el aislamiento por tenant a nivel de outcomes. La lectura real contra el store se cubre además
 * por los tests de store-vacío (acquisition-surface).
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { conocido, desconocido, type LineaBaseDeVentas } from '@soec/comercio';
import { normalizarVentas } from '../src/acquisition/cyp-outcomes';
import { contarGrowth, type ObsGrowthLite } from '../src/acquisition/smileflow-outcomes';
import { derivarCPL, derivarROAS, derivarMER, derivarCAC, VENTANA_DESCONOCIDA, type Ventana } from '../src/acquisition/economics';
import { outcomesVivosDe } from '../src/acquisition/acquisition-service';

const W: Ventana = { inicio: null, fin: null, timezone: 'UTC', freshness: null };
const W_ACOTADA: Ventana = { inicio: '2026-08-01', fin: '2026-08-07', timezone: 'UTC', freshness: null };

function lb(over: Partial<LineaBaseDeVentas>): LineaBaseDeVentas {
  return {
    pedidosConEvidenciaDePago: 0,
    ingresoConfirmado: desconocido('NO_MEDIDO'),
    moneda: 'CLP',
    coberturaDelNegocio: 'PARCIAL',
    fechaMin: null,
    fechaMax: null,
    ...over,
  } as unknown as LineaBaseDeVentas;
}

describe('CYP · normalización de ventas desde SSOT (WooCommerce)', () => {
  it('CYP_PURCHASES_FROM_WOOCOMMERCE_SSOT / CYP_REVENUE_FROM_WOOCOMMERCE_SSOT', () => {
    const n = normalizarVentas(lb({ pedidosConEvidenciaDePago: 3, ingresoConfirmado: conocido(120000) }));
    expect(n.status).toBe('CONNECTED_WITH_DATA');
    expect(n.purchases).toBe(3); // = pedidosConEvidenciaDePago (contrato CONFIRMED reutilizado)
    expect(n.revenue).toBe(120000);
    expect(n.revenueUnknown).toBe(false);
    expect(n.currency).toBe('CLP');
  });

  it('CYP_MARGIN_REMAINS_UNKNOWN: ingreso confirmado desconocido no se coacciona a 0', () => {
    const n = normalizarVentas(lb({ pedidosConEvidenciaDePago: 2, ingresoConfirmado: desconocido('NO_INSTRUMENTADO') }));
    expect(n.purchases).toBe(2);
    expect(n.revenue).toBeNull();
    expect(n.revenueUnknown).toBe(true);
  });

  it('CYP_GA4_ABSENCE_DOES_NOT_HIDE_WOOCOMMERCE_REVENUE: sin lineaBase ⇒ NOT_AVAILABLE (no 0)', () => {
    const n = normalizarVentas(null);
    expect(n.status).toBe('NOT_AVAILABLE');
    expect(n.purchases).toBeNull();
  });
});

describe('SmileFlow · exclusión de TEST/DIAG (contrato SSOT diagnostico)', () => {
  it('TEST_DEMOS_EXCLUDED / SMILEFLOW_TEST_LEADS_EXCLUDED / real desde SSOT', () => {
    const obs: ObsGrowthLite[] = [
      { naturaleza: 'REAL', provenanciaReal: { eventName: 'lead_created', diagnostico: false } },
      { naturaleza: 'REAL', provenanciaReal: { eventName: 'lead_created', diagnostico: true } }, // TEST → excluido
      { naturaleza: 'REAL', provenanciaReal: { eventName: 'demo_requested', diagnostico: false } },
      { naturaleza: 'REAL', provenanciaReal: { eventName: 'demo_requested', diagnostico: true } }, // TEST → excluido
      { naturaleza: 'SIMULADA', provenanciaReal: { eventName: 'lead_created', diagnostico: false } }, // no REAL → ignorado
    ];
    const g = contarGrowth(obs);
    expect(g.leadCreated).toBe(1);
    expect(g.demoRequested).toBe(1);
    expect(g.excludedTest).toBe(2);
    expect(g.status).toBe('CONNECTED_WITH_DATA');
  });
});

describe('economía honesta — sin NaN/Infinity/cero falso', () => {
  it('ZERO_REAL_LEADS_DOES_NOT_MEAN_ZERO_COST_PER_LEAD: leads=0 ⇒ NO_CONVERSIONS', () => {
    expect(derivarCPL(1000, 0, W, W)).toMatchObject({ valor: null, disponibilidad: 'NO_CONVERSIONS' });
  });
  it('CPL VALUE cuando gasto y leads>0 en misma ventana (blended)', () => {
    const r = derivarCPL(1000, 5, W, W);
    expect(r.valor).toBe(200);
    expect(r.disponibilidad).toBe('VALUE');
    expect(r.caveat).toBe('BLENDED_ALL_TIME_NO_ADS_ATTRIBUTION');
  });
  it('NO_CPL_WITH_MISMATCHED_WINDOWS: ventanas incompatibles ⇒ INSUFFICIENT_DATA', () => {
    expect(derivarCPL(1000, 5, W_ACOTADA, W)).toMatchObject({ valor: null, disponibilidad: 'INSUFFICIENT_DATA', caveat: 'VENTANAS_INCOMPATIBLES' });
  });
  it('spend desconocido ⇒ INSUFFICIENT_DATA', () => {
    expect(derivarCPL(null, 5, W, W).disponibilidad).toBe('INSUFFICIENT_DATA');
  });
  it('ROAS sin ingreso atribuido ⇒ NOT_APPLICABLE; MER sin gasto ⇒ NOT_APPLICABLE; CAC sin clientes ⇒ NOT_APPLICABLE', () => {
    expect(derivarROAS(null, 1000, W).disponibilidad).toBe('NOT_APPLICABLE');
    expect(derivarMER(50000, null, W).disponibilidad).toBe('NOT_APPLICABLE');
    expect(derivarMER(50000, 10000, W)).toMatchObject({ valor: 5, disponibilidad: 'VALUE' });
    expect(derivarCAC(1000, false, W).disponibilidad).toBe('NOT_APPLICABLE');
  });
});

describe('cross-tenant · outcomes no se contaminan entre negocios', () => {
  const store = () => new InMemoryEventStore();
  const ctx = (org: string): RequestContext => {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'c' };
  };
  it('CYP_CANNOT_READ_SMILEFLOW_OUTCOMES / y viceversa: cada negocio ve sólo sus tipos de outcome', async () => {
    const cyp = await outcomesVivosDe(store(), ctx('org-cyp'), 'org-cyp');
    const sf = await outcomesVivosDe(store(), ctx('org-smileflow'), 'org-smileflow');
    const cypTipos = cyp.outcomes.map((o) => o.outcome);
    const sfTipos = sf.outcomes.map((o) => o.outcome);
    expect(cypTipos).toContain('PURCHASE');
    expect(cypTipos).not.toContain('LEAD');
    expect(sfTipos).toContain('LEAD');
    expect(sfTipos).not.toContain('PURCHASE');
  });
  it('tercer negocio sin fuentes comerciales ⇒ outcomes vacíos (NOT_AVAILABLE), sin cambios de core', async () => {
    // Una org no registrada resuelve modelo por defecto SERVICIOS → sin fuentes → sin outcomes.
    const otro = await outcomesVivosDe(store(), ctx('org-negocio-3'), 'org-negocio-3');
    expect(otro.outcomes).toHaveLength(0);
  });
});
