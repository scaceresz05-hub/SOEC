/**
 * V2-B · CAMPAIGN + CONTENT ENGINE (dry-run) — pruebas adversariales.
 * Invariantes: (1) toda escritura pasa por el Action Plane; (2) el Meta Write Port dry-run NUNCA hace red y
 * META_WRITE_CALLS reales = 0; (3) el techo del mandato jamás se supera ni siquiera en shadow; (4) content-
 * policy bloquea claims/precios/PII/secretos/cross-tenant; (5) idempotencia por (plan, paso).
 */
import { describe, expect, it } from 'vitest';
import { crearMandatoAutorizado, type Mandato } from '../src/accion/mandato';
import { InMemoryActionLedgerRepo } from '../src/accion/ledger';
import type { DepsActionPlane } from '../src/accion/action-plane';
import { validarContenido } from '../src/campana/content-policy';
import { generarContenido, type PerfilNegocio } from '../src/campana/content-engine';
import { construirCampaignPlan } from '../src/campana/campaign-plan';
import { ejecutarCampana } from '../src/campana/campaign-execution';
import { MetaWriteDryRunAdapter, operacionPermitida } from '../src/campana/meta-write-port';

const AHORA = '2026-08-18T12:00:00.000Z';
const ACT = 'act_100';

const perfil: PerfilNegocio = { organizationId: 'org-a', nombre: 'Clínica Norte', rubro: 'odontología', serviciosDeclarados: ['limpieza dental', 'ortodoncia'], comuna: 'Ñuñoa', tono: 'cercano' };

function mandato(over: Partial<Parameters<typeof crearMandatoAutorizado>[0]> = {}): Mandato {
  return crearMandatoAutorizado(
    {
      organizationId: 'org-a', objective: 'reconocimiento', currency: 'CLP', authorizedBudgetMinor: 300000,
      periodStart: '2026-08-18T00:00:00.000Z', periodEnd: '2026-09-18T00:00:00.000Z',
      allowedMetaAssets: [ACT], allowedActionTypes: ['UPDATE_CREATIVE_DRAFT', 'CREATE_CAMPAIGN', 'CREATE_ADSET', 'CREATE_AD'],
      ...over,
    },
    'user-owner', 'm-1', AHORA,
  );
}

function activar(m: Mandato): Mandato {
  return { ...m, status: 'ACTIVE' };
}

function deps(autonomousReal = false): DepsActionPlane {
  let n = 0;
  return { ledger: new InMemoryActionLedgerRepo(), ahora: () => AHORA, autonomousReal, globalKillSwitch: false, nuevoId: () => `id-${n++}` };
}

const plan = (presupuestoDeseadoMinor: number, restanteMandatoMinor: number) =>
  construirCampaignPlan({ perfil, objetivo: 'RECONOCIMIENTO', placement: 'instagram', adAccountId: ACT, moneda: 'CLP', presupuestoDeseadoMinor, restanteMandatoMinor });

describe('V2-B · content-policy', () => {
  it('bloquea claim clínico, superlativo, precio, PII y secreto', () => {
    expect(validarContenido({ organizationId: 'org-a', textos: ['garantía de resultados'] }, 'org-a').permitido).toBe(false);
    expect(validarContenido({ organizationId: 'org-a', textos: ['somos el mejor'] }, 'org-a').permitido).toBe(false);
    expect(validarContenido({ organizationId: 'org-a', textos: ['20% de descuento'] }, 'org-a').permitido).toBe(false);
    expect(validarContenido({ organizationId: 'org-a', textos: ['escríbenos a juan@correo.cl'] }, 'org-a').permitido).toBe(false);
    expect(validarContenido({ organizationId: 'org-a', textos: ['access_token=EAAB123'] }, 'org-a').permitido).toBe(false);
  });
  it('bloquea contenido de otro tenant', () => {
    expect(validarContenido({ organizationId: 'org-b', textos: ['hola'] }, 'org-a').permitido).toBe(false);
  });
  it('permite copy conservador sin claims/precios', () => {
    expect(validarContenido({ organizationId: 'org-a', textos: ['Agenda tu limpieza dental en Ñuñoa'] }, 'org-a').permitido).toBe(true);
  });
});

describe('V2-B · content-engine', () => {
  it('genera 2 variantes conformes que pasan la content-policy', () => {
    const piezas = generarContenido(perfil, { organizationId: 'org-a', objetivo: 'MENSAJES', placement: 'instagram' });
    expect(piezas).toHaveLength(2);
    expect(piezas.every((p) => p.policy.permitido)).toBe(true);
  });
  it('no inventa servicios cuando no hay declarados (copy genérico conforme)', () => {
    const p2: PerfilNegocio = { ...perfil, serviciosDeclarados: [] };
    const piezas = generarContenido(p2, { organizationId: 'org-a', objetivo: 'RECONOCIMIENTO', placement: 'facebook' });
    expect(piezas.every((x) => x.policy.permitido)).toBe(true);
  });
});

describe('V2-B · campaign-plan', () => {
  it('limita el presupuesto al restante del mandato', () => {
    const p = plan(500000, 120000);
    expect(p.presupuestoTotalMinor).toBe(120000);
    expect(p.advertencias.some((a) => a.includes('limitado'))).toBe(true);
  });
  it('nunca propone presupuesto negativo', () => {
    expect(plan(100000, -50).presupuestoTotalMinor).toBe(0);
  });
});

describe('V2-B · write port', () => {
  it('la whitelist rechaza operaciones financieras y desconocidas', () => {
    expect(operacionPermitida('CREATE_CAMPAIGN')).toBe(true);
    expect(operacionPermitida('INCREASE_AUTHORIZED_BUDGET')).toBe(false);
    expect(operacionPermitida('DELETE_EVERYTHING')).toBe(false);
  });
  it('el adapter dry-run simula ref determinista y no marca escritura real', async () => {
    const port = new MetaWriteDryRunAdapter();
    const s = { operacion: 'CREATE_CAMPAIGN', organizationId: 'org-a', assetId: ACT, idempotencyKey: 'k', payload: {} };
    const r1 = await port.ejecutar(s);
    const r2 = await port.ejecutar(s);
    expect(r1.externalRef).toBe(r2.externalRef); // determinista
    expect(r1.modo).toBe('DRY_RUN');
    expect(port.esReal).toBe(false);
  });
});

describe('V2-B · campaign-execution (dry-run)', () => {
  it('happy path: todos los pasos SIMULADA, 0 escrituras reales, gasto real 0, shadow = presupuesto', async () => {
    const m = activar(mandato());
    const p = plan(150000, 300000);
    const r = await ejecutarCampana(deps(false), new MetaWriteDryRunAdapter(), m, p, 'plan-1');
    expect(r.ok).toBe(true);
    expect(r.pasos.every((x) => x.estado === 'SIMULADA')).toBe(true);
    expect(r.metaWriteCallsReales).toBe(0);
    expect(r.gastoComprometidoMinor).toBe(0); // dry-run no compromete
    expect(r.gastoProyectadoMinor).toBe(150000); // shadow: lo que comprometería
    expect(r.modo).toBe('DRY_RUN');
  });

  it('idempotencia: reejecutar el mismo plan no duplica asientos', async () => {
    const d = deps(false);
    const m = activar(mandato());
    const p = plan(150000, 300000);
    await ejecutarCampana(d, new MetaWriteDryRunAdapter(), m, p, 'plan-x');
    const antes = (await d.ledger.listar('org-a', 'm-1')).length;
    await ejecutarCampana(d, new MetaWriteDryRunAdapter(), m, p, 'plan-x');
    const despues = (await d.ledger.listar('org-a', 'm-1')).length;
    expect(despues).toBe(antes); // mismos (plan, paso) ⇒ mismas idempotencyKeys
  });

  it('presupuesto sobre el techo ⇒ campaña RECHAZADA y estructura dependiente BLOQUEADA; shadow no supera techo', async () => {
    const m = activar(mandato({ authorizedBudgetMinor: 100000 }));
    // Deseado > restante ⇒ el plan lo capa a 100000, que ES el techo, así que pasa. Forzamos exceso real:
    const p = { ...plan(100000, 100000), presupuestoTotalMinor: 100001 }; // inyectamos exceso post-plan
    const r = await ejecutarCampana(deps(false), new MetaWriteDryRunAdapter(), m, p, 'plan-over');
    const campana = r.pasos.find((x) => x.actionType === 'CREATE_CAMPAIGN')!;
    expect(campana.estado).toBe('RECHAZADA');
    expect(campana.bloqueos).toContain('TECHO_PRESUPUESTO');
    expect(r.pasos.filter((x) => x.actionType === 'CREATE_ADSET' || x.actionType === 'CREATE_AD').every((x) => x.estado === 'BLOQUEADA')).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.gastoProyectadoMinor).toBe(0); // nada proyectado porque la campaña fue rechazada
  });

  it('mandato no ACTIVE (pausado) ⇒ todo rechazado, sin escrituras', async () => {
    const m: Mandato = { ...mandato(), status: 'PAUSED' };
    const r = await ejecutarCampana(deps(false), new MetaWriteDryRunAdapter(), m, plan(150000, 300000), 'plan-paused');
    expect(r.pasos.some((x) => x.estado === 'SIMULADA')).toBe(false);
    expect(r.metaWriteCallsReales).toBe(0);
  });

  it('activo no autorizado ⇒ campaña rechazada por ACTIVO_AUTORIZADO', async () => {
    const m = activar(mandato({ allowedMetaAssets: ['act_999'] }));
    const r = await ejecutarCampana(deps(false), new MetaWriteDryRunAdapter(), m, plan(150000, 300000), 'plan-asset');
    const campana = r.pasos.find((x) => x.actionType === 'CREATE_CAMPAIGN')!;
    expect(campana.estado).toBe('RECHAZADA');
    expect(campana.bloqueos).toContain('ACTIVO_AUTORIZADO');
  });
});
