/**
 * Configuración de Programas por Negocio (@soec/programas). Verifica: registro de negocio +
 * enumeración de orgs; creación de programa con 3 segmentos / 3 hipótesis / 3 campañas + contenido;
 * presupuesto simulado validado; ciclo gobernado SIMULADO con ROI SIMULADO (nunca REAL);
 * enumeración multi-campaña; idempotencia; PAUSA bloquea; aislamiento entre organizaciones.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { AutonomiaService, AutonomiaInvalidaError } from '@soec/autonomia';
import {
  NegocioConfigService,
  ProgramaService,
  CicloProgramaService,
  reconstruirVistaPrograma,
  ProgramaInvalidoError,
  type Segmento,
  type Hipotesis,
} from '../src/index';

const now = '2026-08-01T12:00:00.000Z';
const attr: Attribution = { source: 'programas', purpose: 'configurar', assumptions: ['test'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const ORG = 'smileflow-clinic-pilot';

function ctx(org = ORG): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
}

function seg(id: string, prioridad: number): Segmento {
  return { id, nombre: `Segmento ${id}`, descripcion: 'd', problemas: ['agenda'], necesidades: ['orden'], criterios: ['pyme'], prioridad };
}
function hip(id: string, segmentoId: string): Hipotesis {
  return { id, segmentoId, problema: 'agenda desordenada', propuesta: 'plataforma única', mensaje: 'ordena tu clínica', canalSimulado: 'correo', accionEsperada: 'solicitar demo', evidencia: [], informacionFaltante: [], confianza: 'MEDIA', estado: 'ABIERTA', criterioContinuacion: 'señal positiva' };
}

async function programaCompleto(store: EventStore, org = ORG): Promise<string> {
  const neg = new NegocioConfigService(store);
  await neg.registrar(ctx(org), { nombre: 'SmileFlow Clinic', descripcion: 'gestión clínicas dentales', industria: 'salud dental', pais: 'CL', moneda: 'CLP', zonaHoraria: 'America/Santiago' }, attr, now);
  const prog = new ProgramaService(store);
  const programaId = 'captacion-v1';
  await prog.crear(ctx(org), programaId, { nombre: 'Programa de captación', objetivoPrincipal: 'generar oportunidades', presupuestoTotalSimulado: 300000 }, attr, now);
  for (const [i, s] of [seg('a', 1), seg('b', 2), seg('c', 3)].entries()) {
    await prog.agregarSegmento(ctx(org), programaId, s, attr, now);
    await prog.agregarHipotesis(ctx(org), programaId, hip(`h${i + 1}`, s.id), attr, now);
  }
  const presupuestos = [120000, 100000, 80000];
  for (const [i, s] of ['a', 'b', 'c'].entries()) {
    await prog.vincularCampania(ctx(org), programaId, { nombre: `Campaña ${s}`, segmentoId: s, hipotesisId: `h${i + 1}`, publico: `clínicas ${s}`, propuesta: 'orden administrativo', mensaje: 'ordena tu clínica', canal: 'correo', presupuestoSimulado: presupuestos[i]!, duracionHipotetica: '14 días' }, attr, now);
    const campaignId = `${programaId}-c${i + 1}`;
    await prog.vincularContenido(ctx(org), programaId, campaignId, { canal: 'correo', cuerpo: 'Agenda tu demostración sin sobrecargar tu clínica.', marcaId: 'smileflow', productoServicio: 'software de gestión dental', llamadaAccion: 'Solicita una demostración', idioma: 'es' }, attr, now);
  }
  await prog.marcarListo(ctx(org), programaId, attr, now);
  return programaId;
}

describe('@soec/programas · configuración por negocio', () => {
  it('registra negocio, lo lista, y arma un programa con 3 segmentos/3 hipótesis/3 campañas', async () => {
    const store = new InMemoryEventStore();
    const programaId = await programaCompleto(store);
    const prog = new ProgramaService(store);
    const p = await prog.cargar(ctx(), programaId);
    expect(p.estado).toBe('LISTO');
    expect(p.segmentos).toHaveLength(3);
    expect(p.hipotesis).toHaveLength(3);
    expect(p.campanias).toHaveLength(3);
    expect(p.campanias.every((c) => c.contenidoIds.length >= 1)).toBe(true);

    const orgs = await new NegocioConfigService(store).listarOrganizaciones(ctx());
    expect(orgs.organizaciones.some((o) => o.org === ORG)).toBe(true);
    const idx = await prog.listar(ctx());
    expect(idx.programas.some((x) => x.programaId === programaId)).toBe(true);
  });

  it('rechaza segmentos e hipótesis con id duplicado (no sobrescribe ni duplica en silencio)', async () => {
    const store = new InMemoryEventStore();
    const prog = new ProgramaService(store);
    await new NegocioConfigService(store).registrar(ctx(), { nombre: 'X', descripcion: '', industria: '', pais: 'CL', moneda: 'CLP', zonaHoraria: 'UTC' }, attr, now);
    await prog.crear(ctx(), 'p1', { nombre: 'P', objetivoPrincipal: 'o', presupuestoTotalSimulado: 100000 }, attr, now);
    await prog.agregarSegmento(ctx(), 'p1', seg('a', 1), attr, now);
    await expect(prog.agregarSegmento(ctx(), 'p1', seg('a', 2), attr, now)).rejects.toBeInstanceOf(ProgramaInvalidoError);
    await prog.agregarHipotesis(ctx(), 'p1', hip('h1', 'a'), attr, now);
    await expect(prog.agregarHipotesis(ctx(), 'p1', hip('h1', 'a'), attr, now)).rejects.toBeInstanceOf(ProgramaInvalidoError);
    const p = await prog.cargar(ctx(), 'p1');
    expect(p.segmentos).toHaveLength(1); // no se duplicó
    expect(p.hipotesis).toHaveLength(1);
  });

  it('rechaza una campaña cuyo presupuesto excede el total simulado del programa', async () => {
    const store = new InMemoryEventStore();
    const prog = new ProgramaService(store);
    await new NegocioConfigService(store).registrar(ctx(), { nombre: 'X', descripcion: '', industria: '', pais: 'CL', moneda: 'CLP', zonaHoraria: 'America/Santiago' }, attr, now);
    await prog.crear(ctx(), 'p1', { nombre: 'P', objetivoPrincipal: 'o', presupuestoTotalSimulado: 100000 }, attr, now);
    await prog.agregarSegmento(ctx(), 'p1', seg('a', 1), attr, now);
    await prog.agregarHipotesis(ctx(), 'p1', hip('h1', 'a'), attr, now);
    await expect(
      prog.vincularCampania(ctx(), 'p1', { nombre: 'C', segmentoId: 'a', hipotesisId: 'h1', publico: 'x', propuesta: 'y', mensaje: 'z', canal: 'correo', presupuestoSimulado: 200000, duracionHipotetica: '14d' }, attr, now),
    ).rejects.toBeInstanceOf(ProgramaInvalidoError);
  });
});

describe('@soec/programas · ciclo gobernado (SIMULADO)', () => {
  it('ejecuta el ciclo sobre el programa: ejecuciones SIMULADAS, ROI SIMULADO (nunca REAL), aprendizaje', async () => {
    const store = new InMemoryEventStore();
    const programaId = await programaCompleto(store);
    const vista = await new CicloProgramaService(store).ejecutarCiclo(ctx(), programaId, attr, now);
    expect(vista.estadoPrograma).toBe('EVALUADO');
    expect(vista.campanias).toHaveLength(3); // enumeración multi-campaña
    for (const c of vista.campanias) {
      expect(c.ejecuciones.length).toBeGreaterThan(0);
      expect(c.ejecuciones.every((e) => e.naturaleza === 'SIMULADO')).toBe(true);
      expect(c.roi.clasificacion).toBe('SIMULADO');
      expect(c.roi.naturaleza).not.toBe('REAL');
    }
    expect(vista.aprendizajes).toHaveLength(1);
    expect(vista.modoEjecucion).toBe('PILOT');
    expect(vista.proximaRecomendacion).toMatch(/simulad/i);
  });

  it('es idempotente: ejecutar dos veces no duplica ejecuciones', async () => {
    const store = new InMemoryEventStore();
    const programaId = await programaCompleto(store);
    const svc = new CicloProgramaService(store);
    const v1 = await svc.ejecutarCiclo(ctx(), programaId, attr, now);
    const v2 = await svc.ejecutarCiclo(ctx(), programaId, attr, now);
    const total = (v: typeof v1) => v.campanias.reduce((s, c) => s + c.ejecuciones.length, 0);
    expect(total(v2)).toBe(total(v1));
  });

  it('en modo seguro (PAUSA) el ciclo del programa no se ejecuta', async () => {
    const store = new InMemoryEventStore();
    const programaId = await programaCompleto(store);
    await new AutonomiaService(store).pausar(ctx(), 'anomalía', attr, now);
    await expect(new CicloProgramaService(store).ejecutarCiclo(ctx(), programaId, attr, now)).rejects.toBeInstanceOf(AutonomiaInvalidaError);
  });

  it('aislamiento: el programa de una organización no es visible en otra', async () => {
    const store = new InMemoryEventStore();
    const programaId = await programaCompleto(store, ORG);
    const vistaAjena = await reconstruirVistaPrograma(store, ctx('otra-org'), programaId);
    expect(vistaAjena).toBeNull();
  });
});
