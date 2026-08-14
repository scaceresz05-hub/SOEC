/**
 * SOEC · AUTONOMÍA · LEDGER DE EJECUCIÓN sobre PostgreSQL REAL (A0.6 · sección 6).
 *
 * Prueba que la idempotencia y la garantía de UNA sola ejecución lógica NO dependen de un
 * InMemoryEventStore de test: sobre `soec_test` (Postgres) real, con dos instancias/procesos lógicos
 * compitiendo por el mismo `actionId`, y con un «reinicio» (instancia nueva leyendo el mismo store).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { PgEventStore, runMigrations } from '@soec/event-store/pg';
import { ejecutarDestructivoDePrueba, makeTestPool } from '@soec/event-store/test-db';
import { LedgerEjecucion } from '@soec/autonomia';

const AHORA = '2026-08-14T12:00:00.000Z';
const ORG = 'org-smileflow';
const pool = makeTestPool();

function ctx(): RequestContext {
  const o = OrganizationId(ORG);
  return { organizationId: o, actor: ActorId('ledger-test'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}

beforeEach(async () => {
  await runMigrations(pool);
  await ejecutarDestructivoDePrueba(pool, 'truncate table events, outbox restart identity cascade');
});
afterAll(async () => {
  await pool.end();
});

describe('Ledger de ejecución · PostgreSQL real', () => {
  it('ONE_LOGICAL_RESERVATION: dos procesos reservan el mismo actionId ⇒ una sola reserva', async () => {
    // Dos instancias del servicio = dos «procesos» sobre el MISMO Postgres.
    const p1 = new LedgerEjecucion(new PgEventStore(pool));
    const p2 = new LedgerEjecucion(new PgEventStore(pool));
    const res = await Promise.all([p1.reservar(ctx(), 'accion-x', AHORA), p2.reservar(ctx(), 'accion-x', AHORA)]);
    expect(res.filter((r) => r === 'RESERVED')).toHaveLength(1);
    expect(res.filter((r) => r === 'DUPLICATE')).toHaveLength(1);
    // Y en el store real hay UN solo evento de reserva.
    const c = ctx();
    const eventos = await new PgEventStore(pool).readStream(c, `autonomia-ejecuciones:${ORG}`);
    expect(eventos).toHaveLength(1);
  });

  it('NO_DUPLICATE_AFTER_RESTART: una instancia nueva lee lo reservado y no re-ejecuta', async () => {
    await new LedgerEjecucion(new PgEventStore(pool)).reservar(ctx(), 'accion-y', AHORA);
    // «Reinicio»: proceso nuevo, sin memoria, leyendo el mismo Postgres persistido.
    const trasReinicio = new LedgerEjecucion(new PgEventStore(pool));
    expect(await trasReinicio.yaEjecutadas(ctx())).toContain('accion-y');
    expect(await trasReinicio.reservar(ctx(), 'accion-y', AHORA)).toBe('DUPLICATE');
  });

  it('TENANT_SCOPED: el mismo actionId en otra organización es una reserva independiente', async () => {
    const led = new LedgerEjecucion(new PgEventStore(pool));
    const otra: RequestContext = { ...ctx(), organizationId: OrganizationId('org-cyp'), scope: { organizationId: OrganizationId('org-cyp'), permissions: ['events:append', 'events:read'] } };
    expect(await led.reservar(ctx(), 'accion-z', AHORA)).toBe('RESERVED');
    expect(await led.reservar(otra, 'accion-z', AHORA)).toBe('RESERVED'); // otra org: independiente
  });
});
