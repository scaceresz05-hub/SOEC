/**
 * @soec/adaptadores · M4-C-C · descriptor inmutable: huella canónica determinista, registro event-sourced
 * (idempotente por huella, versionado, acto humano), replay y aislamiento multi-tenant.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import {
  RegistroAdaptadoresService,
  AdaptadorInvalidoError,
  type ContenidoDescriptor,
  crearDescriptor,
  huellaDescriptor,
  descriptorSoportaReal,
  adaptadorStreamId,
  reconstruirAdaptador,
} from '../src/index';

const attr: Attribution = { source: 'pce', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const O = '2026-08-02T00:00:00.000Z';
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const compat = { contratoId: 'gen', versionesContratoSoportadas: ['1.0.0'], implementacionVersion: '1.0.0', evidenciaSchemaVersion: '1' };
const limites = { maxConcurrentesPorOrganizacion: 4, maxConcurrentesPorAdaptador: 2, maxConcurrentesPorCapacidad: 3, version: '1' };
const contenido = (soportaReal: boolean): ContenidoDescriptor => ({
  adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '1.0.0', evidenciaSchemaVersion: '1',
  capacidades: { soportaSimulado: true, soportaReal, soportaHealthCheck: true, soportaCancelacion: true, soportaTimeout: false },
});

describe('@soec/adaptadores · huella canónica', () => {
  it('reordenar propiedades NO cambia la huella', () => {
    const a = { adaptadorId: 'x', capacidadId: 'y', contratoId: 'c', contratoVersion: '1', implementacionVersion: '1', evidenciaSchemaVersion: '1', capacidades: { soportaSimulado: true, soportaReal: false, soportaHealthCheck: true, soportaCancelacion: true, soportaTimeout: false } };
    const b = { capacidades: { soportaTimeout: false, soportaCancelacion: true, soportaHealthCheck: true, soportaReal: false, soportaSimulado: true }, evidenciaSchemaVersion: '1', implementacionVersion: '1', contratoVersion: '1', contratoId: 'c', capacidadId: 'y', adaptadorId: 'x' };
    expect(huellaDescriptor(a)).toBe(huellaDescriptor(b as typeof a));
  });

  it('cambiar soportaReal SÍ cambia la huella', () => {
    expect(huellaDescriptor(contenido(false))).not.toBe(huellaDescriptor(contenido(true)));
  });

  it('crearDescriptor congela profundamente y fija huella + versión', () => {
    const d = crearDescriptor(contenido(false), 1);
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.capacidades)).toBe(true);
    expect(d.huella).toBe(huellaDescriptor(contenido(false)));
    expect(descriptorSoportaReal(d)).toBe(false);
  });
});

describe('@soec/adaptadores · registro event-sourced del descriptor', () => {
  async function registrado(store = new InMemoryEventStore()) {
    const s = new RegistroAdaptadoresService(store);
    await s.registrar(ctx(), 'gen-1', 'gen', 'gen', '1.0.0', '1.0.0', 'ana', attr, O);
    await s.configurar(ctx(), 'gen-1', { compatibilidad: compat, limites }, 'ana', attr, O);
    return s;
  }

  it('registra el descriptor y lo expone en el estado', async () => {
    const s = await registrado();
    const reg = await s.registrarDescriptor(ctx(), 'gen-1', contenido(false), 'ana-humana', attr, O);
    expect(reg.descriptor?.descriptorVersion).toBe(1);
    expect(descriptorSoportaReal(reg.descriptor)).toBe(false);
  });

  it('idempotente por huella (mismo contenido no crea versión nueva)', async () => {
    const s = await registrado();
    await s.registrarDescriptor(ctx(), 'gen-1', contenido(false), 'ana-humana', attr, O);
    const reg = await s.registrarDescriptor(ctx(), 'gen-1', contenido(false), 'ana-humana', attr, O);
    expect(reg.descriptor?.descriptorVersion).toBe(1);
  });

  it('un cambio real incrementa la versión (habilitar soportaReal)', async () => {
    const s = await registrado();
    await s.registrarDescriptor(ctx(), 'gen-1', contenido(false), 'ana-humana', attr, O);
    const reg = await s.registrarDescriptor(ctx(), 'gen-1', contenido(true), 'ana-humana', attr, O);
    expect(reg.descriptor?.descriptorVersion).toBe(2);
    expect(descriptorSoportaReal(reg.descriptor)).toBe(true);
  });

  it('exige actor humano', async () => {
    const s = await registrado();
    await expect(s.registrarDescriptor(ctx(), 'gen-1', contenido(false), '', attr, O)).rejects.toBeInstanceOf(AdaptadorInvalidoError);
  });

  it('rechaza descriptor de otro adaptador/capacidad', async () => {
    const s = await registrado();
    await expect(s.registrarDescriptor(ctx(), 'gen-1', { ...contenido(false), adaptadorId: 'otro' }, 'ana-humana', attr, O)).rejects.toBeInstanceOf(AdaptadorInvalidoError);
  });

  it('replay reconstruye descriptor + huella + versión', async () => {
    const store = new InMemoryEventStore();
    const s = await registrado(store);
    await s.registrarDescriptor(ctx(), 'gen-1', contenido(false), 'ana-humana', attr, O);
    await s.registrarDescriptor(ctx(), 'gen-1', contenido(true), 'ana-humana', attr, O);
    const eventos = await store.readStream(ctx(), adaptadorStreamId('org-a', 'gen-1'));
    const reg = reconstruirAdaptador('org-a', 'gen-1', eventos);
    expect(reg.descriptor?.descriptorVersion).toBe(2);
    expect(reg.descriptor?.huella).toBe(huellaDescriptor(contenido(true)));
  });

  it('aísla por organización', async () => {
    const store = new InMemoryEventStore();
    const s = await registrado(store);
    await s.registrarDescriptor(ctx('org-a'), 'gen-1', contenido(false), 'ana-humana', attr, O);
    expect((await s.cargar(ctx('org-b'), 'gen-1')).descriptor).toBeNull();
  });
});
