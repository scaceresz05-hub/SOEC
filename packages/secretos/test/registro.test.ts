/**
 * @soec/secretos · M4-B · gobernanza de REFERENCIAS (Art. 4/7/10). El servicio registra y rota referencias
 * por nombre lógico, event-sourced y multi-tenant, guardando SÓLO metadatos — jamás un valor.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { RegistroSecretosService, SecretoInvalidoError, SecretoNoEncontradoError, registroSecretoStreamId } from '../src/index';

const attr: Attribution = { source: 'pce', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const O = '2026-08-02T00:00:00.000Z';
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};

describe('@soec/secretos · RegistroSecretosService', () => {
  it('registra una referencia y la enumera; guarda sólo metadatos (sin valor)', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await svc.registrar(ctx(), 'gen-primary', 'env:GEN_PRIMARY', 'ana', attr, O);

    const st = await svc.cargar(ctx(), 'gen-primary');
    expect(st.existe).toBe(true);
    expect(st.secretRef).toBe('env:GEN_PRIMARY');
    expect(st.rotaciones).toBe(0);
    expect(st.actor).toBe('ana');
    expect(Object.keys(st)).not.toContain('valor');

    const idx = await svc.listar(ctx());
    expect(idx.nombres).toEqual(['gen-primary']);
  });

  it('rota la referencia e incrementa el contador (Art. 7)', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await svc.registrar(ctx(), 'gen-primary', 'env:GEN_PRIMARY', 'ana', attr, O);
    const st = await svc.rotar(ctx(), 'gen-primary', 'vault:org-a/gen/primary', 'ana', attr, O);
    expect(st.secretRef).toBe('vault:org-a/gen/primary');
    expect(st.rotaciones).toBe(1);
  });

  it('rotar con la misma referencia es idempotente (no incrementa)', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await svc.registrar(ctx(), 'gen-primary', 'env:GEN_PRIMARY', 'ana', attr, O);
    const st = await svc.rotar(ctx(), 'gen-primary', 'env:GEN_PRIMARY', 'ana', attr, O);
    expect(st.rotaciones).toBe(0);
  });

  it('registrar es idempotente y no duplica en el índice', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await svc.registrar(ctx(), 'gen-primary', 'env:GEN_PRIMARY', 'ana', attr, O);
    await svc.registrar(ctx(), 'gen-primary', 'env:OTRO', 'ana', attr, O); // no cambia el existente
    const st = await svc.cargar(ctx(), 'gen-primary');
    expect(st.secretRef).toBe('env:GEN_PRIMARY');
    const idx = await svc.listar(ctx());
    expect(idx.nombres).toEqual(['gen-primary']);
  });

  it('rechaza una secretRef con forma de secreto en claro (Art. 4)', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await expect(svc.registrar(ctx(), 'gen', 'env:sk-REALabcdef1234567890', 'ana', attr, O)).rejects.toBeInstanceOf(SecretoInvalidoError);
    await expect(svc.registrar(ctx(), 'gen', 'no-scheme-arbitrario', 'ana', attr, O)).rejects.toBeInstanceOf(SecretoInvalidoError);
  });

  it('rotar una referencia inexistente falla', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await expect(svc.rotar(ctx(), 'fantasma', 'env:X', 'ana', attr, O)).rejects.toBeInstanceOf(SecretoNoEncontradoError);
  });

  it('aísla por organización (multi-tenant, Art. 10)', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await svc.registrar(ctx('org-a'), 'gen', 'env:A', 'ana', attr, O);
    const stB = await svc.cargar(ctx('org-b'), 'gen');
    expect(stB.existe).toBe(false);
    const idxB = await svc.listar(ctx('org-b'));
    expect(idxB.nombres).toEqual([]);
  });

  it('los eventos crudos contienen sólo referencia y metadatos, jamás un valor', async () => {
    const store = new InMemoryEventStore();
    const svc = new RegistroSecretosService(store);
    await svc.registrar(ctx(), 'gen', 'env:GEN_PRIMARY', 'ana', attr, O);
    const eventos = await store.readStream(ctx(), registroSecretoStreamId('org-a', 'gen'));
    for (const ev of eventos) {
      const p = ev.payload as Record<string, unknown>;
      expect(Object.keys(p)).not.toContain('valor');
      expect(Object.keys(p)).not.toContain('secret');
      expect(p.secretRef).toBe('env:GEN_PRIMARY');
    }
  });
});
