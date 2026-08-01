/**
 * @soec/estrategia-creativa · pruebas. Deriva brief + estrategia creativa desde el conocimiento
 * comercial (evaluable: ABSTIENE si falta info), la persiste solo si es PROPUESTA, y aísla por
 * organización. Reutiliza @soec/crm-comercial para sembrar el conocimiento.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { ConocimientoComercialService } from '@soec/crm-comercial';
import { EstrategiaCreativaService, derivarCreativa } from '../src/index';

const attr: Attribution = { source: 'ec', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const O = '2026-07-31T00:00:00.000Z';
const DECL = 'DATO_DECLARADO_POR_USUARIO' as const;

async function sembrarConocimientoCompleto(con: ConocimientoComercialService, org = 'org-a') {
  const c = ctx(org);
  await con.registrarEntidad(c, 'empresa', 'EMPRESA', 'SmileFlow', attr, O);
  await con.establecerCampo(c, 'empresa', 'propuestaValor', 'Odontología cercana y a plazos', DECL, attr, O);
  await con.registrarEntidad(c, 'p1', 'PRODUCTO', 'Ortodoncia invisible', attr, O);
  await con.establecerCampo(c, 'p1', 'problemaQueResuelve', 'alinear dientes sin brackets visibles', DECL, attr, O);
  await con.establecerCampo(c, 'p1', 'beneficios', 'sonrisa alineada sin que se note', DECL, attr, O);
  await con.registrarEntidad(c, 'icp1', 'CLIENTE_IDEAL', 'Adultos jóvenes profesionales', attr, O);
  await con.establecerCampo(c, 'icp1', 'dolores', 'vergüenza por dientes torcidos en reuniones', DECL, attr, O);
}

describe('@soec/estrategia-creativa · derivación evaluable', () => {
  it('con conocimiento completo → PROPUESTA con brief y estrategia creativa', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    await sembrarConocimientoCompleto(con);
    const s = new EstrategiaCreativaService(store, con);
    const res = await s.derivar(ctx());
    expect(res.tipo).toBe('PROPUESTA');
    if (res.tipo === 'PROPUESTA') {
      expect(res.brief.empresa).toBe('SmileFlow');
      expect(res.brief.propuestaValor).toContain('plazos');
      expect(res.estrategia.concepto).toContain('Odontología');
      expect(res.estrategia.angulo).toContain('Adultos jóvenes');
      expect(res.estrategia.mensajesClave.length).toBeGreaterThan(0);
    }
  });

  it('sin producto → ABSTENCION declarando el faltante (Evaluabilidad)', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    await con.registrarEntidad(ctx(), 'empresa', 'EMPRESA', 'SmileFlow', attr, O);
    await con.establecerCampo(ctx(), 'empresa', 'propuestaValor', 'Odontología cercana', DECL, attr, O);
    const res = derivarCreativa(await con.cargar(ctx()));
    expect(res.tipo).toBe('ABSTENCION');
    if (res.tipo === 'ABSTENCION') expect(res.faltantes).toContain('no hay ningún producto registrado');
  });

  it('derivarYRegistrar persiste la PROPUESTA; la ABSTENCION no se persiste', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    const s = new EstrategiaCreativaService(store, con);
    // Sin conocimiento → abstención, no persiste.
    expect((await s.derivarYRegistrar(ctx(), attr, O)).tipo).toBe('ABSTENCION');
    expect((await s.cargar(ctx())).existe).toBe(false);
    // Con conocimiento → propuesta, persiste.
    await sembrarConocimientoCompleto(con);
    expect((await s.derivarYRegistrar(ctx(), attr, O)).tipo).toBe('PROPUESTA');
    const st = await s.cargar(ctx());
    expect(st.existe).toBe(true);
    expect(st.estrategia?.concepto).toBeTruthy();
  });

  it('aislamiento multiempresa: el conocimiento de org-a no deriva estrategia para org-b', async () => {
    const store = new InMemoryEventStore();
    const con = new ConocimientoComercialService(store);
    await sembrarConocimientoCompleto(con, 'org-a');
    const s = new EstrategiaCreativaService(store, con);
    expect((await s.derivar(ctx('org-b'))).tipo).toBe('ABSTENCION');
  });
});
