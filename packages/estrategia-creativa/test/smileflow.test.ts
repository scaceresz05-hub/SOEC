/**
 * @soec/estrategia-creativa · Tramo L · CASO SMILEFLOW reproducible (end-to-end, SIMULADO). Semilla
 * sintética (sin datos reales): 3 clientes ideales → 3 segmentos, 3 hipótesis → 3 campañas, 3 estrategias
 * creativas, ≥6 piezas (2 por campaña), 2 variantes A/B por campaña, 1 calendario, aprobaciones humanas
 * con actor, ejecución simulada + métricas + aprendizajes. Destruible y recreable: cada corrida parte de
 * una tienda en memoria nueva, por lo que el resultado es determinista y reproducible.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { ConocimientoComercialService, HipotesisComercialService } from '@soec/crm-comercial';
import { ProgramaService } from '@soec/programas';
import {
  AprobacionService,
  CalendarioEditorialService,
  EstrategiaCreativaArtefactoService,
  OrquestadorProgramaGenerativo,
  VariantesABService,
  estrategiaCreativaId,
  type ParametrosCampania,
} from '../src/index';

const attr: Attribution = { source: 'smileflow', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const ORG = 'smileflow-clinic-pilot';
const PROG = 'captacion-smileflow-v1';
const O = '2026-08-01T00:00:00.000Z';
const DECL = 'DATO_DECLARADO_POR_USUARIO' as const;
const ctx = (): RequestContext => {
  const o = OrganizationId(ORG);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'smileflow' };
};
const PARAMS: ParametrosCampania = {
  objetivoComercial: 'generar oportunidades de clínicas', objetivoMarketing: 'solicitudes de demo', indicador: 'demos', lineaBase: 0, valorEsperado: 30,
  horizonteDias: 30, prioridad: 'alta', restricciones: ['no es consejo médico'], presupuestoTotal: 300000, frecuenciaDias: 2,
  territorio: 'CL', idioma: 'es', moneda: 'CLP', canales: ['correo'],
};

/** Semilla sintética de SmileFlow: negocio + producto + 3 ICP + 3 hipótesis con evidencia. Sin datos reales. */
async function sembrarSmileFlow(store: EventStore): Promise<void> {
  const con = new ConocimientoComercialService(store);
  const hip = new HipotesisComercialService(store);
  const c = ctx();
  await con.registrarEntidad(c, 'empresa', 'EMPRESA', 'SmileFlow', attr, O);
  await con.establecerCampo(c, 'empresa', 'propuestaValor', 'Plataforma única de gestión para clínicas dentales', DECL, attr, O);
  await con.registrarEntidad(c, 'prod', 'PRODUCTO', 'Software de gestión dental', attr, O);
  await con.establecerCampo(c, 'prod', 'problemaQueResuelve', 'agenda desordenada e inasistencias', DECL, attr, O);
  await con.establecerCampo(c, 'prod', 'beneficios', 'orden de agenda y control administrativo', DECL, attr, O);
  const icps: [string, string, string][] = [
    ['icp-pequena', 'Clínica pequeña', 'agenda manual y olvidos'],
    ['icp-crecimiento', 'Clínica en crecimiento', 'falta de visibilidad operativa'],
    ['icp-multisede', 'Centro multi-sede', 'pérdida de control al crecer'],
  ];
  for (const [id, nombre, dolor] of icps) {
    await con.registrarEntidad(c, id, 'CLIENTE_IDEAL', nombre, attr, O);
    await con.establecerCampo(c, id, 'dolores', dolor, DECL, attr, O);
  }
  // A-2: cada hipótesis se asocia EXPLÍCITAMENTE a su propio segmento/ICP (HA→A, HB→B, HC→C).
  const hips: [string, string, string][] = [
    ['h-agenda', 'El correo convierte para clínicas con agenda desordenada', 'icp-pequena'],
    ['h-control', 'La visibilidad integrada convierte para clínicas en crecimiento', 'icp-crecimiento'],
    ['h-crecer', 'La operación multi-sede convierte para centros que crecen', 'icp-multisede'],
  ];
  for (const [id, enunciado, segmentoId] of hips) {
    await hip.registrar(c, id, enunciado, 'canales', attr, O, { segmentoId });
    await hip.agregarEvidencia(c, id, `${id}-e1`, 'segmento responde a correo', 'DATO_IMPORTADO', true, attr, O);
  }
}

/** Corre el caso completo sobre una tienda nueva y devuelve todos los agregados para inspección. */
async function correrCaso() {
  const store = new InMemoryEventStore();
  await sembrarSmileFlow(store);
  const res = await new OrquestadorProgramaGenerativo(store).generarPrograma(ctx(), PROG, PARAMS, attr, O);
  const prog = await new ProgramaService(store).cargar(ctx(), PROG);
  return { store, res, prog };
}

describe('@soec/estrategia-creativa · Tramo L · caso SmileFlow reproducible', () => {
  it('genera la estructura completa SIMULADA y deja el programa EVALUADO con métricas y aprendizajes', async () => {
    const { store, res, prog } = await correrCaso();
    expect(res.tipo).toBe('PROPUESTA');
    if (res.tipo !== 'PROPUESTA') return;

    // Estructura: 1 programa EVALUADO, 3 segmentos, 3 hipótesis, 3 campañas, ≥6 piezas.
    expect(prog.estado).toBe('EVALUADO');
    expect(prog.segmentos).toHaveLength(3);
    expect(prog.hipotesis).toHaveLength(3);
    expect(prog.campanias).toHaveLength(3);
    const piezas = prog.campanias.flatMap((c) => c.contenidoIds);
    expect(piezas.length).toBeGreaterThanOrEqual(6);
    expect(prog.campanias.every((c) => c.contenidoIds.length === 2)).toBe(true); // 2 piezas por campaña

    // A-2: las 3 campañas apuntan a 3 segmentos DISTINTOS (HA→A, HB→B, HC→C), no todas al principal.
    const segmentosCampanias = prog.campanias.map((c) => c.segmentoId).sort();
    expect(new Set(segmentosCampanias).size).toBe(3);
    expect(segmentosCampanias).toEqual(['icp-crecimiento', 'icp-multisede', 'icp-pequena']);
    // Cada hipótesis usa su propio segmento (no el principal para todas).
    const porHip = new Map(prog.campanias.map((c) => [c.hipotesisId, c.segmentoId]));
    expect(porHip.get('h-agenda')).toBe('icp-pequena');
    expect(porHip.get('h-control')).toBe('icp-crecimiento');
    expect(porHip.get('h-crecer')).toBe('icp-multisede');

    // 3 estrategias creativas persistidas (una por hipótesis), SIMULADO y con afirmaciones con procedencia.
    const artSvc = new EstrategiaCreativaArtefactoService(store);
    for (const h of prog.hipotesis) {
      const art = await artSvc.cargar(ctx(), estrategiaCreativaId(PROG, h.id));
      expect(art.existe).toBe(true);
      expect(art.artefacto?.naturaleza).toBe('SIMULADO');
    }

    // 2 variantes A/B por campaña (sobre la pieza base), una sola variable.
    const abSvc = new VariantesABService(store);
    for (const c of prog.campanias) {
      const exp = await abSvc.cargar(ctx(), c.contenidoIds[0]!);
      expect(exp.variantes).toHaveLength(2);
      expect(exp.variantes.every((v) => v.elementoModificado === 'gancho')).toBe(true);
    }

    // 1 calendario editorial con una entrada por pieza.
    const cal = await new CalendarioEditorialService(store).cargar(ctx(), PROG);
    expect(cal.entradas.length).toBe(piezas.length);

    // Aprobaciones humanas con actor registrado (piloto director humano) para cada pieza.
    const aprSvc = new AprobacionService(store);
    for (const pieza of piezas) {
      const st = await aprSvc.cargar(ctx(), 'PIEZA', pieza);
      expect(st.ultima?.decision).toBe('APROBADA');
      expect(st.ultima?.actorUserId).toBe('director');
    }

    // Ejecución SIMULADA + métricas (ROI SIMULADO, nunca REAL) + aprendizajes.
    for (const c of res.vista.campanias) {
      expect(c.ejecuciones.length).toBeGreaterThan(0);
      expect(c.ejecuciones.every((e) => e.naturaleza === 'SIMULADO')).toBe(true);
      expect(c.roi.naturaleza).not.toBe('REAL');
    }
    expect(res.vista.aprendizajes.length).toBeGreaterThan(0);
  });

  it('es reproducible: dos corridas independientes (tiendas nuevas) producen la misma estructura', async () => {
    const a = await correrCaso();
    const b = await correrCaso();
    const forma = (p: Awaited<ReturnType<typeof correrCaso>>['prog']) => ({
      estado: p.estado,
      segmentos: p.segmentos.length,
      hipotesis: p.hipotesis.length,
      campanias: p.campanias.length,
      piezas: p.campanias.flatMap((c) => c.contenidoIds).length,
    });
    expect(forma(a.prog)).toEqual(forma(b.prog));
    expect(forma(a.prog)).toEqual({ estado: 'EVALUADO', segmentos: 3, hipotesis: 3, campanias: 3, piezas: 6 });
  });

  it('es re-ejecutable sobre la misma tienda sin duplicar (idempotente)', async () => {
    const store = new InMemoryEventStore();
    await sembrarSmileFlow(store);
    const orq = new OrquestadorProgramaGenerativo(store);
    await orq.generarPrograma(ctx(), PROG, PARAMS, attr, O);
    await orq.generarPrograma(ctx(), PROG, PARAMS, attr, O); // segunda corrida
    const prog = await new ProgramaService(store).cargar(ctx(), PROG);
    expect(prog.campanias).toHaveLength(3);
    expect(prog.campanias.flatMap((c) => c.contenidoIds)).toHaveLength(6); // sin duplicar piezas
  });
});
