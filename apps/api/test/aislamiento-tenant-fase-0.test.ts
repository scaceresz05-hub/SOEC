/**
 * Autonomy Fase 0 · AISLAMIENTO MULTI-TENANT (contratos negativos).
 *
 * Dos fugas confirmadas por la auditoría, cerradas aquí:
 *   1. `GET /plataforma/negocios` devolvía TODAS las organizaciones del registro a cualquier usuario
 *      autenticado (`filtradoPorMembresia: false`).
 *   2. Las rutas de programas tomaban la organización de la URL o del cuerpo, no del contexto autenticado.
 *
 * La autoridad de tenant es SIEMPRE la cabecera que inyecta el gateway tras validar la membresía; lo que
 * llega en la URL o el cuerpo es una pretensión del cliente, nunca una autorización.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, FixedClock } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

const JSON_H = { 'content-type': 'application/json' };
const A = 'org-smileflow';
const B = 'org-cp-odontologia';
/** Cabeceras tal como las inyecta el gateway vertical tras validar la membresía. */
const cab = (org: string, permisos = 'business.read,business.manage') => ({
  ...JSON_H, 'x-organization-id': org, 'x-actor-id': 'owner', 'x-scope': 'events:read,events:append', 'x-permissions': permisos,
});

/**
 * La superficie vertical se monta aquí con `legacyDemoAccess` porque sin `pool` no hay gateway autenticado en
 * un test unitario. Da igual para lo que se prueba: los guards comparan contra la cabecera de organización, y
 * estos casos SIEMPRE la envían. Es decir, se prueba la ruta más permisiva posible; en producción, además, el
 * gateway exige sesión y membresía antes de llegar aquí.
 */
function app() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true, clock: new FixedClock(new Date('2026-09-21T12:00:00.000Z')) });
}

describe('/plataforma/negocios · una organización no ve a las demás', () => {
  it('devuelve SÓLO la organización del contexto autenticado y lo declara', async () => {
    const a = app();
    const r = await a.inject({ method: 'GET', url: '/plataforma/negocios', headers: cab(A) });
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v.filtradoPorMembresia).toBe(true);
    expect(v.negocios.map((n: { organizationId: string }) => n.organizationId)).toEqual([A]);
    await a.close();
  });

  it('la organización B no aparece en la lista de A, ni al revés', async () => {
    const a = app();
    const deA = (await a.inject({ method: 'GET', url: '/plataforma/negocios', headers: cab(A) })).json();
    const deB = (await a.inject({ method: 'GET', url: '/plataforma/negocios', headers: cab(B) })).json();
    expect(JSON.stringify(deA)).not.toContain(B);
    expect(JSON.stringify(deB)).not.toContain(A);
    await a.close();
  });

  it('sin contexto de organización ⇒ 403 (la ausencia de sesión nunca autoriza)', async () => {
    const a = app();
    const r = await a.inject({ method: 'GET', url: '/plataforma/negocios', headers: JSON_H });
    expect(r.statusCode).toBe(403);
    await a.close();
  });
});

describe('programas · la organización de la URL o del cuerpo no es autoridad', () => {
  const BASE = '/experience/director-autonomo/organizaciones';

  it('A no puede registrar un negocio a nombre de B', async () => {
    const a = app();
    const r = await a.inject({ method: 'POST', url: BASE, headers: cab(A), payload: { org: B, negocio: { nombre: 'ajena', descripcion: '', industria: '', pais: 'CL', moneda: 'CLP', zonaHoraria: 'UTC' } } });
    expect(r.statusCode).toBe(403);
    await a.close();
  });

  it('A no puede leer ni listar los programas de B', async () => {
    const a = app();
    for (const url of [`${BASE}/${B}`, `${BASE}/${B}/programas`]) {
      const r = await a.inject({ method: 'GET', url, headers: cab(A) });
      expect(r.statusCode, url).toBe(403);
    }
    await a.close();
  });

  it('A no puede crear ni ejecutar un programa de B', async () => {
    const a = app();
    const crear = await a.inject({ method: 'POST', url: `${BASE}/${B}/programas`, headers: cab(A), payload: { nombre: 'ajeno' } });
    expect(crear.statusCode).toBe(403);
    const ejecutar = await a.inject({ method: 'POST', url: `${BASE}/${B}/programas/p1/ejecutar-ciclo`, headers: cab(A), payload: {} });
    expect(ejecutar.statusCode).toBe(403);
    const pausar = await a.inject({ method: 'POST', url: `${BASE}/${B}/programas/p1/pausar`, headers: cab(A), payload: { motivo: 'x' } });
    expect(pausar.statusCode).toBe(403);
    await a.close();
  });

  it('cada organización sí opera sobre la suya, y el listado no mezcla tenants', async () => {
    const a = app();
    const propio = await a.inject({ method: 'POST', url: BASE, headers: cab(A), payload: { org: A, negocio: { nombre: 'SmileFlow', descripcion: '', industria: 'salud dental', pais: 'CL', moneda: 'CLP', zonaHoraria: 'America/Santiago' } } });
    expect(propio.statusCode).toBe(201);
    const listaA = await a.inject({ method: 'GET', url: BASE, headers: cab(A) });
    expect(listaA.json().organizaciones.map((o: { org: string }) => o.org)).toEqual([A]);
    const listaB = await a.inject({ method: 'GET', url: BASE, headers: cab(B) });
    expect(listaB.json().organizaciones).toEqual([]); // B no ve el negocio que registró A
    await a.close();
  });
});
