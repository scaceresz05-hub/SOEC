/**
 * Conocimiento de negocio: registro/lectura acotada por organización, tipología de
 * evidencia con confianza significativa, información faltante de primera clase, y —lo
 * central— AISLAMIENTO MULTIEMPRESA: una organización nunca ve ni escribe el conocimiento
 * de otra (pruebas negativas).
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { ConocimientoService, SeparacionVioladaError, confianzaPorDefecto } from '../src/index';

const now = '2026-07-25T12:00:00.000Z';
const attr: Attribution = {
  source: 'negocio',
  purpose: 'registrar conocimiento de negocio',
  assumptions: ['datos de prueba'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};
function ctxFor(org: string): RequestContext {
  const organizationId = OrganizationId(org);
  return {
    organizationId,
    actor: ActorId('director'),
    scope: { organizationId, permissions: ['events:append', 'events:read'] },
    correlationId: `c-${org}`,
  };
}
const montar = () => {
  const store = new InMemoryEventStore();
  return { store, svc: new ConocimientoService(store) };
};
const item = (organizacionId: string, over: Partial<Parameters<ConocimientoService['registrar']>[1]> = {}) => ({
  itemId: 'it-1',
  organizacionId,
  tipo: 'COMPETIDOR' as const,
  nombre: 'Competidor X',
  origen: 'DATO_DECLARADO_POR_USUARIO' as const,
  ...over,
});

describe('@soec/negocio · confianza por origen (no decorativa)', () => {
  it('la confianza tiene significado según el origen; hipótesis/simulación/desconocido → null', () => {
    expect(confianzaPorDefecto('HECHO_VERIFICADO')).toBe('ALTA');
    expect(confianzaPorDefecto('DATO_IMPORTADO')).toBe('MEDIA');
    expect(confianzaPorDefecto('ESTIMACION')).toBe('BAJA');
    expect(confianzaPorDefecto('HIPOTESIS')).toBeNull();
    expect(confianzaPorDefecto('SIMULACION')).toBeNull();
    expect(confianzaPorDefecto('DESCONOCIDO')).toBeNull();
  });
});

describe('@soec/negocio · registro y lectura acotada', () => {
  it('registra un ítem y lo devuelve con la confianza derivada del origen', async () => {
    const { svc } = montar();
    const ctx = ctxFor('smileflow');
    const st = await svc.registrar(ctx, item('smileflow', { origen: 'HECHO_VERIFICADO' }), attr, now);
    expect(st.items['it-1']!.nombre).toBe('Competidor X');
    expect(st.items['it-1']!.confianza).toBe('ALTA');
    expect(st.items['it-1']!.organizacionId).toBe('smileflow');
  });

  it('una hipótesis no adquiere confianza de hecho (queda null)', async () => {
    const { svc } = montar();
    const ctx = ctxFor('smileflow');
    const st = await svc.registrar(ctx, item('smileflow', { itemId: 'h1', tipo: 'PUBLICO', origen: 'HIPOTESIS' }), attr, now);
    expect(st.items['h1']!.confianza).toBeNull();
  });

  it('listar filtra por tipo', async () => {
    const { svc } = montar();
    const ctx = ctxFor('smileflow');
    await svc.registrar(ctx, item('smileflow', { itemId: 'c1', tipo: 'COMPETIDOR' }), attr, now);
    await svc.registrar(ctx, item('smileflow', { itemId: 'p1', tipo: 'PUBLICO' }), attr, now);
    expect((await svc.listar(ctx, 'PUBLICO')).map((i) => i.itemId)).toEqual(['p1']);
  });

  it('la información faltante es de primera clase', async () => {
    const { svc } = montar();
    const ctx = ctxFor('smileflow');
    const st = await svc.registrarFaltante(ctx, 'f1', 'público objetivo', 'no declarado por el usuario', attr, now);
    expect(st.faltantes['f1']!.sobre).toBe('público objetivo');
  });
});

describe('@soec/negocio · AISLAMIENTO MULTIEMPRESA (pruebas negativas)', () => {
  it('SmileFlow no puede consultar datos de SSR Control', async () => {
    const { svc } = montar();
    await svc.registrar(ctxFor('ssr-control'), item('ssr-control', { itemId: 'x1', nombre: 'dato SSR' }), attr, now);
    const desdeSmileflow = await svc.listar(ctxFor('smileflow'));
    expect(desdeSmileflow).toHaveLength(0);
  });

  it('un competidor registrado en una empresa NO es visible desde otra', async () => {
    const { svc } = montar();
    await svc.registrar(ctxFor('smileflow'), item('smileflow', { itemId: 'comp', nombre: 'Clínica Rival' }), attr, now);
    const desdeDistribuidora = await svc.listar(ctxFor('distribuidora-cyp'), 'COMPETIDOR');
    expect(desdeDistribuidora).toHaveLength(0);
    // Y sí visible desde su propia organización:
    expect((await svc.listar(ctxFor('smileflow'), 'COMPETIDOR')).map((i) => i.nombre)).toContain('Clínica Rival');
  });

  it('un faltante de una empresa no aparece en otra', async () => {
    const { svc } = montar();
    await svc.registrarFaltante(ctxFor('smileflow'), 'f1', 'precios', 'faltan', attr, now);
    expect(Object.keys((await svc.cargar(ctxFor('ssr-control'))).faltantes)).toHaveLength(0);
  });

  it('rechaza escribir conocimiento cuyo organizacionId no coincide con el contexto', async () => {
    const { svc } = montar();
    await expect(
      svc.registrar(ctxFor('smileflow'), item('ssr-control', { nombre: 'intruso' }), attr, now),
    ).rejects.toBeInstanceOf(SeparacionVioladaError);
  });
});
