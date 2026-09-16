/**
 * BORRADOR SIN PRESUPUESTO y protección de la activación, en DOMINIO.
 *
 * Lo que se fija aquí:
 *   · DRAFT + presupuesto null                           → válido
 *   · DRAFT → ejecutable con presupuesto null            → rechazado
 *   · DRAFT → ejecutable con presupuesto <= 0            → rechazado
 *   · DRAFT → ejecutable con presupuesto > 0 y aprobada  → válido
 * y lo que hace que esa protección no sea decorativa: se aplica en `transicionar`, venga el dato de
 * donde venga (incluido un evento escrito por otra vía), y ni un borrador ni una decisión sin aprobar
 * pueden saltársela.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { DecisionMktService, type EntradaDecision } from '@soec/decisiones-mkt';
import {
  CampaniaService,
  CampaniaInvalidaError,
  SeparacionCampaniaVioladaError,
  TransicionCampaniaInvalidaError,
  EVENTOS_CAMPANIA,
  POLITICA_CAMPANIA_CONSERVADORA,
  campaniaStreamId,
  evaluarActivacion,
  type AlcanceGeografico,
  type EntradaBorrador,
} from '../src/index';

const now = '2026-09-16T15:00:00.000Z';
const attr: Attribution = { source: 'campanias', purpose: 'borrador', assumptions: ['test'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const ORG = 'org-prueba';

function ctx(org = ORG): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('planificador'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `c-${org}` };
}

function entradaDecision(over: Partial<EntradaDecision> = {}): EntradaDecision {
  return {
    organizacionId: ORG,
    objetivo: 'Generar evaluaciones',
    contexto: 'planificación sin presupuesto decidido',
    hechos: [],
    fuentes: ['especificación comercial'],
    faltantesObligatorios: [],
    inferencias: [],
    hipotesis: [{ id: 'h1', enunciado: 'la búsqueda capta demanda activa', tipo: 'HIPOTESIS' }],
    alternativas: [],
    justificacion: 'hipótesis de canal',
    riesgos: [],
    confianza: null,
    criterioExito: 'a definir con datos reales',
    criterioFracaso: 'a definir con datos reales',
    aprobacionRequerida: true,
    nivelAutonomia: 0,
    aprendizajeQueLaCambio: null,
    ...over,
  };
}

const ALCANCE: AlcanceGeografico = {
  pais: 'Chile',
  region: 'Región del Maule',
  provincia: 'Provincia de Curicó',
  comunas: ['Curicó', 'Teno', 'Romeral', 'Rauco', 'Molina', 'Sagrada Familia', 'Hualañé', 'Licantén', 'Vichuquén'],
  criterioUbicacion: 'PRESENCIA',
};

function borrador(over: Partial<EntradaBorrador> = {}): EntradaBorrador {
  return {
    organizacionId: ORG,
    decisionId: 'd1',
    objetivo: 'Generar evaluaciones/contactos',
    publico: 'personas ubicadas en el territorio',
    propuesta: 'evaluación clínica',
    mensaje: 'mensaje único del sitio',
    canal: 'GOOGLE_SEARCH',
    calendario: 'por definir',
    presupuesto: null,
    hipotesis: ['la búsqueda capta demanda activa'],
    metricas: ['whatsapp_intent', 'phone_intent'],
    criterioExito: 'a definir con datos reales',
    criterioPausa: 'a definir con datos reales',
    destino: 'https://www.ejemplo.cl/servicio/',
    requisitosPrevios: ['utm_source=google en la URL final'],
    alcanceGeografico: ALCANCE,
    ...over,
  };
}

const montar = () => {
  const store = new InMemoryEventStore();
  return { store, svc: new CampaniaService(store), dec: new DecisionMktService(store) };
};

/** Decisión en el estado pedido, dentro de ORG. */
async function decisionEn(store: EventStore, estado: 'NO_EVALUABLE' | 'PROPUESTA' | 'APROBADA' | 'RECHAZADA', id = 'd1'): Promise<void> {
  const d = new DecisionMktService(store);
  if (estado === 'NO_EVALUABLE') {
    await d.crear(ctx(), id, entradaDecision({ faltantesObligatorios: ['presupuesto'] }), attr, now);
    return;
  }
  await d.crear(ctx(), id, entradaDecision(), attr, now); // nace PROPUESTA
  if (estado === 'PROPUESTA') return;
  if (estado === 'RECHAZADA') {
    await d.transicionar(ctx(), id, 'RECHAZADA', attr, now);
    return;
  }
  await d.transicionar(ctx(), id, 'PENDIENTE_APROBACION', attr, now);
  await d.transicionar(ctx(), id, 'APROBADA', attr, now);
}

describe('BORRADOR sin presupuesto', () => {
  it('DRAFT + presupuesto null → válido, y el presupuesto queda null (no 0)', async () => {
    const { store, svc } = montar();
    await decisionEn(store, 'NO_EVALUABLE');
    const c = await svc.crearBorrador(ctx(), 'c1', borrador(), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    expect(c.existe).toBe(true);
    expect(c.estado).toBe('BORRADOR');
    expect(c.presupuesto).toBeNull();
    expect(c.canal).toBe('GOOGLE_SEARCH');
    expect(c.destino).toBe('https://www.ejemplo.cl/servicio/');
    expect(c.requisitosPrevios).toEqual(['utm_source=google en la URL final']);
    expect(c.alcanceGeografico).toEqual(ALCANCE);
    expect(c.aprobaciones).toEqual([]);
  });

  it('crear un borrador NO aprueba ni transiciona la decisión referenciada', async () => {
    const { store, svc, dec } = montar();
    await decisionEn(store, 'NO_EVALUABLE');
    await svc.crearBorrador(ctx(), 'c1', borrador(), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    expect((await dec.cargar(ctx(), 'd1')).estado).toBe('NO_EVALUABLE');
  });

  it('presupuesto 0 en un borrador se rechaza: la ausencia de decisión no se disfraza de cifra', async () => {
    const { store, svc } = montar();
    await decisionEn(store, 'NO_EVALUABLE');
    await expect(
      svc.crearBorrador(ctx(), 'c1', borrador({ presupuesto: { monto: 0, moneda: 'CLP' } }), POLITICA_CAMPANIA_CONSERVADORA, attr, now),
    ).rejects.toBeInstanceOf(CampaniaInvalidaError);
    await expect(
      svc.crearBorrador(ctx(), 'c2', borrador({ presupuesto: { monto: -5, moneda: 'CLP' } }), POLITICA_CAMPANIA_CONSERVADORA, attr, now),
    ).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('sigue sin haber campañas huérfanas ni cruces de organización', async () => {
    const { store, svc } = montar();
    await expect(svc.crearBorrador(ctx(), 'c1', borrador(), POLITICA_CAMPANIA_CONSERVADORA, attr, now)).rejects.toBeInstanceOf(CampaniaInvalidaError);
    await decisionEn(store, 'PROPUESTA');
    await expect(
      svc.crearBorrador(ctx(), 'c1', borrador({ organizacionId: 'otra-org' }), POLITICA_CAMPANIA_CONSERVADORA, attr, now),
    ).rejects.toBeInstanceOf(SeparacionCampaniaVioladaError);
    // Una decisión de ORG no existe vista desde otra organización.
    await expect(
      svc.crearBorrador(ctx('otra-org'), 'c1', borrador({ organizacionId: 'otra-org' }), POLITICA_CAMPANIA_CONSERVADORA, attr, now),
    ).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('una decisión RECHAZADA no origina ni un borrador', async () => {
    const { store, svc } = montar();
    await decisionEn(store, 'RECHAZADA');
    await expect(svc.crearBorrador(ctx(), 'c1', borrador(), POLITICA_CAMPANIA_CONSERVADORA, attr, now)).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('el borrador se edita; fuera de BORRADOR ya no', async () => {
    const { store, svc } = montar();
    await decisionEn(store, 'APROBADA');
    await svc.crearBorrador(ctx(), 'c1', borrador(), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    const editada = await svc.actualizarBorrador(ctx(), 'c1', { canal: 'ORGANIC_INSTAGRAM', requisitosPrevios: ['casos reales'] }, POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    expect(editada.canal).toBe('ORGANIC_INSTAGRAM');
    expect(editada.requisitosPrevios).toEqual(['casos reales']);
    expect(editada.presupuesto).toBeNull(); // lo no tocado se conserva

    await svc.actualizarBorrador(ctx(), 'c1', { presupuesto: { monto: 50000, moneda: 'CLP' } }, POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    await svc.transicionar(ctx(), 'c1', 'ACTIVA', attr, now);
    await expect(
      svc.actualizarBorrador(ctx(), 'c1', { canal: 'META_INSTAGRAM' }, POLITICA_CAMPANIA_CONSERVADORA, attr, now),
    ).rejects.toBeInstanceOf(TransicionCampaniaInvalidaError);
  });

  it('una edición no puede meter presupuesto 0 ni negativo', async () => {
    const { store, svc } = montar();
    await decisionEn(store, 'PROPUESTA');
    await svc.crearBorrador(ctx(), 'c1', borrador(), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    await expect(
      svc.actualizarBorrador(ctx(), 'c1', { presupuesto: { monto: 0, moneda: 'CLP' } }, POLITICA_CAMPANIA_CONSERVADORA, attr, now),
    ).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });
});

describe('Entrada a estado ejecutable (ACTIVA) · protegida en dominio', () => {
  it('DRAFT → ACTIVA con presupuesto null → rechazado, aunque la decisión esté APROBADA', async () => {
    const { store, svc } = montar();
    await decisionEn(store, 'APROBADA');
    await svc.crearBorrador(ctx(), 'c1', borrador({ presupuesto: null }), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    await expect(svc.transicionar(ctx(), 'c1', 'ACTIVA', attr, now)).rejects.toThrow(/presupuesto no definido/);
    expect((await svc.cargar(ctx(), 'c1')).estado).toBe('BORRADOR');
  });

  it('DRAFT → ACTIVA con presupuesto <= 0 → rechazado (dato escrito por otra vía: la guarda no confía en la entrada)', async () => {
    for (const monto of [0, -1]) {
      const { store, svc } = montar();
      await decisionEn(store, 'APROBADA');
      // Se escribe el evento DIRECTAMENTE en el store, sin pasar por las validaciones de creación:
      // la transición tiene que rechazarlo igual.
      await store.append(ctx(), campaniaStreamId(ORG, 'c1'), 0, [
        {
          type: EVENTOS_CAMPANIA.creada,
          payload: { ...borrador(), campaniaId: 'c1', presupuesto: { monto, moneda: 'CLP' }, aprobaciones: [], nivelAutonomia: 0, estado: 'BORRADOR' },
          attribution: attr,
          occurredAt: now,
        },
      ]);
      await expect(svc.transicionar(ctx(), 'c1', 'ACTIVA', attr, now)).rejects.toThrow(/presupuesto no positivo/);
      expect((await svc.cargar(ctx(), 'c1')).estado).toBe('BORRADOR');
    }
  });

  it('DRAFT → ACTIVA con presupuesto > 0 y decisión APROBADA → válido', async () => {
    const { store, svc } = montar();
    await decisionEn(store, 'APROBADA');
    await svc.crearBorrador(ctx(), 'c1', borrador(), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    await svc.actualizarBorrador(ctx(), 'c1', { presupuesto: { monto: 150000, moneda: 'CLP' } }, POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    const activa = await svc.transicionar(ctx(), 'c1', 'ACTIVA', attr, now);
    expect(activa.estado).toBe('ACTIVA');
  });

  it('presupuesto > 0 NO basta: con la decisión sin aprobar (NO_EVALUABLE / PROPUESTA) se rechaza', async () => {
    for (const estado of ['NO_EVALUABLE', 'PROPUESTA'] as const) {
      const { store, svc } = montar();
      await decisionEn(store, estado);
      await svc.crearBorrador(ctx(), 'c1', borrador({ presupuesto: { monto: 150000, moneda: 'CLP' } }), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
      await expect(svc.transicionar(ctx(), 'c1', 'ACTIVA', attr, now)).rejects.toThrow(/se requiere APROBADA/);
    }
  });

  it('PAUSADA → ACTIVA también pasa por la guarda', async () => {
    const { store, svc } = montar();
    await decisionEn(store, 'APROBADA');
    await svc.crearBorrador(ctx(), 'c1', borrador({ presupuesto: { monto: 1000, moneda: 'CLP' } }), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    await svc.transicionar(ctx(), 'c1', 'ACTIVA', attr, now);
    await svc.transicionar(ctx(), 'c1', 'PAUSADA', attr, now);
    // La decisión deja de autorizar (DETENIDA): reanudar se rechaza.
    const dec = new DecisionMktService(store);
    await dec.transicionar(ctx(), 'd1', 'DETENIDA', attr, now);
    await expect(svc.transicionar(ctx(), 'c1', 'ACTIVA', attr, now)).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('cancelar un borrador sin presupuesto sí se permite: la guarda es sólo para ejecutar', async () => {
    const { store, svc } = montar();
    await decisionEn(store, 'NO_EVALUABLE');
    await svc.crearBorrador(ctx(), 'c1', borrador(), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    expect((await svc.transicionar(ctx(), 'c1', 'CANCELADA', attr, now)).estado).toBe('CANCELADA');
  });

  it('evaluarActivacion informa TODOS los motivos a la vez', async () => {
    const { store, svc } = montar();
    await decisionEn(store, 'NO_EVALUABLE');
    const c = await svc.crearBorrador(ctx(), 'c1', borrador(), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
    const r = evaluarActivacion(c, await svc.estadoDecision(ctx(), c));
    expect(r.ok).toBe(false);
    expect(r.motivos).toHaveLength(2);
  });
});
