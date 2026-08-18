/**
 * SAFE ACTION PLANE (V2-A) — matriz ADVERSARIAL. Prueba las garantías constitucionales:
 *   BUDGET_CAP_BYPASS = IMPOSSIBLE_BY_DESIGN · CROSS_TENANT_ACTION = BLOCKED · UNAUTHORIZED_ACTION = BLOCKED
 *   KILL_SWITCH = PASS · AUDIT_LEDGER = PASS · IDEMPOTENCY = PASS · REAL_MONEY_SPENT_WITHOUT_HUMAN = 0.
 */
import { describe, expect, it } from 'vitest';
import { crearMandatoAutorizado, reautorizar, fijarKillSwitch, AutorizacionInvalidaError, type Mandato } from '../src/accion/mandato';
import { procesarAccion, type DepsActionPlane } from '../src/accion/action-plane';
import { InMemoryActionLedgerRepo } from '../src/accion/ledger';
import type { AccionPropuesta } from '../src/accion/budget-guard';

const AHORA = '2026-08-18T12:00:00.000Z';
const HUMANO = 'user-8b1a-owner';

function mandato(): Mandato {
  return crearMandatoAutorizado(
    { organizationId: 'smileflow', objective: 'más pacientes', currency: 'CLP', authorizedBudgetMinor: 300000, periodStart: '2026-08-18T00:00:00.000Z', periodEnd: '2026-09-18T00:00:00.000Z', allowedMetaAssets: ['act_1037025024374407'], allowedActionTypes: ['CREATE_CAMPAIGN', 'CREATE_AD', 'PAUSE_AD'] },
    HUMANO, 'mandate-1', AHORA,
  );
}
function accion(over: Partial<AccionPropuesta> = {}): AccionPropuesta {
  return { organizationId: 'smileflow', mandatoId: 'mandate-1', idempotencyKey: 'k1', actionType: 'CREATE_CAMPAIGN', assetId: 'act_1037025024374407', costMinor: 100000, currency: 'CLP', propuestaPor: 'director', ...over };
}
function deps(autonomousReal = false, ledger = new InMemoryActionLedgerRepo(), globalKillSwitch = false, ahora = AHORA): DepsActionPlane {
  let n = 0;
  return { ledger, ahora: () => ahora, autonomousReal, globalKillSwitch, nuevoId: () => `a${++n}` };
}

describe('action plane · master switch + dry-run (V2-A)', () => {
  it('autonomousReal=false ⇒ toda acción es SIMULADA (DRY_RUN), sin comprometer gasto', async () => {
    const r = await procesarAccion(deps(false), mandato(), accion());
    expect(r.veredicto.permitido).toBe(true);
    expect(r.veredicto.modo).toBe('DRY_RUN');
    expect(r.asiento.estado).toBe('SIMULADA');
    expect(r.gastoComprometidoMinor).toBe(0);
    expect(r.mandatoActualizado.spentMinor).toBe(0);
  });
});

describe('BUDGET_CAP_BYPASS = IMPOSSIBLE_BY_DESIGN (con master switch REAL ON)', () => {
  it('acción única sobre el techo ⇒ RECHAZADA (TECHO_PRESUPUESTO)', async () => {
    const r = await procesarAccion(deps(true), mandato(), accion({ costMinor: 400000 }));
    expect(r.veredicto.permitido).toBe(false);
    expect(r.veredicto.bloqueos).toContain('TECHO_PRESUPUESTO');
    expect(r.asiento.estado).toBe('RECHAZADA');
    expect(r.mandatoActualizado.spentMinor).toBe(0);
  });

  it('fraccionar en muchas acciones NO supera el techo (gasto acumulado)', async () => {
    const d = deps(true);
    let m = mandato(); // techo 300000
    for (let i = 1; i <= 3; i++) {
      const r = await procesarAccion(d, m, accion({ idempotencyKey: `k${i}`, costMinor: 100000 }));
      m = r.mandatoActualizado;
    }
    expect(m.spentMinor).toBe(300000); // 3×100000 = exactamente el techo
    expect(m.status).toBe('EXHAUSTED');
    // Un cuarto gasto de 1 ⇒ RECHAZADO; el techo NO se supera.
    const extra = await procesarAccion(d, m, accion({ idempotencyKey: 'k4', costMinor: 1 }));
    expect(extra.veredicto.permitido).toBe(false);
    expect(extra.mandatoActualizado.spentMinor).toBe(300000);
    expect(extra.mandatoActualizado.spentMinor).toBeLessThanOrEqual(m.authorizedBudgetMinor);
  });

  it('cambiar la moneda no evade el techo ⇒ MONEDA bloquea', async () => {
    const r = await procesarAccion(deps(true), mandato(), accion({ currency: 'USD', costMinor: 1 }));
    expect(r.veredicto.bloqueos).toContain('MONEDA');
    expect(r.veredicto.permitido).toBe(false);
  });

  it('acción fuera del período no ejecuta ⇒ PERIODO_VIGENTE/MANDATO_ACTIVE bloquean', async () => {
    const r = await procesarAccion(deps(true, new InMemoryActionLedgerRepo(), false, '2026-10-01T00:00:00.000Z'), mandato(), accion());
    expect(r.veredicto.permitido).toBe(false);
    expect(r.veredicto.bloqueos).toEqual(expect.arrayContaining(['PERIODO_VIGENTE', 'MANDATO_ACTIVE']));
  });

  it('tipos financieros prohibidos (INCREASE_BUDGET/RAISE_CAP) ⇒ ACCION_WHITELISTED bloquea', async () => {
    for (const t of ['INCREASE_BUDGET', 'RAISE_CAP', 'RENEW_BUDGET', 'EXTEND_PERIOD']) {
      const r = await procesarAccion(deps(true), mandato(), accion({ actionType: t, idempotencyKey: `f-${t}` }));
      expect(r.veredicto.bloqueos).toContain('ACCION_WHITELISTED');
    }
  });

  it('costo negativo o no entero ⇒ bloqueado', async () => {
    expect((await procesarAccion(deps(true), mandato(), accion({ costMinor: -1, idempotencyKey: 'neg' }))).veredicto.bloqueos).toContain('COSTO_ENTERO_NO_NEGATIVO');
    expect((await procesarAccion(deps(true), mandato(), accion({ costMinor: 1.5, idempotencyKey: 'flt' }))).veredicto.bloqueos).toContain('COSTO_ENTERO_NO_NEGATIVO');
  });

  it('acción no pagada con costo > 0 ⇒ COSTO_ORGANICO_CERO bloquea', async () => {
    const r = await procesarAccion(deps(true), mandato(), accion({ actionType: 'PAUSE_AD', costMinor: 5, idempotencyKey: 'pc' }));
    expect(r.veredicto.bloqueos).toContain('COSTO_ORGANICO_CERO');
  });
});

describe('SOEC no puede autorizarse (soberanía financiera humana)', () => {
  it('crear/reautorizar con actor de sistema ⇒ AutorizacionInvalidaError', () => {
    for (const sys of ['soec', 'director', 'meta-scheduler', 'system', 'action-plane']) {
      expect(() => crearMandatoAutorizado({ organizationId: 'o', objective: 'x', currency: 'CLP', authorizedBudgetMinor: 100, periodStart: '2026-08-18T00:00:00.000Z', periodEnd: '2026-09-18T00:00:00.000Z', allowedMetaAssets: [], allowedActionTypes: ['CREATE_AD'] }, sys, 'm', AHORA)).toThrow(AutorizacionInvalidaError);
    }
    expect(() => reautorizar(mandato(), 999999, '2026-12-01T00:00:00.000Z', 'soec', AHORA)).toThrow(AutorizacionInvalidaError);
  });
  it('reautorización HUMANA amplía el techo; no baja del gasto ya hecho', () => {
    const m = { ...mandato(), spentMinor: 200000 };
    const r = reautorizar(m, 500000, '2026-12-01T00:00:00.000Z', HUMANO, AHORA);
    expect(r.authorizedBudgetMinor).toBe(500000);
    expect(r.version).toBe(2);
    expect(() => reautorizar(m, 100000, '2026-12-01T00:00:00.000Z', HUMANO, AHORA)).toThrow(AutorizacionInvalidaError); // < gastado
  });
});

describe('CROSS_TENANT + UNAUTHORIZED + KILL_SWITCH', () => {
  it('cross-tenant ⇒ TENANT bloquea', async () => {
    const r = await procesarAccion(deps(true), mandato(), accion({ organizationId: 'otra-org' }));
    expect(r.veredicto.bloqueos).toContain('TENANT');
  });
  it('acción/activo no autorizados por el mandato ⇒ bloqueado', async () => {
    expect((await procesarAccion(deps(true), mandato(), accion({ actionType: 'START_AB_TEST', idempotencyKey: 'ab' }))).veredicto.bloqueos).toContain('ACCION_AUTORIZADA');
    expect((await procesarAccion(deps(true), mandato(), accion({ assetId: 'act_999', idempotencyKey: 'as' }))).veredicto.bloqueos).toContain('ACTIVO_AUTORIZADO');
  });
  it('kill switch de mandato o global ⇒ bloqueado', async () => {
    const rk = await procesarAccion(deps(true), fijarKillSwitch(mandato(), true, AHORA), accion());
    expect(rk.veredicto.bloqueos).toContain('KILL_SWITCH_OFF');
    const rg = await procesarAccion(deps(true, new InMemoryActionLedgerRepo(), true), mandato(), accion({ idempotencyKey: 'g1' }));
    expect(rg.veredicto.bloqueos).toContain('KILL_SWITCH_OFF');
  });
});

describe('AUDIT_LEDGER + IDEMPOTENCY', () => {
  it('cada decisión queda en el ledger (simulada/ejecutada/rechazada)', async () => {
    const led = new InMemoryActionLedgerRepo();
    const d = deps(true, led);
    await procesarAccion(d, mandato(), accion({ idempotencyKey: 'ok', costMinor: 100000 }));
    await procesarAccion(d, mandato(), accion({ idempotencyKey: 'bad', costMinor: 999999 }));
    const asientos = await led.listar('smileflow', 'mandate-1');
    expect(asientos).toHaveLength(2);
    expect(asientos.map((a) => a.estado).sort()).toEqual(['EJECUTADA', 'RECHAZADA']);
  });
  it('misma idempotencyKey dos veces ⇒ no duplica ni doble-cobra', async () => {
    const led = new InMemoryActionLedgerRepo();
    const d = deps(true, led);
    let m = mandato();
    const r1 = await procesarAccion(d, m, accion({ idempotencyKey: 'dup', costMinor: 100000 }));
    m = r1.mandatoActualizado;
    const r2 = await procesarAccion(d, m, accion({ idempotencyKey: 'dup', costMinor: 100000 }));
    expect(r2.yaExistia).toBe(true);
    expect(r2.gastoComprometidoMinor).toBe(0);
    expect((await led.listar('smileflow', 'mandate-1'))).toHaveLength(1);
    expect(m.spentMinor).toBe(100000); // una sola vez
  });
});

describe('mandato inmutable (el action plane nunca cambia techo/moneda/período)', () => {
  it('tras ejecutar, authorizedBudget/currency/period no cambian; sólo spent/status', async () => {
    const m0 = mandato();
    const r = await procesarAccion(deps(true), m0, accion({ costMinor: 100000 }));
    expect(r.mandatoActualizado.authorizedBudgetMinor).toBe(m0.authorizedBudgetMinor);
    expect(r.mandatoActualizado.currency).toBe(m0.currency);
    expect(r.mandatoActualizado.periodEnd).toBe(m0.periodEnd);
    expect(r.mandatoActualizado.spentMinor).toBe(100000);
  });
});
