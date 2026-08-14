/**
 * @soec/cia · tests · PERSISTENCIA PostgreSQL (BLOQUE 7). CIA corre sobre el EventStore PostgreSQL REAL
 * (`PgEventStore`, mismo del repo). Prueba el criterio: crear estado → "reiniciar" (servicios nuevos sobre un
 * PgEventStore nuevo, misma base) → reconstruir desde PostgreSQL → estado intacto. Multi-tenant y replay frío.
 * Sin proveedores/red/credenciales reales: sólo persistencia del estado SIMULADO.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, migrations, PgEventStore } from '@soec/event-store/pg';
import type { EventStore } from '@soec/contracts';
import {
  AutorizacionesService,
  KillSwitchService,
  PresupuestoService,
  PlanificadorService,
  LecturaIntegracionesService,
} from '../../src/index';
import { ctx, attr, O, HUMANO } from '../_setup';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';

const pool = makeTestPool();

function servicios(store: EventStore) {
  const autorizaciones = new AutorizacionesService(store);
  const kill = new KillSwitchService(store);
  const presupuesto = new PresupuestoService(store, autorizaciones);
  const planificador = new PlanificadorService(store, autorizaciones, kill, undefined, presupuesto);
  const lectura = new LecturaIntegracionesService(autorizaciones, planificador);
  return { autorizaciones, kill, presupuesto, planificador, lectura };
}

beforeAll(async () => {
  await runMigrations(pool, migrations);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await ejecutarDestructivoDePrueba(pool, 'truncate table events restart identity cascade');
});

const CAP = 'captar-clientes-publicidad';

describe('@soec/cia · persistencia PostgreSQL (reinicio → replay)', () => {
  it('una autorización persiste y se reconstruye tras reiniciar (nuevo store sobre el mismo PG)', async () => {
    const c = ctx('org-pg1');
    const s1 = servicios(new PgEventStore(pool));
    await s1.autorizaciones.autorizar(
      c,
      CAP,
      { limite: 300000, nivelAutonomia: 'EJECUTAR_CON_APROBACION', actorHumano: HUMANO },
      attr,
      O,
    );
    // "reinicio": servicios nuevos sobre un PgEventStore nuevo (misma base)
    const s2 = servicios(new PgEventStore(pool));
    const st = await s2.autorizaciones.cargar(c, CAP);
    expect(st.estado).toBe('AUTORIZADA');
    expect(st.autorizadaPor).toBe(HUMANO);
    expect(await s2.autorizaciones.listar(c)).toContain(CAP);
  });

  it('plan aprobado, consumo, pausa y kill-switch sobreviven al reinicio', async () => {
    const c = ctx('org-pg2');
    const s1 = servicios(new PgEventStore(pool));
    await s1.autorizaciones.autorizar(
      c,
      CAP,
      { limite: 100000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO },
      attr,
      O,
    );
    await s1.planificador.planificar(
      c,
      'plan-pg',
      { capacidadId: CAP, objetivo: 'x', costoEstimado: 4000 },
      attr,
      O,
    );
    await s1.kill.activar(c, 'ORG', attr, O);

    const s2 = servicios(new PgEventStore(pool));
    const plan = await s2.planificador.cargar(c, 'plan-pg');
    expect(plan.estado).toBe('COMPLETADO_SIMULADO'); // ejecutó (auto) antes del kill
    expect(await s2.presupuesto.confirmado(c, CAP)).toBe(4000); // consumo confirmado persistido
    expect((await s2.kill.cargar(c)).activos).toContain('ORG'); // kill persistido
    // el kill persistido frena un nuevo plan tras el reinicio
    const r = await s2.planificador.planificar(
      c,
      'plan-pg-2',
      { capacidadId: CAP, objetivo: 'y', costoEstimado: 10 },
      attr,
      O,
    );
    expect(r.decision.motivo).toBe('kill_switch');
  });

  it('aislamiento multi-tenant en PostgreSQL: una organización no ve la otra', async () => {
    const s = servicios(new PgEventStore(pool));
    await s.autorizaciones.autorizar(
      ctx('org-x'),
      CAP,
      { limite: 1, nivelAutonomia: 'RECOMENDAR', actorHumano: HUMANO },
      attr,
      O,
    );
    expect(await s.autorizaciones.listar(ctx('org-x'))).toContain(CAP);
    expect(await s.autorizaciones.listar(ctx('org-y'))).toEqual([]);
  });

  it('sustituir el adaptador tras el reinicio no cambia la vista de usuario (persistida)', async () => {
    const c = ctx('org-pg3');
    const s1 = servicios(new PgEventStore(pool));
    await s1.autorizaciones.autorizar(
      c,
      'enviar-correo',
      { limite: 1000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO },
      attr,
      O,
    );
    await s1.planificador.planificar(
      c,
      'pe',
      {
        capacidadId: 'enviar-correo',
        objetivo: 'x',
        costoEstimado: 100,
        proveedorOverride: 'correo-alfa',
      },
      attr,
      O,
    );
    const s2 = servicios(new PgEventStore(pool));
    const exp = await s2.lectura.explicacion(c, 'pe');
    const audit = await s2.lectura.auditoria(c, 'pe');
    expect(exp?.modo).toBe('simulado');
    expect(audit?.proveedorElegidoRef).toBe('correo-alfa'); // proveedor sólo en auditoría, persistido
  });
});
