/**
 * SEMÁNTICA MONETARIA · el mismo número no significa lo mismo en dos monedas.
 *
 * El riesgo concreto que estas pruebas cierran: SOEC guarda los importes en unidades MENORES —la convención
 * del mandato financiero— y las plataformas de anuncios hablan en MICROS, que son millonésimas de la unidad
 * MAYOR. En una moneda sin decimales (CLP, JPY) menor y mayor coinciden y multiplicar por un millón es
 * correcto; en una con dos decimales (USD, EUR) no, y el error no es cosmético: son DOS ÓRDENES DE MAGNITUD.
 *
 *   CLP 10.000/día  →  10.000 menores      →  10.000.000.000 micros
 *   JPY  1.000/día  →   1.000 menores      →   1.000.000.000 micros
 *   USD     10,00/día →  1.000 menores     →      10.000.000 micros   (¡no 1.000.000.000!)
 *
 * Si alguien vuelve a escribir `× 1_000_000` sin preguntar la moneda, estas pruebas lo dicen antes que la
 * factura del cliente.
 */
import { describe, expect, it } from 'vitest';
import { aMicros, aUnidadesMayores, aUnidadesMenores, decimalesDe, deMicros, exigirMismaMoneda, normalizarMoneda } from '../src/dinero';
import { presupuestoDiarioDe } from '../src/ejecucion/paquete';
import type { Mandato } from '../src/accion/mandato';
import type { PlanCampania } from '../src/investigacion/plan-pg';

const mandato = (over: Partial<Mandato> = {}): Mandato => ({
  id: 'man-1',
  organizationId: 'org-qa',
  objective: 'captar',
  currency: 'CLP',
  authorizedBudgetMinor: 300_000,
  spentMinor: 0,
  periodStart: '2026-09-01T00:00:00.000Z',
  periodEnd: '2026-10-01T00:00:00.000Z',
  allowedMetaAssets: [],
  allowedActionTypes: ['CREATE_CAMPAIGN'],
  status: 'AUTHORIZED',
  killSwitch: false,
  authorizedBy: 'dueña',
  authorizedAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  version: 1,
  ...over,
} as Mandato);

/** Plan con un presupuesto diario propuesto en unidades MENORES de la moneda del negocio. */
const plan = (propuestoDiario: number | null): PlanCampania => ({
  presupuesto: { propuestoDiarioClp: propuestoDiario },
  puja: { techoCpcClp: null },
} as unknown as PlanCampania);

describe('unidades menores ↔ micros, según la moneda', () => {
  it.each([
    ['CLP', 0, 10_000, 10_000_000_000],
    ['JPY', 0, 1_000, 1_000_000_000],
    ['USD', 2, 1_000, 10_000_000],
    ['EUR', 2, 1_000, 10_000_000],
  ])('%s: %i decimales · %i unidades menores son %i micros', (moneda, decimales, menores, micros) => {
    expect(decimalesDe(moneda)).toBe(decimales);
    expect(aMicros(menores, moneda)).toBe(micros);
    expect(deMicros(micros, moneda)).toBe(menores);
  });

  it('USD 10,00 al día son 1.000 unidades menores y 10 millones de micros, nunca mil millones', () => {
    const menores = aUnidadesMenores(10, 'USD');
    expect(menores).toBe(1_000);
    expect(aMicros(menores, 'USD')).toBe(10_000_000);
    expect(aUnidadesMayores(menores, 'USD')).toBe(10);
    // El mismo número leído como CLP sería otra cosa completamente: 1.000 pesos.
    expect(aMicros(1_000, 'CLP')).toBe(1_000_000_000);
    expect(aMicros(1_000, 'USD')).not.toBe(aMicros(1_000, 'CLP'));
  });

  it('cero, negativo y vacío no son importes', () => {
    for (const v of [0, -5, null, undefined]) expect(aUnidadesMenores(v, 'CLP')).toBeNull();
  });

  it('una moneda que no es ISO 4217 no se acepta ni se sustituye por otra', () => {
    for (const v of ['', 'pesos', 'CL', null, undefined]) expect(normalizarMoneda(v)).toBeNull();
    expect(normalizarMoneda('usd')).toBe('USD');
  });

  it('dos monedas distintas nunca se dan por equivalentes', () => {
    expect(exigirMismaMoneda('CLP', 'CLP')).toBe('CLP');
    expect(exigirMismaMoneda('USD', 'CLP')).toBeNull();
    expect(exigirMismaMoneda('CLP', null)).toBeNull();
  });
});

describe('presupuesto diario materializado para la plataforma', () => {
  it('CLP 10.000/día se envían como 10.000.000.000 micros', () => {
    const r = presupuestoDiarioDe(plan(10_000), mandato({ currency: 'CLP', authorizedBudgetMinor: 3_000_000 }));
    expect(r.clp).toBe(10_000);
    expect(r.micros).toBe(10_000_000_000);
  });

  it('JPY 1.000/día se envían como 1.000.000.000 micros', () => {
    const r = presupuestoDiarioDe(plan(1_000), mandato({ currency: 'JPY', authorizedBudgetMinor: 300_000 }));
    expect(r.clp).toBe(1_000);
    expect(r.micros).toBe(1_000_000_000);
  });

  it('USD 10,00/día (1.000 unidades menores) se envían como 10.000.000 micros, no como mil millones', () => {
    const r = presupuestoDiarioDe(plan(1_000), mandato({ currency: 'USD', authorizedBudgetMinor: 100_000 }));
    expect(r.clp).toBe(1_000);
    expect(r.micros).toBe(10_000_000);
    // Lo que habría enviado el código anterior: cien veces más.
    expect(r.micros).not.toBe(1_000 * 1_000_000);
  });

  it('un mandato sin moneda válida no materializa presupuesto: se niega a suponer', () => {
    expect(() => presupuestoDiarioDe(plan(1_000), mandato({ currency: '' })))
      .toThrowError(/moneda/i);
  });
});
