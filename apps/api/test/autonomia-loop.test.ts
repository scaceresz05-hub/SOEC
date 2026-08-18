/**
 * V2-C · AUTONOMOUS LOOP (SHADOW) — pruebas adversariales.
 * Invariantes: (1) shadow ⇒ gasto real 0 y META_WRITE_CALLS reales 0; (2) rendimiento fuerte + agotamiento ⇒
 * recomendación financiera AWAITING_HUMAN_APPROVAL, autoAplicable=false, sin acción que aumente presupuesto;
 * (3) el bajo rendimiento se pausa DENTRO del mandato; (4) evidencia insuficiente ⇒ NO_EVALUABLE (no concluir).
 */
import { describe, expect, it } from 'vitest';
import { crearMandatoAutorizado, type Mandato } from '../src/accion/mandato';
import { InMemoryActionLedgerRepo } from '../src/accion/ledger';
import type { DepsActionPlane } from '../src/accion/action-plane';
import { MetaWriteDryRunAdapter } from '../src/campana/meta-write-port';
import { derivarMetricas } from '../src/autonomia/performance';
import { decidir } from '../src/autonomia/decision-engine';
import { correrCicloAutonomo } from '../src/autonomia/autonomous-loop';

const AHORA = '2026-08-25T12:00:00.000Z';
const ACT = 'act_100';

function mandato(over: Partial<Parameters<typeof crearMandatoAutorizado>[0]> = {}): Mandato {
  return crearMandatoAutorizado(
    {
      organizationId: 'org-a', objective: 'x', currency: 'CLP', authorizedBudgetMinor: 300000,
      periodStart: '2026-08-18T00:00:00.000Z', periodEnd: '2026-09-18T00:00:00.000Z',
      allowedMetaAssets: [ACT], allowedActionTypes: ['PAUSE_AD', 'CREATE_CAMPAIGN'],
      ...over,
    },
    'user-owner', 'm-1', AHORA,
  );
}
function deps(autonomousReal = false): DepsActionPlane {
  let n = 0;
  return { ledger: new InMemoryActionLedgerRepo(), ahora: () => AHORA, autonomousReal, globalKillSwitch: false, nuevoId: () => `id-${n++}` };
}

describe('V2-C · performance', () => {
  it('sin impresiones ⇒ SIN_DATO; pocas ⇒ INSUFICIENTE; suficientes ⇒ MEDIBLE', () => {
    expect(derivarMetricas({ adRef: 'a', impresiones: 0, clics: 0, gastoMinor: 0, resultados: 0, ventanaHoras: 24 }).calidad).toBe('SIN_DATO');
    expect(derivarMetricas({ adRef: 'a', impresiones: 200, clics: 1, gastoMinor: 5000, resultados: 0, ventanaHoras: 24 }).calidad).toBe('INSUFICIENTE');
    expect(derivarMetricas({ adRef: 'a', impresiones: 5000, clics: 100, gastoMinor: 5000, resultados: 5, ventanaHoras: 24 }).calidad).toBe('MEDIBLE');
  });
  it('no inventa métricas cuando faltan denominadores', () => {
    const m = derivarMetricas({ adRef: 'a', impresiones: 0, clics: 0, gastoMinor: 1000, resultados: 0, ventanaHoras: 24 });
    expect(m.ctr).toBeNull();
    expect(m.cprMinor).toBeNull();
    expect(m.cpcMinor).toBeNull();
  });
});

describe('V2-C · decision engine — soberanía financiera', () => {
  it('rendimiento fuerte + presupuesto agotándose ⇒ recomendación AWAITING_HUMAN_APPROVAL (no acción)', () => {
    const m = { ...mandato(), spentMinor: 260000 }; // 86% gastado
    const met = derivarMetricas({ adRef: 'a', impresiones: 10000, clics: 400, gastoMinor: 260000, resultados: 40, ventanaHoras: 24 }); // CTR 4%
    const r = decidir(m, [met]);
    expect(r.recomendacionesFinancieras).toHaveLength(1);
    const rec = r.recomendacionesFinancieras[0]!;
    expect(rec.estado).toBe('AWAITING_HUMAN_APPROVAL');
    expect(rec.autoAplicable).toBe(false);
    expect(rec.montoSugeridoMinor).toBeNull(); // SOEC no fija el monto
    // Ninguna decisión implica aumentar presupuesto por sí sola:
    expect(r.decisiones.some((d) => d.requiereAprobacionHumana)).toBe(false);
  });
});

describe('V2-C · autonomous loop (shadow)', () => {
  it('shadow: gasto real 0, META_WRITE_CALLS reales 0, y pausa el bajo rendimiento dentro del mandato', async () => {
    const m = mandato();
    const obs = [
      { adRef: 'ad-malo', impresiones: 8000, clics: 8, gastoMinor: 40000, resultados: 0, ventanaHoras: 24 }, // CTR 0.1% ⇒ pausar
      { adRef: 'ad-ok', impresiones: 8000, clics: 120, gastoMinor: 40000, resultados: 10, ventanaHoras: 24 }, // CTR 1.5% ⇒ mantener
    ];
    const run = await correrCicloAutonomo(deps(false), new MetaWriteDryRunAdapter(), { mandato: m, adAccountId: ACT, observaciones: obs });
    expect(run.modo).toBe('SHADOW');
    expect(run.gastoRealComprometidoMinor).toBe(0);
    expect(run.metaWriteCallsReales).toBe(0);
    const pausa = run.acciones.find((a) => a.adRef === 'ad-malo');
    expect(pausa?.actionType).toBe('PAUSE_AD');
    expect(pausa?.estado).toBe('SIMULADA'); // dry-run
    expect(pausa?.externalRef).toContain('dryrun:pause_ad');
  });

  it('idempotencia: reejecutar el ciclo no duplica la pausa', async () => {
    const d = deps(false);
    const m = mandato();
    const obs = [{ adRef: 'ad-malo', impresiones: 8000, clics: 8, gastoMinor: 40000, resultados: 0, ventanaHoras: 24 }];
    await correrCicloAutonomo(d, new MetaWriteDryRunAdapter(), { mandato: m, adAccountId: ACT, observaciones: obs });
    const antes = (await d.ledger.listar('org-a', 'm-1')).length;
    await correrCicloAutonomo(d, new MetaWriteDryRunAdapter(), { mandato: m, adAccountId: ACT, observaciones: obs });
    expect((await d.ledger.listar('org-a', 'm-1')).length).toBe(antes);
  });

  it('evidencia insuficiente ⇒ NO_EVALUABLE, sin pausas', async () => {
    const m = mandato();
    const obs = [{ adRef: 'ad-nuevo', impresiones: 100, clics: 0, gastoMinor: 2000, resultados: 0, ventanaHoras: 6 }];
    const run = await correrCicloAutonomo(deps(false), new MetaWriteDryRunAdapter(), { mandato: m, adAccountId: ACT, observaciones: obs });
    expect(run.decisiones[0]!.tipo).toBe('NO_EVALUABLE');
    expect(run.acciones).toHaveLength(0);
  });
});
