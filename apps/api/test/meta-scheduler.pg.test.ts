/**
 * SCHEDULER · repo PG sobre PostgreSQL REAL: elegibilidad (join a meta_connection), claim ATÓMICO de
 * concurrencia, cadencia (nextEligibleSyncAt), ON/OFF por organización y aislamiento por tenant.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { runMigrations } from '@soec/event-store/pg';
import { metaOAuthMigrations, crearRepositoriosMetaPg } from '../src/acquisition/meta-oauth-pg';
import { metaSyncMigrations, crearMetaScheduleRepo } from '../src/acquisition/meta-sync-pg';
import type { ScheduleRow } from '../src/acquisition/meta-scheduler';

const pool = makeTestPool();
const repo = crearMetaScheduleRepo(pool);
const repos = crearRepositoriosMetaPg(pool);
const T0 = '2026-08-17T12:00:00.000Z';

async function conectar(org: string, estado = 'CONNECTED_READ_ONLY'): Promise<void> {
  await repos.connRepo.guardar({
    conexion: { organizationId: org, provider: 'meta', connectionId: `meta-${org}`, estado: estado as 'CONNECTED_READ_ONLY', salud: 'HEALTHY', bindings: [], credencialRef: `file:${org}/x` },
    candidatos: [],
  });
}

beforeEach(async () => {
  await runMigrations(pool, metaOAuthMigrations);
  await runMigrations(pool, metaSyncMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate table meta_connection, meta_sync_schedule');
});
afterAll(async () => {
  await pool.end();
});

describe('scheduler repo (PG)', () => {
  it('elegibles = sólo CONNECTED_READ_ONLY (BINDING_PENDING no aparece)', async () => {
    await conectar('org-a', 'CONNECTED_READ_ONLY');
    await conectar('org-b', 'BINDING_PENDING');
    const e = await repo.listarElegibles(T0, 20);
    expect(e.map((x) => x.organizationId)).toEqual(['org-a']);
  });

  it('claim ATÓMICO: dos reclamos concurrentes ⇒ exactamente uno gana', async () => {
    await conectar('org-a');
    const [a, b] = await Promise.all([repo.reclamar('org-a', 'meta-org-a', T0, 60_000), repo.reclamar('org-a', 'meta-org-a', T0, 60_000)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('tras actualizar con nextEligible futuro ⇒ ya no elegible; caducado ⇒ vuelve', async () => {
    await conectar('org-a');
    await repo.reclamar('org-a', 'meta-org-a', T0, 60_000);
    const row: ScheduleRow = { organizationId: 'org-a', connectionId: 'meta-org-a', syncEnabled: true, lastAttemptAt: T0, lastSuccessfulSyncAt: T0, nextEligibleSyncAt: '2026-08-17T15:00:00.000Z', consecutiveFailures: 0, lastErrorClass: 'NONE', capabilitiesAffected: [], lockedUntil: null };
    await repo.actualizar(row);
    expect(await repo.listarElegibles('2026-08-17T14:00:00.000Z', 20)).toHaveLength(0); // aún fresco
    expect((await repo.listarElegibles('2026-08-17T16:00:00.000Z', 20)).length).toBe(1); // caducó
  });

  it('ON/OFF por organización: deshabilitada no aparece', async () => {
    await conectar('org-a');
    await repo.configurar('org-a', 'meta-org-a', false);
    expect(await repo.listarElegibles(T0, 20)).toHaveLength(0);
    await repo.configurar('org-a', 'meta-org-a', true);
    expect((await repo.listarElegibles(T0, 20)).length).toBe(1);
  });

  it('lock vigente bloquea re-claim hasta expirar', async () => {
    await conectar('org-a');
    expect(await repo.reclamar('org-a', 'meta-org-a', T0, 60_000)).toBe(true);
    expect(await repo.reclamar('org-a', 'meta-org-a', '2026-08-17T12:00:30.000Z', 60_000)).toBe(false); // lock vigente
    expect(await repo.reclamar('org-a', 'meta-org-a', '2026-08-17T12:02:00.000Z', 60_000)).toBe(true); // lock expiró
  });
});
