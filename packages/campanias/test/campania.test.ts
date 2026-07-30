/**
 * Campaña gobernada (Bloque C): solo nace de una decisión válida, aprobada y de la misma
 * organización. Se verifican los cinco rechazos exigidos por la directiva:
 *   1. decisión de otra organización → rechazo
 *   2. decisión NO_EVALUABLE → rechazo
 *   3. decisión no aprobada cuando la política exige aprobación → rechazo
 *   4. presupuesto incompatible → rechazo
 *   5. campaña sin hipótesis sin política que lo permita → rechazo (y con política → OK)
 * Más camino feliz con enlace de trazabilidad campaña→decisión.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { DecisionMktService, type EntradaDecision } from '@soec/decisiones-mkt';
import {
  CampaniaService,
  CampaniaInvalidaError,
  SeparacionCampaniaVioladaError,
  POLITICA_CAMPANIA_CONSERVADORA,
  type EntradaCampania,
  type PoliticaCampania,
} from '../src/index';

const now = '2026-07-26T12:00:00.000Z';
const attr: Attribution = { source: 'campanias', purpose: 'ejecutar', assumptions: ['test'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const ORG = 'smileflow';

function ctx(org = ORG): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `c-${org}` };
}

function entradaDecision(over: Partial<EntradaDecision> = {}): EntradaDecision {
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

/** Crea una decisión y la lleva hasta APROBADA en el store dado. */
async function decisionAprobada(store: EventStore, org: string, id: string): Promise<void> {
  const svc = new DecisionMktService(store);
  await svc.crear(ctx(org), id, entradaDecision({ organizacionId: org }), attr, now);
  await svc.transicionar(ctx(org), id, 'PENDIENTE_APROBACION', attr, now);
  await svc.transicionar(ctx(org), id, 'APROBADA', attr, now);
}

function entradaCampania(over: Partial<EntradaCampania> = {}): EntradaCampania {
  return {
    organizacionId: ORG,
    decisionId: 'd1',
    objetivo: 'Generar solicitudes de demostración',
    publico: 'clínicas dentales pyme',
    propuesta: 'agenda sin sobrecarga',
    mensaje: 'Solicita una demostración esta semana',
    canal: 'email',
    calendario: '2026-08',
    presupuesto: { monto: 100000, moneda: 'CLP' },
    hipotesis: ['la captación local aumentará solicitudes'],
    metricas: ['solicitudes/mes'],
    criterioExito: '+20% solicitudes/mes',
    criterioPausa: 'CPL > umbral',
    ...over,
  };
}

const montar = () => {
  const store = new InMemoryEventStore();
  return { store, svc: new CampaniaService(store) };
};

describe('@soec/campanias · camino feliz', () => {
  it('deriva una campaña gobernada desde una decisión APROBADA, con enlace de trazabilidad', async () => {
    const { store, svc } = montar();
    await decisionAprobada(store, ORG, 'd1');
    const c = await svc.crearDesdeDecision(ctx(), 'c1', entradaCampania(), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    expect(c.existe).toBe(true);
    expect(c.estado).toBe('BORRADOR');
    expect(c.decisionId).toBe('d1'); // trazabilidad campaña → decisión
    expect(c.organizacionId).toBe(ORG);
  });
});

describe('@soec/campanias · rechazos de gobierno', () => {
  it('1. decisión de otra organización → rechazo (no existe en el contexto)', async () => {
    const { store, svc } = montar();
    await decisionAprobada(store, 'otra-org', 'd1'); // decisión existe pero en otra org
    await expect(
      svc.crearDesdeDecision(ctx(), 'c1', entradaCampania(), POLITICA_CAMPANIA_CONSERVADORA, attr, now),
    ).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('1b. entrada con organizacionId distinto al contexto → separación violada', async () => {
    const { svc } = montar();
    await expect(
      svc.crearDesdeDecision(ctx(), 'c1', entradaCampania({ organizacionId: 'otra-org' }), POLITICA_CAMPANIA_CONSERVADORA, attr, now),
    ).rejects.toBeInstanceOf(SeparacionCampaniaVioladaError);
  });

  it('2. decisión NO_EVALUABLE → rechazo', async () => {
    const { store, svc } = montar();
    const dec = new DecisionMktService(store);
    await dec.crear(ctx(), 'd1', entradaDecision({ faltantesObligatorios: ['presupuesto', 'público'] }), attr, now);
    await expect(
      svc.crearDesdeDecision(ctx(), 'c1', entradaCampania(), POLITICA_CAMPANIA_CONSERVADORA, attr, now),
    ).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('3. decisión no aprobada (PROPUESTA) cuando la política exige aprobación → rechazo', async () => {
    const { store, svc } = montar();
    const dec = new DecisionMktService(store);
    await dec.crear(ctx(), 'd1', entradaDecision(), attr, now); // queda en PROPUESTA
    await expect(
      svc.crearDesdeDecision(ctx(), 'c1', entradaCampania(), POLITICA_CAMPANIA_CONSERVADORA, attr, now),
    ).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('4. presupuesto incompatible (excede el máximo de política) → rechazo', async () => {
    const { store, svc } = montar();
    await decisionAprobada(store, ORG, 'd1');
    const politica: PoliticaCampania = { requiereAprobacion: true, presupuestoMaximo: 50000, permiteNoExperimental: false };
    await expect(
      svc.crearDesdeDecision(ctx(), 'c1', entradaCampania({ presupuesto: { monto: 100000, moneda: 'CLP' } }), politica, attr, now),
    ).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('5. campaña sin hipótesis sin política que lo permita → rechazo', async () => {
    const { store, svc } = montar();
    await decisionAprobada(store, ORG, 'd1');
    await expect(
      svc.crearDesdeDecision(ctx(), 'c1', entradaCampania({ hipotesis: [] }), POLITICA_CAMPANIA_CONSERVADORA, attr, now),
    ).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('5b. campaña sin hipótesis CON política que lo permite → aceptada', async () => {
    const { store, svc } = montar();
    await decisionAprobada(store, ORG, 'd1');
    const politica: PoliticaCampania = { requiereAprobacion: true, presupuestoMaximo: Number.POSITIVE_INFINITY, permiteNoExperimental: true };
    const c = await svc.crearDesdeDecision(ctx(), 'c1', entradaCampania({ hipotesis: [] }), politica, attr, now);
    expect(c.existe).toBe(true);
    expect(c.hipotesis).toEqual([]);
  });
});
