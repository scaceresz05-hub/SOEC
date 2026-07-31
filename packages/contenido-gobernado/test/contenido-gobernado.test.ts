/**
 * Contenido gobernado (Bloque D). Verifica las garantías exigidas por la directiva:
 *   - el contenido NO puede cambiar de organización vía la referencia externa (campaña);
 *   - contenido RECHAZADO no puede programarse;
 *   - una nueva versión preserva la trazabilidad previa (campaña, decisión);
 *   - el brief conserva decisión / campaña / público / fuente;
 *   - PUBLICADO_SIMULADO nunca es productivo.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { DecisionMktService, type EntradaDecision } from '@soec/decisiones-mkt';
import { CampaniaService, POLITICA_CAMPANIA_CONSERVADORA, type Campania, type EntradaCampania } from '@soec/campanias';
import {
  ContenidoGobernadoService,
  ContenidoGobernadoInvalidoError,
  SeparacionContenidoVioladaError,
  TransicionContenidoInvalidaError,
  esProductivo,
  type EntradaContenido,
} from '../src/index';

const now = '2026-07-27T12:00:00.000Z';
const attr: Attribution = { source: 'contenido-gob', purpose: 'crear', assumptions: ['test'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const ORG = 'smileflow';

function ctx(org = ORG): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `c-${org}` };
}

function entradaDecision(org: string): EntradaDecision {
  return {
    organizacionId: org,
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
  };
}

function entradaCampania(org: string): EntradaCampania {
  return {
    organizacionId: org,
    decisionId: 'd1',
    objetivo: 'Generar solicitudes de demostración',
    publico: 'clínicas dentales pyme',
    propuesta: 'agenda sin sobrecarga',
    mensaje: 'Solicita una demostración esta semana',
    canal: 'correo',
    calendario: '2026-08',
    presupuesto: { monto: 100000, moneda: 'CLP' },
    hipotesis: ['la captación local aumentará solicitudes'],
    metricas: ['solicitudes/mes'],
    criterioExito: '+20% solicitudes/mes',
    criterioPausa: 'CPL > umbral',
  };
}

/** Crea una campaña gobernada real (decisión aprobada → campaña) en la org indicada. */
async function campaniaReal(store: EventStore, org: string): Promise<Campania> {
  const dec = new DecisionMktService(store);
  await dec.crear(ctx(org), 'd1', entradaDecision(org), attr, now);
  await dec.transicionar(ctx(org), 'd1', 'PENDIENTE_APROBACION', attr, now);
  await dec.transicionar(ctx(org), 'd1', 'APROBADA', attr, now);
  const camp = new CampaniaService(store);
  return camp.crearDesdeDecision(ctx(org), 'c1', entradaCampania(org), POLITICA_CAMPANIA_CONSERVADORA, attr, now);
}

function entradaContenido(over: Partial<EntradaContenido> = {}): EntradaContenido {
  return {
    canal: 'correo',
    cuerpo: 'Hola, agenda tu demostración sin sobrecargar tu clínica.',
    marcaId: 'marca-smileflow',
    productoServicio: 'software de agenda dental',
    llamadaAccion: 'Solicita una demostración',
    idioma: 'es',
    ...over,
  };
}

const montar = () => {
  const store = new InMemoryEventStore();
  return { store, svc: new ContenidoGobernadoService(store) };
};

describe('@soec/contenido-gobernado · derivación y trazabilidad', () => {
  it('el brief conserva decisión, campaña, público y fuentes', async () => {
    const { store, svc } = montar();
    const campania = await campaniaReal(store, ORG);
    const c = await svc.derivarDeCampania(ctx(), 'ct1', campania, entradaContenido(), attr, now);
    expect(c.existe).toBe(true);
    expect(c.campaniaId).toBe('c1');
    expect(c.decisionId).toBe('d1');
    expect(c.publico).toBe('clínicas dentales pyme');
    expect(c.fuentes).toContain('decision:d1');
    expect(c.fuentes).toContain('campania:c1');
    expect(c.brief?.campaniaId).toBe('c1');
    expect(c.brief?.audiencia).toBe('clínicas dentales pyme');
    expect(c.faltantesBrief).toEqual([]);
  });
});

describe('@soec/contenido-gobernado · garantías de gobierno', () => {
  it('el contenido NO puede cambiar de organización vía la referencia externa (campaña de otra org)', async () => {
    const { store, svc } = montar();
    const campaniaAjena = await campaniaReal(store, 'otra-org'); // campaña real, pero de otra org
    await expect(
      svc.derivarDeCampania(ctx(ORG), 'ct1', campaniaAjena, entradaContenido(), attr, now),
    ).rejects.toBeInstanceOf(SeparacionContenidoVioladaError);
  });

  it('contenido RECHAZADO no puede programarse', async () => {
    const { store, svc } = montar();
    const campania = await campaniaReal(store, ORG);
    await svc.derivarDeCampania(ctx(), 'ct1', campania, entradaContenido(), attr, now);
    await svc.transicionar(ctx(), 'ct1', 'EN_REVISION', attr, now);
    const r = await svc.transicionar(ctx(), 'ct1', 'RECHAZADO', attr, now);
    expect(r.estado).toBe('RECHAZADO');
    await expect(svc.transicionar(ctx(), 'ct1', 'PROGRAMADO', attr, now)).rejects.toBeInstanceOf(TransicionContenidoInvalidaError);
  });

  it('una nueva versión preserva la trazabilidad previa (campaña, decisión) e incrementa la revisión', async () => {
    const { store, svc } = montar();
    const campania = await campaniaReal(store, ORG);
    const v1 = await svc.derivarDeCampania(ctx(), 'ct1', campania, entradaContenido(), attr, now);
    expect(v1.revision).toBe(1);
    const v2 = await svc.nuevaVersion(ctx(), 'ct1', 'Nuevo cuerpo mejorado con prueba social.', attr, now);
    expect(v2.revision).toBe(2);
    expect(v2.revisionPreviaCuerpo).toBe(v1.cuerpo);
    expect(v2.campaniaId).toBe('c1'); // trazabilidad preservada
    expect(v2.decisionId).toBe('d1');
    expect(v2.estado).toBe('BORRADOR');
  });

  it('PUBLICADO_SIMULADO nunca es productivo', async () => {
    const { store, svc } = montar();
    const campania = await campaniaReal(store, ORG);
    await svc.derivarDeCampania(ctx(), 'ct1', campania, entradaContenido(), attr, now);
    await svc.transicionar(ctx(), 'ct1', 'EN_REVISION', attr, now);
    await svc.transicionar(ctx(), 'ct1', 'APROBADO', attr, now);
    await svc.transicionar(ctx(), 'ct1', 'PROGRAMADO', attr, now);
    const pub = await svc.transicionar(ctx(), 'ct1', 'PUBLICADO_SIMULADO', attr, now);
    expect(pub.estado).toBe('PUBLICADO_SIMULADO');
    expect(esProductivo(pub.estado)).toBe(false);
  });

  it('un brief incompleto no puede pasar a revisión (no se inventa el dato)', async () => {
    const { store, svc } = montar();
    const campania = await campaniaReal(store, ORG);
    // Sin llamadaAccion → brief incompleto (campo obligatorio de la fábrica).
    await svc.derivarDeCampania(ctx(), 'ct1', campania, entradaContenido({ llamadaAccion: '' }), attr, now);
    await expect(svc.transicionar(ctx(), 'ct1', 'EN_REVISION', attr, now)).rejects.toBeInstanceOf(ContenidoGobernadoInvalidoError);
  });
});
