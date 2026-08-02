/**
 * @soec/secretos · M4-BH · F-3 · replay, idempotencia y auto-reparación del índice. Verifica que el estado
 * se reconstruye determinísticamente desde los eventos, que las operaciones idénticas no inflan versión,
 * que la rotación real sí incrementa, que el aislamiento multi-tenant se conserva tras replay, y que el
 * índice separado es idempotente y auto-reparable (reconstruye/repara por reintento sin duplicar).
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import {
  EVENTOS_SECRETO,
  RegistroSecretosService,
  reconstruirRegistroSecreto,
  registroSecretoStreamId,
} from '../src/index';

const attr: Attribution = { source: 'audit', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const O = '2026-08-02T00:00:00.000Z';
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('auditor'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};

describe('@soec/secretos · replay e idempotencia (F-3)', () => {
  it('registrar → reconstruir produce el estado esperado', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await svc.registrar(ctx(), 'gen', 'env:GEN_PRIMARY', 'ana', attr, O);

    const ev = await store.readStream(ctx(), registroSecretoStreamId('org-a', 'gen'));
    const reconstruido = reconstruirRegistroSecreto('org-a', 'gen', ev);
    const cargado = await svc.cargar(ctx(), 'gen');
    expect(reconstruido).toEqual(cargado);
    expect(reconstruido.existe).toBe(true);
    expect(reconstruido.secretRef).toBe('env:GEN_PRIMARY');
    expect(reconstruido.version).toBe(1);
  });

  it('rotar → reconstruir conserva la última referencia y el contador', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await svc.registrar(ctx(), 'gen', 'env:GEN_PRIMARY', 'ana', attr, O);
    await svc.rotar(ctx(), 'gen', 'vault:org-a/gen/v2', 'ana', attr, O);

    const ev = await store.readStream(ctx(), registroSecretoStreamId('org-a', 'gen'));
    const r = reconstruirRegistroSecreto('org-a', 'gen', ev);
    expect(r.secretRef).toBe('vault:org-a/gen/v2');
    expect(r.rotaciones).toBe(1);
    expect(r.version).toBe(2);
  });

  it('replay puro es determinista: dos reconstrucciones dan el mismo estado', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await svc.registrar(ctx(), 'gen', 'env:GEN_PRIMARY', 'ana', attr, O);
    await svc.rotar(ctx(), 'gen', 'vault:org-a/gen/v2', 'ana', attr, O);
    const a = await svc.cargar(ctx(), 'gen');
    const b = await svc.cargar(ctx(), 'gen');
    expect(a).toEqual(b);
  });

  it('registrar idéntico no infla versión; rotación idéntica tampoco; rotación real sí', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await svc.registrar(ctx(), 'gen', 'env:GEN_PRIMARY', 'ana', attr, O);
    await svc.registrar(ctx(), 'gen', 'env:OTRO', 'ana', attr, O); // idempotente: no cambia
    let st = await svc.cargar(ctx(), 'gen');
    expect(st.version).toBe(1);
    expect(st.secretRef).toBe('env:GEN_PRIMARY');

    await svc.rotar(ctx(), 'gen', 'env:GEN_PRIMARY', 'ana', attr, O); // rotación idéntica
    st = await svc.cargar(ctx(), 'gen');
    expect(st.version).toBe(1);
    expect(st.rotaciones).toBe(0);

    await svc.rotar(ctx(), 'gen', 'vault:org-a/gen/v2', 'ana', attr, O); // rotación real
    st = await svc.cargar(ctx(), 'gen');
    expect(st.version).toBe(2);
    expect(st.rotaciones).toBe(1);
  });

  it('org A y org B permanecen aisladas tras replay', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await svc.registrar(ctx('org-a'), 'gen', 'env:A', 'ana', attr, O);
    await svc.registrar(ctx('org-b'), 'gen', 'env:B', 'beto', attr, O);
    const a = await svc.cargar(ctx('org-a'), 'gen');
    const b = await svc.cargar(ctx('org-b'), 'gen');
    expect(a.secretRef).toBe('env:A');
    expect(b.secretRef).toBe('env:B');
    expect((await svc.listar(ctx('org-a'))).nombres).toEqual(['gen']);
    expect((await svc.listar(ctx('org-b'))).nombres).toEqual(['gen']);
  });

  it('índice separado: idempotente y AUTO-REPARABLE por reintento, sin duplicar', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);

    // Simula un fallo parcial: el evento de entidad se escribió, pero el índice quedó rezagado
    // (p. ej. el proceso murió tras el primer append). Escribimos SÓLO la entidad, por lo bajo.
    await store.append(ctx(), registroSecretoStreamId('org-a', 'gen'), 0, [
      { type: EVENTOS_SECRETO.registrada, payload: { secretRef: 'env:GEN_PRIMARY', actor: 'ana', en: O }, attribution: attr, occurredAt: O },
    ]);
    expect((await svc.listar(ctx())).nombres).toEqual([]); // índice aún vacío (rezagado)

    // Reintento del comando idempotente: la entidad ya existe (no se duplica) y el índice se REPARA.
    await svc.registrar(ctx(), 'gen', 'env:GEN_PRIMARY', 'ana', attr, O);
    const st = await svc.cargar(ctx(), 'gen');
    expect(st.version).toBe(1); // la entidad NO se duplicó
    expect((await svc.listar(ctx())).nombres).toEqual(['gen']); // índice reparado

    // Un tercer reintento no vuelve a duplicar en el índice.
    await svc.registrar(ctx(), 'gen', 'env:GEN_PRIMARY', 'ana', attr, O);
    expect((await svc.listar(ctx())).nombres).toEqual(['gen']);
  });
});
