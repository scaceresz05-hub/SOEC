/**
 * V2-C · LOOP COMPLETO (SHADOW) — el ciclo entero conectado: estrategia → campaña → Budget Guard →
 * ejecución simulada → observación → optimización → nueva decisión. Verifica que las piezas encajan y que
 * la inteligencia opera SÓLO dentro del mandato (recomendaciones de más dinero = AWAITING_HUMAN_APPROVAL).
 */
import { describe, expect, it } from 'vitest';
import { crearMandatoAutorizado, type Mandato } from '../src/accion/mandato';
import { InMemoryActionLedgerRepo } from '../src/accion/ledger';
import type { DepsActionPlane } from '../src/accion/action-plane';
import { MetaWriteDryRunAdapter } from '../src/campana/meta-write-port';
import { correrLoopCompleto } from '../src/autonomia/full-loop';
import type { PerfilNegocio } from '../src/campana/content-engine';

const AHORA = '2026-08-25T12:00:00.000Z';
const ACT = 'act_1';
const perfil: PerfilNegocio = { organizationId: 'org-a', nombre: 'Clínica', rubro: 'odontología', serviciosDeclarados: ['limpieza'], comuna: 'Ñuñoa' };
function deps(): DepsActionPlane { let n = 0; return { ledger: new InMemoryActionLedgerRepo(), ahora: () => AHORA, autonomousReal: false, globalKillSwitch: false, nuevoId: () => `id-${n++}` }; }
function mandato(mut: Partial<Mandato> = {}): Mandato {
  return { ...crearMandatoAutorizado({ organizationId: 'org-a', objective: 'x', currency: 'CLP', authorizedBudgetMinor: 200000, periodStart: '2026-08-18T00:00:00.000Z', periodEnd: '2026-09-18T00:00:00.000Z', allowedMetaAssets: [ACT], allowedActionTypes: ['UPDATE_CREATIVE_DRAFT', 'CREATE_CAMPAIGN', 'CREATE_ADSET', 'CREATE_AD', 'PAUSE_AD'] }, 'user-owner', 'm-1', AHORA), ...mut };
}

describe('V2-C · loop completo', () => {
  it('ejecuta estrategia+campaña y luego optimiza en rondas; techo respetado; 0 real', async () => {
    const m = mandato();
    const res = await correrLoopCompleto(deps(), new MetaWriteDryRunAdapter(), {
      mandato: m, perfil, objetivo: 'RECONOCIMIENTO', placement: 'instagram', adAccountId: ACT, presupuestoDeseadoMinor: 120000,
      rondasObservaciones: [
        [{ adRef: 'a1', impresiones: 9000, clics: 9, gastoMinor: 50000, resultados: 0, ventanaHoras: 24 }], // malo ⇒ pausa
        [{ adRef: 'a2', impresiones: 9000, clics: 180, gastoMinor: 50000, resultados: 20, ventanaHoras: 24 }], // bueno ⇒ mantener
      ],
    });
    expect(res.plan.anuncios.length).toBe(2);
    expect(res.ejecucionInicial.ok).toBe(true);
    expect(res.rondas.length).toBe(2);
    expect(res.invarianteGlobalOk).toBe(true);
    expect(res.gastoRealTotalMinor).toBe(0);
    expect(res.metaWriteCallsReales).toBe(0);
    // La primera ronda debe proponer al menos una pausa (bajo rendimiento) dentro del mandato.
    expect(res.rondas[0]!.shadow.acciones.some((a) => a.actionType === 'PAUSE_AD')).toBe(true);
  });

  it('rendimiento fuerte con presupuesto casi agotado ⇒ recomendación AWAITING_HUMAN_APPROVAL, sin auto-aumento', async () => {
    const m = mandato({ spentMinor: 180000 }); // 90% gastado
    const res = await correrLoopCompleto(deps(), new MetaWriteDryRunAdapter(), {
      mandato: m, perfil, objetivo: 'MENSAJES', placement: 'instagram', adAccountId: ACT, presupuestoDeseadoMinor: 15000,
      rondasObservaciones: [[{ adRef: 'a1', impresiones: 10000, clics: 400, gastoMinor: 180000, resultados: 40, ventanaHoras: 24 }]],
    });
    const recs = res.rondas.flatMap((r) => r.shadow.recomendacionesFinancieras);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs.every((x) => x.estado === 'AWAITING_HUMAN_APPROVAL' && x.autoAplicable === false)).toBe(true);
    expect(res.invarianteGlobalOk).toBe(true);
  });
});
