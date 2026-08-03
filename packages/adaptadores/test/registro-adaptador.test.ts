/**
 * @soec/adaptadores · M4-C-B · registro event-sourced y ciclo de vida operativo. Máquina de estados sin
 * atajos, autorización humana, revocación/expiración/eliminación, multi-tenant, índice reparable y replay.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import {
  RegistroAdaptadoresService,
  TransicionAdaptadorInvalidaError,
  AdaptadorInvalidoError,
  RegistroAdaptadorNoEncontradoError,
  adaptadorStreamId,
  puedeConsumirOperativo,
  reconstruirAdaptador,
  EVENTOS_ADAPTADOR,
} from '../src/index';

const attr: Attribution = { source: 'pce', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const O = '2026-08-02T00:00:00.000Z';
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const compat = { contratoId: 'gen', versionesContratoSoportadas: ['1.0.0'], implementacionVersion: '1.0.0', evidenciaSchemaVersion: '1' };
const limites = { maxConcurrentesPorOrganizacion: 4, maxConcurrentesPorAdaptador: 2, maxConcurrentesPorCapacidad: 3, version: '1' };

async function hastaAutorizado(s: RegistroAdaptadoresService, c = ctx()) {
  await s.registrar(c, 'gen-1', 'gen', 'gen', '1.0.0', '1.0.0', 'ana', attr, O);
  await s.configurar(c, 'gen-1', { compatibilidad: compat, limites, secretRef: 'env:GEN' }, 'ana', attr, O);
  await s.habilitar(c, 'gen-1', 'ana', attr, O);
  await s.autorizar(c, 'gen-1', 'ana-humana', attr, O);
}

describe('@soec/adaptadores · ciclo de vida operativo', () => {
  it('nace REGISTRADO/SIMULADO; avanza a AUTORIZADO por actos gobernados', async () => {
    const s = new RegistroAdaptadoresService(new InMemoryEventStore());
    await s.registrar(ctx(), 'gen-1', 'gen', 'gen', '1.0.0', '1.0.0', 'ana', attr, O);
    let reg = await s.cargar(ctx(), 'gen-1');
    expect(reg.estado).toBe('REGISTRADO');
    expect(reg.modo).toBe('SIMULADO');
    await hastaAutorizado(s);
    reg = await s.cargar(ctx(), 'gen-1');
    expect(reg.estado).toBe('AUTORIZADO');
    expect(reg.modo).toBe('SIMULADO'); // AUTORIZADO no implica REAL
  });

  it('autorizar exige actor humano', async () => {
    const s = new RegistroAdaptadoresService(new InMemoryEventStore());
    await s.registrar(ctx(), 'gen-1', 'gen', 'gen', '1.0.0', '1.0.0', 'ana', attr, O);
    await s.configurar(ctx(), 'gen-1', { compatibilidad: compat, limites }, 'ana', attr, O);
    await s.habilitar(ctx(), 'gen-1', 'ana', attr, O);
    await expect(s.autorizar(ctx(), 'gen-1', '', attr, O)).rejects.toBeInstanceOf(AdaptadorInvalidoError);
  });

  it('no permite atajos (REGISTRADO → AUTORIZADO)', async () => {
    const s = new RegistroAdaptadoresService(new InMemoryEventStore());
    await s.registrar(ctx(), 'gen-1', 'gen', 'gen', '1.0.0', '1.0.0', 'ana', attr, O);
    await expect(s.autorizar(ctx(), 'gen-1', 'ana-humana', attr, O)).rejects.toBeInstanceOf(TransicionAdaptadorInvalidaError);
  });

  it('REAL exige acto humano y adaptador AUTORIZADO con secretRef', async () => {
    const s = new RegistroAdaptadoresService(new InMemoryEventStore());
    await hastaAutorizado(s);
    const reg = await s.activarReal(ctx(), 'gen-1', 'ana-humana', attr, O);
    expect(reg.modo).toBe('REAL');
  });

  it('revocación bloquea consumo y conserva motivo/historial', async () => {
    const s = new RegistroAdaptadoresService(new InMemoryEventStore());
    await hastaAutorizado(s);
    await s.revocar(ctx(), 'gen-1', 'clave comprometida', 'ana', attr, O);
    const reg = await s.cargar(ctx(), 'gen-1');
    expect(reg.estado).toBe('REVOCADO');
    expect(reg.revocadoMotivo).toBe('clave comprometida');
    expect(puedeConsumirOperativo(reg, O).ok).toBe(false);
  });

  it('expiración gobierna la ejecución (por estado o por expiraEn)', async () => {
    const s = new RegistroAdaptadoresService(new InMemoryEventStore());
    await s.registrar(ctx(), 'gen-1', 'gen', 'gen', '1.0.0', '1.0.0', 'ana', attr, O);
    await s.configurar(ctx(), 'gen-1', { compatibilidad: compat, limites, expiraEn: '2026-08-01T00:00:00.000Z' }, 'ana', attr, O);
    await s.habilitar(ctx(), 'gen-1', 'ana', attr, O);
    await s.autorizar(ctx(), 'gen-1', 'ana-humana', attr, O);
    const reg = await s.cargar(ctx(), 'gen-1');
    // expiraEn ya pasó respecto de O → no consumible aunque el estado sea AUTORIZADO.
    expect(puedeConsumirOperativo(reg, O).motivo).toBe('adaptador EXPIRADO');
  });

  it('eliminación lógica es terminal y preserva eventos', async () => {
    const store = new InMemoryEventStore();
    const s = new RegistroAdaptadoresService(store);
    await hastaAutorizado(s);
    await s.eliminar(ctx(), 'gen-1', 'ana', attr, O);
    const reg = await s.cargar(ctx(), 'gen-1');
    expect(reg.estado).toBe('ELIMINADO');
    expect(reg.terminada).toBe(true);
    await expect(s.reanudar(ctx(), 'gen-1', 'ana', attr, O)).rejects.toBeInstanceOf(TransicionAdaptadorInvalidaError);
    const eventos = await store.readStream(ctx(), adaptadorStreamId('org-a', 'gen-1'));
    expect(eventos.length).toBeGreaterThan(3); // historial conservado
  });

  it('replay reconstruye el mismo estado', async () => {
    const store = new InMemoryEventStore();
    const s = new RegistroAdaptadoresService(store);
    await hastaAutorizado(s);
    const cargado = await s.cargar(ctx(), 'gen-1');
    const eventos = await store.readStream(ctx(), adaptadorStreamId('org-a', 'gen-1'));
    expect(reconstruirAdaptador('org-a', 'gen-1', eventos)).toEqual(cargado);
  });

  it('aísla por organización (multi-tenant)', async () => {
    const s = new RegistroAdaptadoresService(new InMemoryEventStore());
    await hastaAutorizado(s, ctx('org-a'));
    expect((await s.cargar(ctx('org-b'), 'gen-1')).existe).toBe(false);
    expect((await s.listar(ctx('org-b'))).adaptadores).toEqual([]);
  });

  it('índice idempotente y auto-reparable por reintento', async () => {
    const store = new InMemoryEventStore();
    const s = new RegistroAdaptadoresService(store);
    // Escribe sólo la entidad (índice rezagado).
    await store.append(ctx(), adaptadorStreamId('org-a', 'gen-1'), 0, [
      { type: EVENTOS_ADAPTADOR.registrado, payload: { adaptadorId: 'gen-1', capacidadId: 'gen', contratoId: 'gen', contratoVersion: '1.0.0', implementacionVersion: '1.0.0', creadoPor: 'ana', en: O }, attribution: attr, occurredAt: O },
    ]);
    expect((await s.listar(ctx())).adaptadores).toEqual([]);
    await s.registrar(ctx(), 'gen-1', 'gen', 'gen', '1.0.0', '1.0.0', 'ana', attr, O); // reintento repara índice
    expect((await s.listar(ctx())).adaptadores).toEqual(['gen-1']);
    await s.registrar(ctx(), 'gen-1', 'gen', 'gen', '1.0.0', '1.0.0', 'ana', attr, O);
    expect((await s.listar(ctx())).adaptadores).toEqual(['gen-1']); // sin duplicar
  });

  it('rechaza secretRef con forma de secreto en configurar', async () => {
    const s = new RegistroAdaptadoresService(new InMemoryEventStore());
    await s.registrar(ctx(), 'gen-1', 'gen', 'gen', '1.0.0', '1.0.0', 'ana', attr, O);
    await expect(s.configurar(ctx(), 'gen-1', { compatibilidad: compat, limites, secretRef: 'sk-REALabcdef1234567890' }, 'ana', attr, O)).rejects.toBeInstanceOf(AdaptadorInvalidoError);
  });

  it('revocar exige nueva vida: REVOCADO sólo transita a ELIMINADO', async () => {
    const s = new RegistroAdaptadoresService(new InMemoryEventStore());
    await hastaAutorizado(s);
    await s.revocar(ctx(), 'gen-1', 'motivo', 'ana', attr, O);
    await expect(s.reanudar(ctx(), 'gen-1', 'ana', attr, O)).rejects.toBeInstanceOf(TransicionAdaptadorInvalidaError);
    await expect(s.autorizar(ctx(), 'gen-1', 'ana-humana', attr, O)).rejects.toBeInstanceOf(TransicionAdaptadorInvalidaError);
  });

  it('cargar/rotar sobre un adaptador inexistente falla al transicionar', async () => {
    const s = new RegistroAdaptadoresService(new InMemoryEventStore());
    await expect(s.habilitar(ctx(), 'fantasma', 'ana', attr, O)).rejects.toBeInstanceOf(RegistroAdaptadorNoEncontradoError);
  });
});
