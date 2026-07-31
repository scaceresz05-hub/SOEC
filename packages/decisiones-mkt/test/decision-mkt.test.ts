/**
 * Decisión de marketing: ciclo de vida verificable, gate de evaluabilidad (NO_EVALUABLE no
 * se ejecuta), hipótesis que permanece hipótesis, alternativas descartadas con razón, y
 * transiciones inválidas rechazadas.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import {
  DecisionMktService,
  DecisionMktInvalidaError,
  TransicionInvalidaError,
  type EntradaDecision,
  esEjecutable,
  transicionValida,
} from '../src/index';

const now = '2026-07-25T12:00:00.000Z';
const attr: Attribution = { source: 'decmkt', purpose: 'decidir', assumptions: ['test'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const ORG = 'smileflow';
function ctx(org = ORG): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `c-${org}` };
}
const montar = () => new DecisionMktService(new InMemoryEventStore());

function entrada(over: Partial<EntradaDecision> = {}): EntradaDecision {
  return {
    organizacionId: ORG,
    objetivo: 'Generar solicitudes de demostración',
    contexto: 'clínica dental con holgura de agenda',
    hechos: [{ enunciado: 'pocas solicitudes', origen: 'DATO_DECLARADO_POR_USUARIO', fuente: 'recepción', evidenciaId: null }],
    fuentes: ['recepción'],
    faltantesObligatorios: [],
    inferencias: [],
    hipotesis: [{ id: 'h1', enunciado: 'la captación local aumentará solicitudes', tipo: 'HIPOTESIS' }],
    alternativas: [
      { id: 'a1', descripcion: 'captación local orgánica', elegida: true, razonDescarte: null },
      { id: 'a2', descripcion: 'anuncios pagados', elegida: false, razonDescarte: 'sin presupuesto aprobado' },
    ],
    justificacion: 'la señal activa es POCAS_SOLICITUDES',
    riesgos: ['estacionalidad'],
    confianza: 'MEDIA',
    criterioExito: '+20% solicitudes/mes',
    criterioFracaso: 'sin cambio a 30 días',
    aprobacionRequerida: true,
    nivelAutonomia: 1,
    aprendizajeQueLaCambio: null,
    ...over,
  };
}

describe('@soec/decisiones-mkt · ciclo de vida', () => {
  it('camino feliz: PROPUESTA → PENDIENTE_APROBACION → APROBADA → EN_EJECUCION → COMPLETADA → EVALUADA', async () => {
    const svc = montar();
    let d = await svc.crear(ctx(), 'd1', entrada(), attr, now);
    expect(d.estado).toBe('PROPUESTA');
    d = await svc.transicionar(ctx(), 'd1', 'PENDIENTE_APROBACION', attr, now);
    d = await svc.transicionar(ctx(), 'd1', 'APROBADA', attr, now);
    expect(esEjecutable(d.estado)).toBe(true);
    d = await svc.transicionar(ctx(), 'd1', 'EN_EJECUCION', attr, now);
    d = await svc.transicionar(ctx(), 'd1', 'COMPLETADA', attr, now);
    d = await svc.evaluar(ctx(), 'd1', '+22% solicitudes', attr, now);
    expect(d.estado).toBe('EVALUADA');
    expect(d.resultado).toBe('+22% solicitudes');
  });

  it('la hipótesis permanece marcada como hipótesis (no se guarda como hecho)', async () => {
    const svc = montar();
    const d = await svc.crear(ctx(), 'd1', entrada(), attr, now);
    expect(d.hipotesis[0]!.tipo).toBe('HIPOTESIS');
    expect(d.hechos.some((h) => h.enunciado.includes('captación'))).toBe(false);
  });
});

describe('@soec/decisiones-mkt · evaluabilidad y ejecución', () => {
  it('sin información obligatoria → NO_EVALUABLE, y NO puede aprobarse ni ejecutarse', async () => {
    const svc = montar();
    const d = await svc.crear(ctx(), 'd2', entrada({ faltantesObligatorios: ['presupuesto', 'público'] }), attr, now);
    expect(d.estado).toBe('NO_EVALUABLE');
    expect(esEjecutable(d.estado)).toBe(false);
    await expect(svc.transicionar(ctx(), 'd2', 'APROBADA', attr, now)).rejects.toBeInstanceOf(TransicionInvalidaError);
  });

  it('esEjecutable solo es verdadero en APROBADA', () => {
    for (const e of ['BORRADOR', 'NO_EVALUABLE', 'PROPUESTA', 'PENDIENTE_APROBACION', 'EN_EJECUCION', 'DETENIDA', 'COMPLETADA', 'EVALUADA', 'RECHAZADA', 'FALLIDA'] as const) {
      expect(esEjecutable(e)).toBe(false);
    }
    expect(esEjecutable('APROBADA')).toBe(true);
  });

  it('rechaza una transición no permitida (PROPUESTA → EN_EJECUCION directo)', async () => {
    const svc = montar();
    await svc.crear(ctx(), 'd3', entrada(), attr, now);
    await expect(svc.transicionar(ctx(), 'd3', 'EN_EJECUCION', attr, now)).rejects.toBeInstanceOf(TransicionInvalidaError);
  });
});

describe('@soec/decisiones-mkt · invariantes', () => {
  it('una alternativa descartada sin razón es rechazada', async () => {
    const svc = montar();
    const mala = entrada({ alternativas: [{ id: 'a1', descripcion: 'x', elegida: true, razonDescarte: null }, { id: 'a2', descripcion: 'y', elegida: false, razonDescarte: null }] });
    await expect(svc.crear(ctx(), 'd4', mala, attr, now)).rejects.toBeInstanceOf(DecisionMktInvalidaError);
  });

  it('rechaza una decisión de otra organización', async () => {
    const svc = montar();
    await expect(svc.crear(ctx('smileflow'), 'd5', entrada({ organizacionId: 'ssr-control' }), attr, now)).rejects.toBeInstanceOf(DecisionMktInvalidaError);
  });

  it('la máquina de estados es coherente (NO_EVALUABLE nunca va a APROBADA)', () => {
    expect(transicionValida('NO_EVALUABLE', 'APROBADA')).toBe(false);
    expect(transicionValida('NO_EVALUABLE', 'PROPUESTA')).toBe(true);
    expect(transicionValida('APROBADA', 'EN_EJECUCION')).toBe(true);
  });
});
