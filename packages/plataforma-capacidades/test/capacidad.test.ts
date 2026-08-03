/**
 * @soec/plataforma-capacidades · M4-A · núcleo de la PCE. Verifica el Título I de la Directiva Maestra:
 * ciclo de vida gobernado (Capacidad ≠ Activación), nace SIMULADA, referencias sin secreto/proveedor/costo,
 * degradación obligatoria (Art. 11), versionado (Art. 7), kill-switch (Art. 8), salud fail-safe (Art. 13),
 * y aislamiento multi-tenant.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { CapacidadExternaInvalidaError, CapacidadesExternasService } from '../src/index';

const attr: Attribution = { source: 'pce', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const O = '2026-08-01T00:00:00.000Z';
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const svc = () => new CapacidadesExternasService(new InMemoryEventStore());

async function hastaEnUso(s: CapacidadesExternasService) {
  await s.registrar(ctx(), 'gen', 'generacion-contenido', 'SIMULAR', attr, O);
  await s.configurar(ctx(), 'gen', { proveedorRef: 'proveedor-logico-1', secretRef: 'env:GEN_KEY_ORG_A', politicaDegradacion: 'SIMULAR' }, attr, O);
  await s.transicionar(ctx(), 'gen', 'HABILITADA', {}, attr, O);
  await s.transicionar(ctx(), 'gen', 'AUTORIZADA', { actorHumano: 'ana' }, attr, O);
  await s.transicionar(ctx(), 'gen', 'EN_USO', { actorHumano: 'ana' }, attr, O);
}

describe('@soec/plataforma-capacidades · ciclo de vida (Art. 3)', () => {
  it('nace SIMULADA y avanza REGISTRADA→…→EN_USO por actos gobernados', async () => {
    const s = svc();
    await s.registrar(ctx(), 'gen', 'generacion-contenido', 'ABSTENER', attr, O);
    let st = await s.cargar(ctx(), 'gen');
    expect(st.estado).toBe('REGISTRADA');
    expect(st.modo).toBe('SIMULADA'); // Art. 3: nace SIMULADA
    expect(st.politicaDegradacion).toBe('ABSTENER');
    await hastaEnUso(s);
    st = await s.cargar(ctx(), 'gen');
    expect(st.estado).toBe('EN_USO');
    expect(st.modo).toBe('SIMULADA'); // EN_USO no implica REAL
    expect(st.configVersion).toBe(1);
  });

  it('rechaza transiciones inválidas y actos sin actor humano', async () => {
    const s = svc();
    await s.registrar(ctx(), 'gen', 'generacion-contenido', 'SIMULAR', attr, O);
    await expect(s.transicionar(ctx(), 'gen', 'EN_USO', { actorHumano: 'ana' }, attr, O)).rejects.toBeInstanceOf(CapacidadExternaInvalidaError); // salto inválido
    await s.configurar(ctx(), 'gen', { proveedorRef: 'p1', secretRef: 'env:K', politicaDegradacion: 'SIMULAR' }, attr, O);
    await s.transicionar(ctx(), 'gen', 'HABILITADA', {}, attr, O);
    await expect(s.transicionar(ctx(), 'gen', 'AUTORIZADA', {}, attr, O)).rejects.toBeInstanceOf(CapacidadExternaInvalidaError); // sin actor humano
  });

  it('registrar exige política de degradación válida (Art. 11)', async () => {
    const s = svc();
    // @ts-expect-error política inválida a propósito
    await expect(s.registrar(ctx(), 'gen', 'generacion-contenido', 'NADA', attr, O)).rejects.toBeInstanceOf(CapacidadExternaInvalidaError);
  });
});

describe('@soec/plataforma-capacidades · secretos y proveedor fuera del dominio (Art. 2/4)', () => {
  it('secretRef debe ser una REFERENCIA, nunca el valor del secreto', async () => {
    const s = svc();
    await s.registrar(ctx(), 'gen', 'generacion-contenido', 'SIMULAR', attr, O);
    await expect(s.configurar(ctx(), 'gen', { proveedorRef: 'p1', secretRef: 'sk-un-secreto-en-claro-1234', politicaDegradacion: 'SIMULAR' }, attr, O)).rejects.toBeInstanceOf(CapacidadExternaInvalidaError);
    await s.configurar(ctx(), 'gen', { proveedorRef: 'p1', secretRef: 'vault://org-a/gen', politicaDegradacion: 'SIMULAR' }, attr, O);
    const st = await s.cargar(ctx(), 'gen');
    // El dominio guarda REFERENCIAS; no hay campo de costo ni de proveedor concreto ni de valor de secreto.
    expect(st.secretRef).toBe('vault://org-a/gen');
    expect(Object.keys(st)).not.toContain('costo');
    expect(JSON.stringify(st)).not.toContain('sk-');
  });
});

describe('@soec/plataforma-capacidades · activación real, kill-switch y salud (Art. 3/8/13)', () => {
  it('activarReal exige EN_USO + refs + SALUDABLE; nunca implícito', async () => {
    const s = svc();
    await s.registrar(ctx(), 'gen', 'generacion-contenido', 'SIMULAR', attr, O);
    await s.configurar(ctx(), 'gen', { proveedorRef: 'p1', secretRef: 'env:K', politicaDegradacion: 'SIMULAR' }, attr, O);
    await s.transicionar(ctx(), 'gen', 'HABILITADA', {}, attr, O);
    await expect(s.activarReal(ctx(), 'gen', 'ana', attr, O)).rejects.toBeInstanceOf(CapacidadExternaInvalidaError); // no EN_USO
    await s.transicionar(ctx(), 'gen', 'AUTORIZADA', { actorHumano: 'ana' }, attr, O);
    await s.transicionar(ctx(), 'gen', 'EN_USO', { actorHumano: 'ana' }, attr, O);
    const st = await s.activarReal(ctx(), 'gen', 'ana', attr, O);
    expect(st.modo).toBe('REAL');
  });

  it('kill-switch (volverASimulado) devuelve a SIMULADA de inmediato', async () => {
    const s = svc();
    await hastaEnUso(s);
    await s.activarReal(ctx(), 'gen', 'ana', attr, O);
    const st = await s.volverASimulado(ctx(), 'gen', 'incidente', attr, O);
    expect(st.modo).toBe('SIMULADA');
  });

  it('pausar devuelve a SIMULADA (Art. 8) y NO_CONFIABLE en REAL vuelve a SIMULADA (fail-safe Art. 13)', async () => {
    const s = svc();
    await hastaEnUso(s);
    await s.activarReal(ctx(), 'gen', 'ana', attr, O);
    // Salud NO_CONFIABLE mientras está REAL → fail-safe a SIMULADA.
    const stSalud = await s.registrarSalud(ctx(), 'gen', 'NO_CONFIABLE', attr, O);
    expect(stSalud.modo).toBe('SIMULADA');
    expect(stSalud.salud).toBe('NO_CONFIABLE');
    // Re-activar y pausar (kill-switch por transición).
    await s.registrarSalud(ctx(), 'gen', 'SALUDABLE', attr, O);
    await s.activarReal(ctx(), 'gen', 'ana', attr, O);
    const stPausa = await s.transicionar(ctx(), 'gen', 'PAUSADA', {}, attr, O);
    expect(stPausa.estado).toBe('PAUSADA');
    expect(stPausa.modo).toBe('SIMULADA');
  });
});

describe('@soec/plataforma-capacidades · versionado, terminales, índice y multi-tenant', () => {
  it('reconfigurar versiona (Art. 7); eliminar/reemplazar son terminales', async () => {
    const s = svc();
    await s.registrar(ctx(), 'gen', 'generacion-contenido', 'SIMULAR', attr, O);
    await s.configurar(ctx(), 'gen', { proveedorRef: 'p1', secretRef: 'env:K1', politicaDegradacion: 'SIMULAR' }, attr, O);
    await s.configurar(ctx(), 'gen', { proveedorRef: 'p2', secretRef: 'env:K2', politicaDegradacion: 'ABSTENER' }, attr, O);
    expect((await s.cargar(ctx(), 'gen')).configVersion).toBe(2);
    await s.transicionar(ctx(), 'gen', 'ELIMINADA', {}, attr, O);
    await expect(s.transicionar(ctx(), 'gen', 'CONFIGURADA', {}, attr, O)).rejects.toBeInstanceOf(CapacidadExternaInvalidaError); // terminal
  });

  it('lista por organización (idempotente) y aísla multi-tenant', async () => {
    const store = new InMemoryEventStore();
    const s = new CapacidadesExternasService(store);
    await s.registrar(ctx('org-a'), 'gen', 'generacion-contenido', 'SIMULAR', attr, O);
    await s.registrar(ctx('org-a'), 'gen', 'generacion-contenido', 'SIMULAR', attr, O); // idempotente
    await s.registrar(ctx('org-a'), 'mail', 'correo', 'DETENER', attr, O);
    const idx = await s.listar(ctx('org-a'));
    expect(idx.capacidades.map((c) => c.capacidadId).sort()).toEqual(['gen', 'mail']);
    expect((await s.listar(ctx('org-b'))).capacidades).toHaveLength(0);
    expect((await s.cargar(ctx('org-b'), 'gen')).existe).toBe(false);
  });
});
