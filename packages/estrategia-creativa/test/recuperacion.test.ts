/**
 * @soec/estrategia-creativa · Tramo I · RECUPERACIÓN ante fallos parciales. Si la tienda falla a mitad de
 * la preparación (append de una campaña, un contenido, una variante o el calendario), un reintento debe
 * completar el flujo SIN duplicar nada: el orquestador es idempotente y reconstruible desde los eventos.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type AppendResult, type Attribution, type EventInput, type EventStore, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { ConocimientoComercialService, HipotesisComercialService } from '@soec/crm-comercial';
import { ProgramaService } from '@soec/programas';
import { CalendarioEditorialService, OrquestadorProgramaGenerativo, VariantesABService, type ParametrosCampania } from '../src/index';

const attr: Attribution = { source: 'i', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const O = '2026-07-31T00:00:00.000Z';
const DECL = 'DATO_DECLARADO_POR_USUARIO' as const;
const PARAMS: ParametrosCampania = {
  objetivoComercial: 'crecer', objetivoMarketing: 'leads', indicador: 'leads', lineaBase: 0, valorEsperado: 100,
  horizonteDias: 30, prioridad: 'alta', restricciones: [], presupuestoTotal: 100000, frecuenciaDias: 2,
  territorio: 'CL', idioma: 'es', moneda: 'CLP', canales: ['correo'],
};

async function sembrar(store: EventStore, org = 'org-a') {
  const con = new ConocimientoComercialService(store);
  const hip = new HipotesisComercialService(store);
  const c = ctx(org);
  await con.registrarEntidad(c, 'empresa', 'EMPRESA', 'SmileFlow', attr, O);
  await con.establecerCampo(c, 'empresa', 'propuestaValor', 'Odontología cercana y a plazos', DECL, attr, O);
  await con.registrarEntidad(c, 'p1', 'PRODUCTO', 'Ortodoncia invisible', attr, O);
  await con.establecerCampo(c, 'p1', 'problemaQueResuelve', 'alinear dientes sin brackets', DECL, attr, O);
  await con.establecerCampo(c, 'p1', 'beneficios', 'sonrisa alineada discreta', DECL, attr, O);
  await con.registrarEntidad(c, 'icp1', 'CLIENTE_IDEAL', 'Adultos jóvenes profesionales', attr, O);
  await con.establecerCampo(c, 'icp1', 'dolores', 'vergüenza por dientes torcidos', DECL, attr, O);
  await hip.registrar(c, 'h1', 'Correo convierte para el ICP joven', 'canales', attr, O);
  await hip.agregarEvidencia(c, 'h1', 'e1', 'ICP responde a email', 'DATO_IMPORTADO', true, attr, O);
}

/** Tienda que falla el append a streams cuyo id contiene un patrón, las primeras N veces. Luego deja pasar. */
class TiendaQueFalla implements EventStore {
  private restantes: number;
  constructor(private readonly inner: EventStore, private readonly patron: string, veces: number) {
    this.restantes = veces;
  }
  async append(ctx: RequestContext, streamId: string, expectedVersion: number, events: readonly EventInput[]): Promise<AppendResult> {
    if (this.restantes > 0 && streamId.includes(this.patron)) {
      this.restantes -= 1;
      throw new Error(`fallo simulado de append en ${streamId}`);
    }
    return this.inner.append(ctx, streamId, expectedVersion, events);
  }
  readStream(ctx: RequestContext, streamId: string): Promise<readonly RecordedEvent[]> {
    return this.inner.readStream(ctx, streamId);
  }
  reconstructAt(ctx: RequestContext, streamId: string, asOf: string): Promise<readonly RecordedEvent[]> {
    return this.inner.reconstructAt(ctx, streamId, asOf);
  }
  currentVersion(ctx: RequestContext, streamId: string): Promise<number> {
    return this.inner.currentVersion(ctx, streamId);
  }
}

describe('@soec/estrategia-creativa · Tramo I · recuperación ante fallos parciales', () => {
  it('falla el append del calendario a mitad; un reintento completa sin duplicar campañas ni piezas', async () => {
    const inner = new InMemoryEventStore();
    await sembrar(inner);
    const store = new TiendaQueFalla(inner, 'calendario:', 1);
    const orq = new OrquestadorProgramaGenerativo(store);
    await expect(orq.generarPrograma(ctx(), 'prog1', PARAMS, attr, O)).rejects.toThrow(/fallo simulado/);
    // Reintento sobre la MISMA tienda (ya no falla): completa el flujo.
    const res = await orq.generarPrograma(ctx(), 'prog1', PARAMS, attr, O);
    expect(res.tipo).toBe('PROPUESTA');
    const prog = await new ProgramaService(store).cargar(ctx(), 'prog1');
    expect(prog.estado).toBe('EVALUADO');
    expect(prog.campanias).toHaveLength(1); // no duplicó la campaña
    const piezas = prog.campanias.flatMap((c) => c.contenidoIds);
    expect(new Set(piezas).size).toBe(piezas.length); // sin piezas duplicadas
    const cal = await new CalendarioEditorialService(store).cargar(ctx(), 'prog1');
    expect(cal.entradas.length).toBeGreaterThan(0); // el calendario terminó poblado
  });

  it('falla un append al stream del programa; el reintento repara sin duplicar campañas', async () => {
    const inner = new InMemoryEventStore();
    await sembrar(inner);
    const store = new TiendaQueFalla(inner, 'programa:', 1); // falla el 1.er append al stream del programa
    const orq = new OrquestadorProgramaGenerativo(store);
    await expect(orq.generarPrograma(ctx(), 'prog1', PARAMS, attr, O)).rejects.toThrow();
    const res = await orq.generarPrograma(ctx(), 'prog1', PARAMS, attr, O);
    expect(res.tipo).toBe('PROPUESTA');
    const prog = await new ProgramaService(store).cargar(ctx(), 'prog1');
    expect(prog.campanias).toHaveLength(1);
  });

  it('falla el append de una variante A/B; el reintento la completa sin duplicar variantes', async () => {
    const inner = new InMemoryEventStore();
    await sembrar(inner);
    const store = new TiendaQueFalla(inner, 'ab:', 1);
    const orq = new OrquestadorProgramaGenerativo(store);
    await expect(orq.generarPrograma(ctx(), 'prog1', PARAMS, attr, O)).rejects.toThrow();
    const res = await orq.generarPrograma(ctx(), 'prog1', PARAMS, attr, O);
    expect(res.tipo).toBe('PROPUESTA');
    const prog = await new ProgramaService(store).cargar(ctx(), 'prog1');
    const pieza = prog.campanias[0]!.contenidoIds[0]!;
    const ab = await new VariantesABService(store).cargar(ctx(), pieza);
    expect(ab.variantes).toHaveLength(2); // exactamente 2, no duplicadas
  });
});
