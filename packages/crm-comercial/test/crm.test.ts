/**
 * @soec/crm-comercial · pruebas. Cubre: persistencia event-sourced y reconstrucción, aislamiento
 * multiempresa, idempotencia, scoring multidimensional con EVALUABILIDAD (no inventar donde falta
 * información) y recomendación EXPLICADA (razones + alternativas descartadas + qué falta) o
 * abstención honesta. Usa InMemoryEventStore.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import {
  CrmComercialService,
  ContactoNoEncontradoError,
  esRecomendacion,
  puntuarContacto,
  recomendarSiguientePaso,
} from '../src/index';

const attr: Attribution = { source: 'crm', purpose: 'test', assumptions: ['test'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
}
const ASOF = '2026-07-31T00:00:00.000Z';
const nuevo = (contactoId: string, nombre: string) => ({ contactoId, nombre, origen: 'DATO_DECLARADO_POR_USUARIO' as const });

function svc() {
  return new CrmComercialService(new InMemoryEventStore());
}

describe('@soec/crm-comercial · persistencia y aislamiento', () => {
  it('registra, acumula actividad y reconstruye el estado; el índice lista el contacto', async () => {
    const s = svc();
    await s.registrarContacto(ctx(), nuevo('c1', 'Ana'), attr, '2026-06-01T00:00:00.000Z');
    await s.registrarActividad(ctx(), 'c1', { actividadId: 'a1', tipo: 'CONSULTA', detalle: 'pregunta precio' }, attr, '2026-07-20T00:00:00.000Z');
    const estado = await s.cargarContacto(ctx(), 'c1');
    expect(estado.existe).toBe(true);
    expect(estado.nombre).toBe('Ana');
    expect(estado.actividades).toHaveLength(1);
    const idx = await s.listarContactos(ctx());
    expect(idx.contactos.map((c) => c.contactoId)).toEqual(['c1']);
  });

  it('registrar dos veces el mismo contacto es idempotente', async () => {
    const s = svc();
    await s.registrarContacto(ctx(), nuevo('c1', 'Ana'), attr, ASOF);
    await s.registrarContacto(ctx(), nuevo('c1', 'Ana (otra)'), attr, ASOF);
    const idx = await s.listarContactos(ctx());
    expect(idx.contactos).toHaveLength(1);
    const estado = await s.cargarContacto(ctx(), 'c1');
    expect(estado.nombre).toBe('Ana'); // no se sobrescribió
  });

  it('aislamiento multiempresa: un contacto de org-a no es visible ni operable desde org-b', async () => {
    const s = svc();
    await s.registrarContacto(ctx('org-a'), nuevo('c1', 'Ana'), attr, ASOF);
    const desdeB = await s.cargarContacto(ctx('org-b'), 'c1');
    expect(desdeB.existe).toBe(false);
    await expect(s.recomendar(ctx('org-b'), 'c1', ASOF)).rejects.toBeInstanceOf(ContactoNoEncontradoError);
    expect((await s.listarContactos(ctx('org-b'))).contactos).toHaveLength(0);
  });
});

describe('@soec/crm-comercial · scoring y evaluabilidad', () => {
  it('sin actividad: probabilidad de compra NO EVALUABLE y recomendación ABSTIENE (con faltantes)', async () => {
    const s = svc();
    await s.registrarContacto(ctx(), nuevo('c1', 'Ana'), attr, '2026-07-25T00:00:00.000Z');
    const estado = await s.cargarContacto(ctx(), 'c1');
    const p = puntuarContacto(estado, ASOF);
    expect(p.dimensiones.actividad.evaluable).toBe(false);
    expect(p.dimensiones.probabilidadCompra.evaluable).toBe(false);
    const rec = recomendarSiguientePaso(estado, p);
    expect(rec.tipo).toBe('ABSTENCION');
    if (!esRecomendacion(rec)) expect(rec.faltantes.length).toBeGreaterThan(0);
  });

  it('la prioridad NO es evaluable sin valor de referencia; SÍ lo es con él', async () => {
    const s = svc();
    await s.registrarContacto(ctx(), nuevo('c1', 'Ana'), attr, '2026-06-01T00:00:00.000Z');
    await s.registrarActividad(ctx(), 'c1', { actividadId: 'a1', tipo: 'CONSULTA', detalle: 'x' }, attr, '2026-07-20T00:00:00.000Z');
    const estado = await s.cargarContacto(ctx(), 'c1');
    const sinRef = puntuarContacto(estado, ASOF);
    expect(sinRef.dimensiones.valorEsperado.evaluable).toBe(false);
    expect(sinRef.dimensiones.prioridad.evaluable).toBe(false);
    const conRef = puntuarContacto(estado, ASOF, { valorReferencia: 200000 });
    expect(conRef.dimensiones.valorEsperado.evaluable).toBe(true);
    expect(conRef.dimensiones.prioridad.evaluable).toBe(true);
    expect(conRef.dimensiones.prioridad.valor).not.toBeNull();
  });

  it('cada dimensión evaluable trae factores que la justifican', async () => {
    const s = svc();
    await s.registrarContacto(ctx(), nuevo('c1', 'Ana'), attr, '2026-06-01T00:00:00.000Z');
    await s.registrarActividad(ctx(), 'c1', { actividadId: 'a1', tipo: 'CONSULTA', detalle: 'x' }, attr, '2026-07-20T00:00:00.000Z');
    const estado = await s.cargarContacto(ctx(), 'c1');
    const p = puntuarContacto(estado, ASOF);
    expect(p.dimensiones.actividad.factores.length).toBeGreaterThan(0);
    expect(p.dimensiones.interes.factores.length).toBeGreaterThan(0);
  });
});

describe('@soec/crm-comercial · recomendación explicada', () => {
  it('interesado sin compra → oferta; con alternativas descartadas motivadas y qué falta', async () => {
    const s = svc();
    await s.registrarContacto(ctx(), nuevo('c1', 'Ana'), attr, '2026-06-01T00:00:00.000Z');
    await s.registrarActividad(ctx(), 'c1', { actividadId: 'a1', tipo: 'CONSULTA', detalle: 'precio' }, attr, '2026-07-20T00:00:00.000Z');
    await s.registrarActividad(ctx(), 'c1', { actividadId: 'a2', tipo: 'RESPUESTA_POSITIVA', detalle: 'interesada' }, attr, '2026-07-22T00:00:00.000Z');
    const rec = await s.recomendar(ctx(), 'c1', ASOF);
    expect(esRecomendacion(rec)).toBe(true);
    if (esRecomendacion(rec)) {
      expect(rec.accion).toContain('oferta');
      expect(rec.razones.length).toBeGreaterThan(0);
      expect(rec.evidenciaUsada.length).toBeGreaterThan(0);
      expect(rec.alternativasDescartadas.length).toBeGreaterThan(0);
      expect(rec.alternativasDescartadas.every((a) => a.motivo.trim().length > 0)).toBe(true);
      // honestidad: aunque recomiende, declara que falta el valor de referencia para priorizar
      expect(rec.queFalta.length).toBeGreaterThan(0);
    }
  });

  it('cliente con compra reciente → seguimiento post-venta', async () => {
    const s = svc();
    await s.registrarContacto(ctx(), nuevo('c2', 'Beto'), attr, '2026-05-01T00:00:00.000Z');
    await s.registrarActividad(ctx(), 'c2', { actividadId: 'a1', tipo: 'COMPRA', detalle: 'plan', valor: 120000 }, attr, '2026-07-15T00:00:00.000Z');
    const rec = await s.recomendar(ctx(), 'c2', ASOF, { valorReferencia: 200000 });
    expect(esRecomendacion(rec)).toBe(true);
    if (esRecomendacion(rec)) expect(rec.accion).toContain('post-venta');
  });
});
