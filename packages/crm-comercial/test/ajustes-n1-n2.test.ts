/**
 * @soec/crm-comercial · pruebas permanentes de los ajustes N-1 y N-2 del PR #4.
 * N-1: la política de scoring gobierna TODAS las dimensiones (incl. interés), es validada, y la
 * confianza deriva de la evidencia. N-2: límites de texto en los comandos de hipótesis/resultado/
 * aprendizaje. Usa InMemoryEventStore.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import {
  ComandoCrmInvalidoError,
  CrmComercialService,
  HipotesisComercialService,
  POLITICA_SCORING_V1,
  type PoliticaScoringComercial,
  puntuarContacto,
  validarPolitica,
} from '../src/index';

const attr: Attribution = { source: 'n', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const PASADO = '2026-01-01T00:00:00.000Z';
const O = '2026-07-31T00:00:00.000Z';
const nuevo = (id: string, n: string) => ({ contactoId: id, nombre: n, origen: 'DATO_DECLARADO_POR_USUARIO' as const });

async function contactoConCompra(origen: 'HECHO_VERIFICADO' | 'INFERENCIA' = 'HECHO_VERIFICADO') {
  const s = new CrmComercialService(new InMemoryEventStore());
  await s.registrarContacto(ctx(), nuevo('c1', 'A'), attr, PASADO);
  await s.registrarActividad(ctx(), 'c1', { actividadId: 'a1', tipo: 'COMPRA', detalle: 'x', valor: 1000, origen }, attr, '2026-07-20T00:00:00.000Z');
  return s.cargarContacto(ctx(), 'c1');
}

// ── N-1 ─────────────────────────────────────────────────────────────────────────────────────────
describe('N-1 · la política inyectada gobierna TODAS las dimensiones (incl. interés)', () => {
  it('cambiar pesoCompra cambia dimInteres de forma explicable (ya no ignora la política)', async () => {
    const st = await contactoConCompra();
    const base = puntuarContacto(st, O); // pesoCompra 0.25
    const sinPesoCompra: PoliticaScoringComercial = { ...POLITICA_SCORING_V1, version: 'v-sin-compra', pesos: { ...POLITICA_SCORING_V1.pesos, interes: { ...POLITICA_SCORING_V1.pesos.interes, pesoCompra: 0 } } };
    const alt = puntuarContacto(st, O, { politica: sinPesoCompra });
    expect(alt.politicaVersion).toBe('v-sin-compra');
    expect(alt.dimensiones.interes.valor).toBeLessThan(base.dimensiones.interes.valor ?? 1); // la política SÍ afecta interés
  });

  it('misma evidencia + misma política → determinista; política distinta → resultado distinto', async () => {
    const st = await contactoConCompra();
    expect(puntuarContacto(st, O)).toEqual(puntuarContacto(st, O));
    const otra: PoliticaScoringComercial = { ...POLITICA_SCORING_V1, version: 'v2', umbralBandaAlta: 0.99 };
    expect(puntuarContacto(st, O, { politica: otra }).dimensiones.actividad.banda).not.toBe('ALTA');
  });

  it('la salida declara naturaleza HEURISTICA y politicaVersion', async () => {
    const st = await contactoConCompra();
    const p = puntuarContacto(st, O);
    expect(p.naturaleza).toBe('HEURISTICO');
    expect(p.politicaVersion).toBe(POLITICA_SCORING_V1.version);
  });

  it('una política inválida se rechaza antes del cálculo', () => {
    const bad = (o: Partial<PoliticaScoringComercial>) => () => validarPolitica({ ...POLITICA_SCORING_V1, ...o } as PoliticaScoringComercial);
    expect(bad({ version: '' })).toThrow(ComandoCrmInvalidoError);
    expect(bad({ ventanaDias: -1 })).toThrow(ComandoCrmInvalidoError);
    expect(bad({ ventanaDias: NaN })).toThrow(ComandoCrmInvalidoError);
    expect(bad({ umbralBandaAlta: 2 })).toThrow(ComandoCrmInvalidoError);
    expect(bad({ pesos: { ...POLITICA_SCORING_V1.pesos, actividad: { recencia: -1, frecuencia: 0.4 } } })).toThrow(ComandoCrmInvalidoError);
    expect(() => puntuarContacto({ organizacionId: 'o', contactoId: 'c', version: 0, existe: true, nombre: '', email: null, telefono: null, actividades: [], atributos: {}, creadoEn: PASADO, ultimaActividadEn: null }, O, { politica: { ...POLITICA_SCORING_V1, ventanaDias: -5 } })).toThrow(ComandoCrmInvalidoError);
  });

  it('confianza desde evidencia: baja calidad no da ALTA; más cobertura confiable sube; contradicción baja', async () => {
    const baja = await contactoConCompra('INFERENCIA');
    expect(puntuarContacto(baja, O).dimensiones.interes.confianza).not.toBe('ALTA');
    // 1 hecho verificado (cobertura < mínima) capa a MEDIA; 2 la habilitan a ALTA
    const s = new CrmComercialService(new InMemoryEventStore());
    await s.registrarContacto(ctx(), nuevo('c2', 'B'), attr, PASADO);
    await s.registrarActividad(ctx(), 'c2', { actividadId: 'a1', tipo: 'CONSULTA', detalle: 'x', origen: 'HECHO_VERIFICADO' }, attr, '2026-07-20T00:00:00.000Z');
    const una = puntuarContacto(await s.cargarContacto(ctx(), 'c2'), O);
    expect(una.dimensiones.interes.confianza).toBe('MEDIA'); // cobertura 1 < 2 → capa a MEDIA
    await s.registrarActividad(ctx(), 'c2', { actividadId: 'a2', tipo: 'RESPUESTA_POSITIVA', detalle: 'y', origen: 'HECHO_VERIFICADO' }, attr, '2026-07-21T00:00:00.000Z');
    const dos = puntuarContacto(await s.cargarContacto(ctx(), 'c2'), O);
    expect(dos.dimensiones.interes.confianza).toBe('ALTA'); // cobertura suficiente + origen confiable
    await s.registrarActividad(ctx(), 'c2', { actividadId: 'a3', tipo: 'RESPUESTA_NEGATIVA', detalle: 'z', origen: 'HECHO_VERIFICADO' }, attr, '2026-07-22T00:00:00.000Z');
    const contra = puntuarContacto(await s.cargarContacto(ctx(), 'c2'), O);
    expect(contra.dimensiones.interes.confianza).not.toBe('ALTA'); // contradicción degrada
  });
});

// ── N-2 ─────────────────────────────────────────────────────────────────────────────────────────
describe('N-2 · límites de texto en comandos de hipótesis/resultado/aprendizaje', () => {
  const hip = () => new HipotesisComercialService(new InMemoryEventStore());
  it('enunciado y contexto excesivos → error; límite exacto permitido', async () => {
    const s = hip();
    await expect(s.registrar(ctx(), 'h1', 'x'.repeat(501), 'c', attr, O)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
    await expect(s.registrar(ctx(), 'h2', 'x'.repeat(500), 'y'.repeat(2001), attr, O)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
    await expect(s.registrar(ctx(), 'h3', 'x'.repeat(500), 'y'.repeat(2000), attr, O)).resolves.toBeUndefined();
  });
  it('descripción de resultado vacía y excesiva → error', async () => {
    const s = hip();
    await s.registrar(ctx(), 'h1', 'X', 'c', attr, O);
    await s.agregarEvidencia(ctx(), 'h1', 'e1', 'a favor', 'HECHO_VERIFICADO', true, attr, O);
    await s.iniciarPrueba(ctx(), 'h1', attr, O);
    await expect(s.registrarResultado(ctx(), 'h1', '   ', 'CONFIRMADA', null, attr, O)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
    await expect(s.registrarResultado(ctx(), 'h1', 'd'.repeat(2001), 'CONFIRMADA', null, attr, O)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
  });
  it('porqué de aprendizaje excesivo → error; el evento no se escribe', async () => {
    const s = hip();
    await s.registrar(ctx(), 'h1', 'X', 'c', attr, O);
    await s.agregarEvidencia(ctx(), 'h1', 'e1', 'a favor', 'HECHO_VERIFICADO', true, attr, O);
    await s.iniciarPrueba(ctx(), 'h1', attr, O);
    await s.registrarResultado(ctx(), 'h1', 'ok', 'CONFIRMADA', null, attr, O);
    await expect(s.registrarAprendizaje(ctx(), 'h1', 'p'.repeat(4001), null, attr, O)).rejects.toBeInstanceOf(ComandoCrmInvalidoError);
    expect((await s.cargar(ctx(), 'h1')).aprendizajeId).toBeNull(); // no se persistió el vínculo
  });
});
