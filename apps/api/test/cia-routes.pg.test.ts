/**
 * apps/api · tests · RUTAS CIA sobre PostgreSQL (BLOQUE 7). Prueba el camino de API completo contra el
 * EventStore real: autorizar/planificar/leer por HTTP, y que el estado sobrevive a un "reinicio" (una app
 * nueva sobre un PgEventStore nuevo, misma base). Sin proveedores/red/credenciales reales.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { runMigrations, migrations, PgEventStore } from '@soec/event-store/pg';
import { registerCiaRoutes } from '../src/cia-routes';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';

const pool = makeTestPool();
const H = {
  'x-organization-id': 'org-api',
  'x-actor-id': 'director',
  'x-scope': 'events:append,events:read',
};

function app(): FastifyInstance {
  const f = Fastify();
  registerCiaRoutes(f, new PgEventStore(pool));
  return f;
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

describe('apps/api · CIA sobre PostgreSQL (HTTP + reinicio)', () => {
  it('autoriza y planifica por HTTP; el estado persiste y se lee tras reiniciar', async () => {
    const a1 = app();
    const auth = await a1.inject({
      method: 'POST',
      url: '/api/cia/autorizaciones/captar-clientes-publicidad',
      headers: H,
      payload: { limite: 100000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: 'humano-1' },
    });
    expect(auth.statusCode).toBe(200);
    expect(auth.json().datos.estado).toBe('AUTORIZADA');

    const plan = await a1.inject({
      method: 'POST',
      url: '/api/cia/planes',
      headers: H,
      payload: {
        planId: 'pa',
        capacidadId: 'captar-clientes-publicidad',
        objetivo: 'pacientes',
        costoEstimado: 4000,
      },
    });
    expect(plan.json().datos.plan.estado).toBe('COMPLETADO_SIMULADO');
    await a1.close();

    // "reinicio": app nueva, PgEventStore nuevo, misma base
    const a2 = app();
    const inicio = await a2.inject({ method: 'GET', url: '/api/cia/inicio', headers: H });
    expect(inicio.statusCode).toBe(200);
    const capacidades = inicio.json().datos.capacidades as Array<{
      capacidadId: string;
      estado: string;
    }>;
    expect(
      capacidades.some(
        (c) => c.capacidadId === 'captar-clientes-publicidad' && c.estado === 'Activa',
      ),
    ).toBe(true);

    // la vista de usuario (explicación) no filtra proveedor; la auditoría sí
    const exp = await a2.inject({
      method: 'GET',
      url: '/api/cia/planes/pa/explicacion',
      headers: H,
    });
    expect(JSON.stringify(exp.json().datos)).not.toContain('ads-');
    const audit = await a2.inject({
      method: 'GET',
      url: '/api/cia/planes/pa/auditoria',
      headers: H,
    });
    expect(audit.json().datos.proveedorElegidoRef).toBeTruthy();
    await a2.close();
  });

  it('el catálogo HTTP no expone proveedores comerciales', async () => {
    const a = app();
    const r = await a.inject({ method: 'GET', url: '/api/cia/catalogo', headers: H });
    const serial = JSON.stringify(r.json().datos).toLowerCase();
    for (const marca of ['meta', 'google', 'mailchimp', 'hubspot', 'tiktok'])
      expect(serial.includes(marca)).toBe(false);
    await a.close();
  });

  it('exige encabezados de organización/actor (401 sin ellos)', async () => {
    const a = app();
    const r = await a.inject({ method: 'GET', url: '/api/cia/inicio' });
    expect(r.statusCode).toBe(401);
    await a.close();
  });

  it('el kill-switch por HTTP frena una nueva planificación', async () => {
    const a = app();
    await a.inject({
      method: 'POST',
      url: '/api/cia/autorizaciones/dar-a-conocer-marca',
      headers: H,
      payload: { limite: 100000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: 'humano-1' },
    });
    await a.inject({ method: 'POST', url: '/api/cia/autonomia/kill/ORG', headers: H });
    const plan = await a.inject({
      method: 'POST',
      url: '/api/cia/planes',
      headers: H,
      payload: {
        planId: 'pk',
        capacidadId: 'dar-a-conocer-marca',
        objetivo: 'x',
        costoEstimado: 10,
      },
    });
    expect(plan.json().datos.decision.motivo).toBe('kill_switch');
    await a.close();
  });
});
