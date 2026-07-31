/**
 * @soec/crm-comercial · perfiles comerciales tipados. Cubre: esquema por tipo (rechaza campos fuera
 * de esquema), procedencia epistémica por campo, cobertura (qué se sabe vs qué falta), faltantes de
 * primera clase, y aislamiento multiempresa. Usa InMemoryEventStore.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { ComandoCrmInvalidoError, ConocimientoComercialService, ESQUEMAS } from '../src/index';

const attr: Attribution = { source: 'crm', purpose: 'test', assumptions: ['test'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
}
const O = '2026-07-31T00:00:00.000Z';
const svc = () => new ConocimientoComercialService(new InMemoryEventStore());

describe('@soec/crm-comercial · conocimiento comercial tipado', () => {
  it('registra empresa y producto y persiste campos con su procedencia', async () => {
    const s = svc();
    await s.registrarEntidad(ctx(), 'empresa', 'EMPRESA', 'SmileFlow', attr, O);
    await s.establecerCampo(ctx(), 'empresa', 'propuestaValor', 'Odontología cercana y a plazos', 'DATO_DECLARADO_POR_USUARIO', attr, O);
    await s.registrarEntidad(ctx(), 'p1', 'PRODUCTO', 'Ortodoncia invisible', attr, O);
    await s.establecerCampo(ctx(), 'p1', 'problemaQueResuelve', 'Alinear dientes sin brackets visibles', 'DATO_DECLARADO_POR_USUARIO', attr, O);
    const state = await s.cargar(ctx());
    expect(state.empresa?.nombre).toBe('SmileFlow');
    expect(state.empresa?.campos.propuestaValor?.valor).toContain('plazos');
    expect(state.empresa?.campos.propuestaValor?.confianza).toBe('MEDIA'); // dato declarado
    expect(state.entidades.p1?.campos.problemaQueResuelve?.origen).toBe('DATO_DECLARADO_POR_USUARIO');
  });

  it('rechaza un campo que no pertenece al esquema del tipo', async () => {
    const s = svc();
    await s.registrarEntidad(ctx(), 'p1', 'PRODUCTO', 'X', attr, O);
    await expect(s.establecerCampo(ctx(), 'p1', 'campoInventado', 'v', 'INFERENCIA', attr, O)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
  });

  it('la cobertura reporta qué campos del esquema están y cuáles faltan', async () => {
    const s = svc();
    await s.registrarEntidad(ctx(), 'c1', 'COMPETIDOR', 'Clínica Rival', attr, O);
    await s.establecerCampo(ctx(), 'c1', 'precios', 'planes desde $X', 'DATO_IMPORTADO', attr, O);
    const cob = await s.cobertura(ctx(), 'c1');
    expect(cob.presentes).toContain('precios');
    expect(cob.faltantes).toContain('embudos');
    expect(cob.completitud).toBeCloseTo(1 / ESQUEMAS.COMPETIDOR.length, 5);
  });

  it('declara faltantes de primera clase sobre una entidad', async () => {
    const s = svc();
    await s.registrarEntidad(ctx(), 'm1', 'MERCADO', 'Odontología urbana', attr, O);
    await s.declararFaltante(ctx(), 'm1', 'palabrasClave', 'no se han investigado aún', attr, O);
    const state = await s.cargar(ctx());
    expect(state.entidades.m1?.faltantes[0]?.sobre).toBe('palabrasClave');
  });

  it('aislamiento multiempresa: el conocimiento de org-a no aparece en org-b', async () => {
    const s = svc();
    await s.registrarEntidad(ctx('org-a'), 'empresa', 'EMPRESA', 'SmileFlow', attr, O);
    const b = await s.cargar(ctx('org-b'));
    expect(b.empresa).toBeNull();
    expect(await s.listarPorTipo(ctx('org-b'), 'PRODUCTO')).toHaveLength(0);
  });

  it('registrar dos veces la misma entidad es idempotente', async () => {
    const s = svc();
    await s.registrarEntidad(ctx(), 'p1', 'PRODUCTO', 'X', attr, O);
    await s.registrarEntidad(ctx(), 'p1', 'PRODUCTO', 'Otro nombre', attr, O);
    const state = await s.cargar(ctx());
    expect(state.entidades.p1?.nombre).toBe('X');
  });
});
