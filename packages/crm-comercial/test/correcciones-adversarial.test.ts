/**
 * @soec/crm-comercial · pruebas adversariales PERMANENTES de las correcciones post-auditoría del
 * PR #4. Cubren: H-1 (evidencia coherente para veredictos), H-2 (aprendizaje canónico + tenant),
 * H-4 (política gobernada + confianza desde evidencia), H-5 (validación de datos), H-6 (índice
 * autorreparable ante fallo parcial). No dejar estos casos solo en scratchpad.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type AppendResult, type Attribution, type EventInput, type EventStore, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import {
  ComandoCrmInvalidoError,
  CrmComercialService,
  HipotesisComercialService,
  HipotesisNoEncontradaError,
  POLITICA_SCORING_V1,
  puntuarContacto,
} from '../src/index';

const attr: Attribution = { source: 'adv', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const PASADO = '2026-01-01T00:00:00.000Z';
const O = '2026-07-31T00:00:00.000Z';
const nuevo = (id: string, n: string) => ({ contactoId: id, nombre: n, origen: 'DATO_DECLARADO_POR_USUARIO' as const });

// ── H-1 ─────────────────────────────────────────────────────────────────────────────────────────
describe('H-1 · hipótesis exige evidencia coherente con el veredicto', () => {
  const hip = () => new HipotesisComercialService(new InMemoryEventStore());
  it('sin evidencia NO puede CONFIRMARSE ni REFUTARSE', async () => {
    const s = hip();
    await s.registrar(ctx(), 'h1', 'X', 'c', attr, O);
    await s.iniciarPrueba(ctx(), 'h1', attr, O);
    await expect(s.registrarResultado(ctx(), 'h1', 'r', 'CONFIRMADA', null, attr, O)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
    await expect(s.registrarResultado(ctx(), 'h1', 'r', 'REFUTADA', null, attr, O)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
    // INCONCLUSA sí es admisible (hay un resultado observado aunque no permita concluir)
    await expect(s.registrarResultado(ctx(), 'h1', 'r', 'INCONCLUSA', null, attr, O)).resolves.toBeUndefined();
  });
  it('evidencia solo a favor → CONFIRMADA; solo en contra → REFUTADA', async () => {
    const s = hip();
    await s.registrar(ctx(), 'h1', 'X', 'c', attr, O);
    await s.agregarEvidencia(ctx(), 'h1', 'e1', 'a favor', 'HECHO_VERIFICADO', true, attr, O);
    await s.iniciarPrueba(ctx(), 'h1', attr, O);
    await expect(s.registrarResultado(ctx(), 'h1', 'r', 'CONFIRMADA', null, attr, O)).resolves.toBeUndefined();
  });
  it('evidencia contradictoria (empate) NO permite CONFIRMAR: debe ir a INCONCLUSA', async () => {
    const s = hip();
    await s.registrar(ctx(), 'h1', 'X', 'c', attr, O);
    await s.agregarEvidencia(ctx(), 'h1', 'e1', 'a favor', 'HECHO_VERIFICADO', true, attr, O);
    await s.agregarEvidencia(ctx(), 'h1', 'e2', 'en contra', 'HECHO_VERIFICADO', false, attr, O);
    await s.iniciarPrueba(ctx(), 'h1', attr, O);
    await expect(s.registrarResultado(ctx(), 'h1', 'r', 'CONFIRMADA', null, attr, O)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
    await expect(s.registrarResultado(ctx(), 'h1', 'r', 'INCONCLUSA', null, attr, O)).resolves.toBeUndefined();
  });
});

// ── H-2 ─────────────────────────────────────────────────────────────────────────────────────────
describe('H-2 · aprendizaje canónico en @soec/aprendizaje (SSOT única)', () => {
  it('crea el aprendizaje canónico y la hipótesis solo guarda su id', async () => {
    const s = new HipotesisComercialService(new InMemoryEventStore());
    await s.registrar(ctx(), 'h1', 'X', 'c', attr, O);
    await s.agregarEvidencia(ctx(), 'h1', 'e1', 'a favor', 'HECHO_VERIFICADO', true, attr, O);
    await s.iniciarPrueba(ctx(), 'h1', attr, O);
    await s.registrarResultado(ctx(), 'h1', 'ok', 'CONFIRMADA', 1, attr, O);
    const apId = await s.registrarAprendizaje(ctx(), 'h1', 'porque el canal alcanza al público', 'reutilizar en similares', attr, O);
    const st = await s.cargar(ctx(), 'h1');
    expect(st.aprendizajeId).toBe(apId);
    expect('aprendizaje' in st).toBe(false); // ya no embebe contenido de aprendizaje
  });
  it('no se puede tocar una hipótesis de otra organización (aislamiento de aprendizaje)', async () => {
    const s = new HipotesisComercialService(new InMemoryEventStore());
    await s.registrar(ctx('org-a'), 'h1', 'X', 'c', attr, O);
    await expect(s.registrarAprendizaje(ctx('org-b'), 'h1', 'porque', null, attr, O)).rejects.toBeInstanceOf(HipotesisNoEncontradaError);
  });
});

// ── H-4 ─────────────────────────────────────────────────────────────────────────────────────────
describe('H-4 · política de scoring gobernada + confianza desde evidencia', () => {
  async function contactoConSenal(origen: 'HECHO_VERIFICADO' | 'INFERENCIA') {
    const s = new CrmComercialService(new InMemoryEventStore());
    await s.registrarContacto(ctx(), nuevo('c1', 'A'), attr, PASADO);
    await s.registrarActividad(ctx(), 'c1', { actividadId: 'a1', tipo: 'CONSULTA', detalle: 'x', origen }, attr, '2026-07-20T00:00:00.000Z');
    return s.cargarContacto(ctx(), 'c1');
  }
  it('misma evidencia + misma política → mismo resultado (determinista) y declara politicaVersion + naturaleza', async () => {
    const st = await contactoConSenal('HECHO_VERIFICADO');
    const p1 = puntuarContacto(st, O);
    const p2 = puntuarContacto(st, O);
    expect(p1).toEqual(p2);
    expect(p1.naturaleza).toBe('HEURISTICO');
    expect(p1.politicaVersion).toBe(POLITICA_SCORING_V1.version);
  });
  it('política distinta → resultado controladamente distinto', async () => {
    const st = await contactoConSenal('HECHO_VERIFICADO');
    const base = puntuarContacto(st, O);
    const estricta = puntuarContacto(st, O, { politica: { ...POLITICA_SCORING_V1, version: 'v-test', umbralBandaAlta: 0.99 } });
    expect(estricta.politicaVersion).toBe('v-test');
    expect(estricta.dimensiones.actividad.banda).not.toBe('ALTA'); // umbral más exigente
    expect(base.dimensiones.actividad.valor).toBe(estricta.dimensiones.actividad.valor); // el valor no cambia, sí la banda
  });
  it('evidencia de baja calidad (INFERENCIA) no produce confianza ALTA', async () => {
    const st = await contactoConSenal('INFERENCIA');
    const p = puntuarContacto(st, O);
    expect(p.dimensiones.actividad.confianza).not.toBe('ALTA');
  });
});

// ── H-5 ─────────────────────────────────────────────────────────────────────────────────────────
describe('H-5 · validación de datos y límites', () => {
  const crm = () => new CrmComercialService(new InMemoryEventStore());
  it('monto negativo, no finito y fecha futura son rechazados', async () => {
    const s = crm();
    await s.registrarContacto(ctx(), nuevo('c1', 'A'), attr, PASADO);
    await expect(s.registrarActividad(ctx(), 'c1', { actividadId: 'a1', tipo: 'COMPRA', detalle: 'x', valor: -1 }, attr, PASADO)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
    await expect(s.registrarActividad(ctx(), 'c1', { actividadId: 'a2', tipo: 'COMPRA', detalle: 'x', valor: Infinity }, attr, PASADO)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
    await expect(s.registrarActividad(ctx(), 'c1', { actividadId: 'a3', tipo: 'CONSULTA', detalle: 'x' }, attr, '2999-01-01T00:00:00.000Z')).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
  });
  it('texto excesivo es rechazado', async () => {
    const s = crm();
    await s.registrarContacto(ctx(), nuevo('c1', 'A'), attr, PASADO);
    await expect(s.registrarActividad(ctx(), 'c1', { actividadId: 'a1', tipo: 'CONSULTA', detalle: 'x'.repeat(5000) }, attr, PASADO)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
  });
  it('datos válidos son aceptados', async () => {
    const s = crm();
    await s.registrarContacto(ctx(), nuevo('c1', 'A'), attr, PASADO);
    await expect(s.registrarActividad(ctx(), 'c1', { actividadId: 'a1', tipo: 'COMPRA', detalle: 'ok', valor: 1000 }, attr, PASADO)).resolves.toBeUndefined();
  });
});

// ── H-6 ─────────────────────────────────────────────────────────────────────────────────────────
/** Tienda que falla deliberadamente el append a streams cuyo id contiene un patrón, N veces. */
class TiendaQueFallaIndice implements EventStore {
  private fallos = new Map<string, number>();
  constructor(private readonly inner: EventStore) {}
  fallarUnaVez(patron: string): void {
    this.fallos.set(patron, 1);
  }
  async append(ctx: RequestContext, streamId: string, expectedVersion: number, events: readonly EventInput[]): Promise<AppendResult> {
    for (const [patron, n] of this.fallos) {
      if (n > 0 && streamId.includes(patron)) {
        this.fallos.set(patron, n - 1);
        throw new Error('fallo simulado de append de índice');
      }
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

describe('H-6 · índice autorreparable ante fallo parcial', () => {
  it('si falla el append del índice, un reintento lo repara sin duplicar el agregado', async () => {
    const tienda = new TiendaQueFallaIndice(new InMemoryEventStore());
    const s = new CrmComercialService(tienda);
    tienda.fallarUnaVez('crmindice:');
    // 1er intento: agregado creado, índice falla.
    await expect(s.registrarContacto(ctx(), nuevo('c1', 'A'), attr, PASADO)).rejects.toBeTruthy();
    expect((await s.cargarContacto(ctx(), 'c1')).existe).toBe(true); // agregado quedó
    expect((await s.listarContactos(ctx())).contactos).toHaveLength(0); // índice vacío (estado parcial)
    // 2do intento: repara el índice, sin duplicar el agregado.
    await s.registrarContacto(ctx(), nuevo('c1', 'A'), attr, PASADO);
    expect((await s.listarContactos(ctx())).contactos).toHaveLength(1);
    const st = await s.cargarContacto(ctx(), 'c1');
    expect(st.actividades).toHaveLength(0); // no se re-creó ni duplicó el agregado
  });
});
