/**
 * @soec/crm-comercial · hipótesis comerciales. Cubre el ciclo completo hipótesis → evidencia →
 * resultado → aprendizaje en un agregado, la máquina de estados, la evaluación explicable con
 * Evaluabilidad (sin evidencia → no evaluable), la exigencia de explicar el porqué del aprendizaje,
 * y el aislamiento multiempresa.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { ComandoCrmInvalidoError, ContactoNoEncontradoError, HipotesisComercialService } from '../src/index';

const attr: Attribution = { source: 'crm', purpose: 'test', assumptions: ['test'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
}
const O = '2026-07-31T00:00:00.000Z';
const svc = () => new HipotesisComercialService(new InMemoryEventStore());

describe('@soec/crm-comercial · hipótesis comerciales', () => {
  it('ciclo completo: registrar → evidencia → prueba → resultado → aprendizaje', async () => {
    const s = svc();
    await s.registrar(ctx(), 'h1', 'Instagram convierte mejor que Facebook para SmileFlow', 'canales', attr, O);
    await s.agregarEvidencia(ctx(), 'h1', 'e1', 'público objetivo joven activo en IG', 'DATO_IMPORTADO', true, attr, O);
    await s.iniciarPrueba(ctx(), 'h1', attr, O);
    await s.registrarResultado(ctx(), 'h1', 'IG duplicó el CTR simulado', 'CONFIRMADA', 2.1, attr, O);
    await s.registrarAprendizaje(ctx(), 'h1', 'el segmento joven responde mejor al formato visual', 'preferir IG en segmentos <35', attr, O);
    const st = await s.cargar(ctx(), 'h1');
    expect(st.estado).toBe('CONFIRMADA');
    expect(st.resultado?.veredicto).toBe('CONFIRMADA');
    expect(st.aprendizaje?.porQue).toContain('segmento joven');
    expect((await s.listar(ctx())).hipotesis).toHaveLength(1);
  });

  it('sin evidencia la hipótesis NO es evaluable (Evaluabilidad)', async () => {
    const s = svc();
    await s.registrar(ctx(), 'h1', 'X funciona', 'test', attr, O);
    const ev = await s.evaluar(ctx(), 'h1');
    expect(ev.evaluable).toBe(false);
    expect(ev.confianza).toBeNull();
    expect(ev.faltantes).toContain('sin evidencia registrada');
  });

  it('con evidencia fuerte a favor y sin contra → confianza ALTA; declara que falta el resultado', async () => {
    const s = svc();
    await s.registrar(ctx(), 'h1', 'X', 'test', attr, O);
    await s.agregarEvidencia(ctx(), 'h1', 'e1', 'hecho verificado', 'HECHO_VERIFICADO', true, attr, O);
    const ev = await s.evaluar(ctx(), 'h1');
    expect(ev.evaluable).toBe(true);
    expect(ev.confianza).toBe('ALTA');
    expect(ev.faltantes).toContain('sin resultado observado aún');
  });

  it('la máquina de estados impide registrar resultado sin estar EN_PRUEBA', async () => {
    const s = svc();
    await s.registrar(ctx(), 'h1', 'X', 'test', attr, O);
    await expect(s.registrarResultado(ctx(), 'h1', 'r', 'CONFIRMADA', null, attr, O)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
  });

  it('el aprendizaje exige explicar el porqué y que exista un resultado', async () => {
    const s = svc();
    await s.registrar(ctx(), 'h1', 'X', 'test', attr, O);
    await s.iniciarPrueba(ctx(), 'h1', attr, O);
    await expect(s.registrarAprendizaje(ctx(), 'h1', '   ', null, attr, O)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
    await s.registrarResultado(ctx(), 'h1', 'r', 'REFUTADA', null, attr, O);
    await expect(s.registrarAprendizaje(ctx(), 'h1', 'porque el canal no llega al público', null, attr, O)).resolves.toBeUndefined();
  });

  it('aislamiento multiempresa: una hipótesis de org-a no existe en org-b', async () => {
    const s = svc();
    await s.registrar(ctx('org-a'), 'h1', 'X', 'test', attr, O);
    await expect(s.evaluar(ctx('org-b'), 'h1')).rejects.toBeInstanceOf(ContactoNoEncontradoError);
    expect((await s.listar(ctx('org-b'))).hipotesis).toHaveLength(0);
  });
});
