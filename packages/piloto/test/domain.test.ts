import { describe, expect, it } from 'vitest';
import {
  capacidadesEntorno,
  entornoOperable,
  evaluarReadiness,
  proponerPoliticaInicial,
  realHabilitable,
  reconstruirOrg,
  orgStreamId,
} from '../src';
import { attr, ctxFor, montar, now, presupuestoDemo, sembrarOrg } from './helpers';

describe('Dominio de preparación de piloto', () => {
  it('el modo real jamás se habilita y no es operable en este bloque', () => {
    expect(realHabilitable()).toBe(false);
    expect(entornoOperable('sandbox')).toBe(true);
    expect(entornoOperable('real_habilitado')).toBe(false);
    expect(capacidadesEntorno('real_habilitado').permiteEfectoExterno).toBe(true); // contemplado…
    expect(capacidadesEntorno('sandbox').permiteGastoReal).toBe(false); // …pero inalcanzable/operable aquí
  });

  it('la readiness aprueba en sandbox con onboarding completo, pero la activación real nunca se permite', async () => {
    const m = montar();
    const ctx = await sembrarOrg(m);
    const org = reconstruirOrg('org-1', 'orgA', await m.store.readStream(ctx, orgStreamId('org-1')));
    const evSandbox = evaluarReadiness(org, 'sandbox', false);
    expect(evSandbox.resultado).toBe('apto_para_ensayo');
    expect(evSandbox.activacionRealPermitida).toBe(false);
    const evTrasEnsayo = evaluarReadiness(org, 'sandbox', true);
    expect(evTrasEnsayo.resultado).toBe('ensayo_aprobado');
    expect(evTrasEnsayo.activacionRealPermitida).toBe(false);
  });

  it('en entorno real, una credencial FIXTURE bloquea la readiness (exige credencial real)', async () => {
    const m = montar();
    const ctx = await sembrarOrg(m);
    const org = reconstruirOrg('org-1', 'orgA', await m.store.readStream(ctx, orgStreamId('org-1')));
    const evReal = evaluarReadiness(org, 'real_preparado', true);
    expect(evReal.resultado).toBe('bloqueado');
    expect(evReal.chequeos.some((c) => c.codigo.startsWith('canal.credencial') && c.bloqueo)).toBe(true);
  });

  it('un onboarding incompleto deja la readiness incompleta (la ausencia no es fracaso)', async () => {
    const m = montar();
    const ctx = ctxFor();
    await m.org.registrar(ctx, 'org-2', (await import('../src/fixtures')).identidadDemo, ['marketing'], attr, now);
    const org = reconstruirOrg('org-2', 'orgA', await m.store.readStream(ctx, orgStreamId('org-2')));
    const ev = evaluarReadiness(org, 'sandbox', false);
    expect(ev.resultado).toBe('incompleto');
  });

  it('un presupuesto inconsistente bloquea la readiness', async () => {
    const m = montar();
    const ctx = await sembrarOrg(m);
    await m.org.definirPresupuesto(ctx, 'org-1', { ...presupuestoDemo, limiteDiario: 999, limiteTotal: 100 }, attr, now);
    const org = reconstruirOrg('org-1', 'orgA', await m.store.readStream(ctx, orgStreamId('org-1')));
    const ev = evaluarReadiness(org, 'sandbox', false);
    expect(ev.resultado).toBe('bloqueado');
  });

  it('la política inicial propuesta es conservadora (escalamiento con aprobación, autonomía ≤ 3)', async () => {
    const m = montar();
    const ctx = await sembrarOrg(m);
    const org = reconstruirOrg('org-1', 'orgA', await m.store.readStream(ctx, orgStreamId('org-1')));
    const pol = proponerPoliticaInicial(org);
    expect(pol.escalamientoRequiereAprobacion).toBe(true);
    expect(pol.nivelAutonomia).toBeLessThanOrEqual(3);
    expect(pol.anomaliaBloqueaEscalamiento).toBe(true);
  });

  it('el intento de activación real está SIEMPRE bloqueado y explica las autorizaciones faltantes', async () => {
    const m = montar();
    const ctx = await sembrarOrg(m);
    await m.exp.crear(ctx, 'exp-1', { orgRef: 'org-1', departamento: 'marketing', entorno: 'real_preparado', objetivo: 'o', duracionDias: 14, criteriosExito: [], criteriosSuspension: [], rollback: [] }, attr, now);
    const r = await m.exp.intentarActivacion(ctx, 'exp-1', 'real_preparado', attr, now);
    expect(r.permitida).toBe(false);
    expect(r.autorizacionesFaltantes.some((x) => x.includes('autorización estratégica'))).toBe(true);
    expect(r.autorizacionesFaltantes.some((x) => x.includes('credenciales reales'))).toBe(true);
    const exp = await m.exp.cargar(ctx, 'exp-1');
    expect(exp.intentosActivacion.length).toBe(1);
    expect(exp.estado).not.toBe('autorizado');
  });

  it('el ensayo es idempotente por identidad (la repetición no duplica)', async () => {
    const m = montar();
    const ctx = ctxFor();
    const payload = { orgRef: 'org-1', escenario: 'exitoso' as const, pasos: [{ nombre: 'x', estado: 'ok' as const, detalle: 'd' }], incidencias: [], rollbackVerificado: true, resultado: 'apto_para_activacion' as const };
    const a = await m.ens.registrar(ctx, 'ens-1', payload, attr, now);
    const b = await m.ens.registrar(ctx, 'ens-1', payload, attr, now);
    expect(b.version).toBe(a.version);
  });
});
