/**
 * SAFE ACTION PLANE — persistencia PG real: mandato roundtrip (dinero bigint), ledger idempotente
 * atómico, aislamiento por tenant, y procesarAccion sobre el ledger PG (idempotencia + techo).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { runMigrations } from '@soec/event-store/pg';
import { accionMigrations, crearReposAccion } from '../src/accion/accion-pg';
import { crearMandatoAutorizado } from '../src/accion/mandato';
import { procesarAccion } from '../src/accion/action-plane';
import type { AccionPropuesta } from '../src/accion/budget-guard';

const pool = makeTestPool();
const { mandatoRepo, ledgerRepo } = crearReposAccion(pool);
const AHORA = '2026-08-18T12:00:00.000Z';

function mandato(org: string, id: string) {
  return crearMandatoAutorizado({ organizationId: org, objective: 'x', currency: 'CLP', authorizedBudgetMinor: 300000, periodStart: '2026-08-18T00:00:00.000Z', periodEnd: '2026-09-18T00:00:00.000Z', allowedMetaAssets: ['act_1'], allowedActionTypes: ['CREATE_CAMPAIGN'] }, 'user-owner', id, AHORA);
}
const accion = (org: string, mandatoId: string, over: Partial<AccionPropuesta> = {}): AccionPropuesta => ({ organizationId: org, mandatoId, idempotencyKey: 'k1', actionType: 'CREATE_CAMPAIGN', assetId: 'act_1', costMinor: 100000, currency: 'CLP', propuestaPor: 'director', ...over });

beforeEach(async () => {
  await runMigrations(pool, accionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate table accion_mandato, accion_ledger');
});
afterAll(async () => { await pool.end(); });

describe('accion PG · mandato', () => {
  it('roundtrip con dinero exacto (bigint) + actual() por tenant', async () => {
    await mandatoRepo.guardar(mandato('org-a', 'm-a'));
    const m = await mandatoRepo.obtener('org-a', 'm-a');
    expect(m!.authorizedBudgetMinor).toBe(300000);
    expect(m!.currency).toBe('CLP');
    expect((await mandatoRepo.actual('org-a'))!.id).toBe('m-a');
    expect(await mandatoRepo.actual('org-b')).toBeNull(); // aislamiento tenant
  });
});

describe('accion PG · ledger idempotente', () => {
  it('registrarSiNuevo: true una vez, false en replay (idempotencia atómica en DB)', async () => {
    const asiento = { id: 'a1', organizationId: 'org-a', mandatoId: 'm-a', idempotencyKey: 'dup', actionType: 'CREATE_CAMPAIGN', assetId: 'act_1', costMinor: 100000, currency: 'CLP', estado: 'SIMULADA' as const, modo: 'DRY_RUN' as const, bloqueos: [], propuestaPor: 'director', decidedAt: AHORA, effectRef: null };
    expect(await ledgerRepo.registrarSiNuevo(asiento)).toBe(true);
    expect(await ledgerRepo.registrarSiNuevo({ ...asiento, id: 'a2' })).toBe(false); // misma key ⇒ no inserta
    expect((await ledgerRepo.listar('org-a', 'm-a'))).toHaveLength(1);
  });

  it('procesarAccion sobre PG: misma key no doble-cobra; techo respetado (master switch ON)', async () => {
    let m = mandato('org-a', 'm-a');
    await mandatoRepo.guardar(m);
    const deps = { ledger: ledgerRepo, ahora: () => AHORA, autonomousReal: true, globalKillSwitch: false, nuevoId: () => Math.random().toString(36).slice(2) };
    const r1 = await procesarAccion(deps, m, accion('org-a', 'm-a', { idempotencyKey: 'x', costMinor: 100000 }));
    m = r1.mandatoActualizado; await mandatoRepo.guardar(m);
    const r2 = await procesarAccion(deps, m, accion('org-a', 'm-a', { idempotencyKey: 'x', costMinor: 100000 }));
    expect(r2.yaExistia).toBe(true);
    expect((await ledgerRepo.listar('org-a', 'm-a'))).toHaveLength(1);
    expect(m.spentMinor).toBe(100000); // una sola vez
    // Un gasto que superaría el techo ⇒ rechazado; spent no cambia.
    const over = await procesarAccion(deps, m, accion('org-a', 'm-a', { idempotencyKey: 'over', costMinor: 250000 }));
    expect(over.veredicto.permitido).toBe(false);
    expect(over.mandatoActualizado.spentMinor).toBe(100000);
  });
});
