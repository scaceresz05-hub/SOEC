/**
 * Prueba que M9 (MeasurementService + OptimizationService de @soec/medicion) NO depende de
 * `MeasurementExperience`, de `escenario` ni de `FuenteMetricasSimulada`: opera sobre CUALQUIER
 * `MetricsSource` (aquí una fuente `modo: 'real'` inline) y decide en función del MedState.
 * Este archivo NO importa MeasurementExperience/FuenteMetricasSimulada a propósito.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import {
  MeasurementService, OptimizationService, type MetricsSource, type FilaProveedor, type ConversionProveedor,
} from '@soec/medicion';
import { PlanningService } from '@soec/marketing';
import { OperationalService } from '@soec/operacional';
import { CRITERIO_SMILEFLOW, POLICY_SMILEFLOW } from '../src/real-director/criterio-smileflow';

const ORG = 'org-test';
const AHORA = '2026-08-11T00:00:00.000Z';
const ATR: Attribution = { source: 't', purpose: 't', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };

function ctx(): RequestContext {
  const o = OrganizationId(ORG);
  return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}

/** Fuente arbitraria en `modo: 'real'` — demuestra que M9 no necesita la fuente simulada del demo. */
function fuente(filas: FilaProveedor[], conversiones: ConversionProveedor[] = []): MetricsSource {
  return {
    nombre: 'fuente-inline-real', modo: 'real',
    async obtener() { return { filas, cursor: null, conversiones }; },
    async obtenerDe(_t, _c, ref) { return filas.filter((f) => f.externalId === ref); },
  };
}
const fila = (metrica: string, valor: number, unidad = 'conteo', moneda: string | null = null): FilaProveedor => ({
  externalId: 'cmp', metrica, valor, unidad, moneda, periodo: '2026-08-11', ocurridoEn: AHORA, proveedorSeq: 1, acumulativa: true, estimada: false,
});

function servicios(src: MetricsSource) {
  const store = new InMemoryEventStore();
  const medicion = new MeasurementService(store, src);
  const optimizacion = new OptimizationService(store, new PlanningService(store, new OperationalService(store, [])));
  return { store, medicion, optimizacion };
}
const cmdMed = (src: string, muestraMinima: number) => ({
  publicationId: src, externalRef: 'cmp', canal: 'google_ads', cuenta: ORG, token: '-', campaniaRef: 'cmp', objetivoRef: CRITERIO_SMILEFLOW.objetivoId,
  criterio: { ...CRITERIO_SMILEFLOW, muestraMinima }, gastoAutorizado: null, muestraMinima, attribution: ATR, occurredAt: AHORA,
});
const cmdOpt = (src: string) => ({
  publicationId: src, planId: 'plan', campaniaId: 'cmp', actividadId: 'act', canal: 'google_ads', objetivoId: CRITERIO_SMILEFLOW.objetivoId,
  policyIdOperacional: 'pol', policyOpt: POLICY_SMILEFLOW, attribution: ATR, occurredAt: AHORA,
});

describe('M9 es independiente del demo (escenario/MeasurementExperience/FuenteMetricasSimulada)', () => {
  it('evidencia insuficiente ⇒ decision esperar_datos, estado autorizada, SIN efecto (OBSERVAR)', async () => {
    const { medicion, optimizacion } = servicios(fuente([fila('impresiones', 273), fila('clics', 7), fila('gasto', 6028, 'monetario', 'CLP'), fila('conversiones', 0)]));
    const med = await medicion.sincronizar(ctx(), cmdMed('p1', 1000));
    expect(med.evaluacion?.clasificacion).toBe('evidencia_insuficiente');
    const opt = await optimizacion.optimizar(ctx(), cmdOpt('p1'));
    expect(opt.decision?.tipo).toBe('esperar_datos');
    expect(opt.estado).toBe('autorizada'); // sin efecto: no toca ningún plan
    expect(opt.planVersionResultante).toBeNull();
  });

  it('evidencia suficiente y sobre objetivo ⇒ escalada que REQUIERE aprobación humana (denegada, no automática)', async () => {
    const { medicion, optimizacion } = servicios(fuente([fila('impresiones', 5000), fila('clics', 500), fila('gasto', 1000, 'monetario', 'CLP'), fila('conversiones', 50)]));
    const med = await medicion.sincronizar(ctx(), cmdMed('p2', 1000));
    expect(med.evaluacion?.evidenciaSuficiente).toBe(true);
    expect(med.evaluacion?.clasificacion).toBe('sobre_objetivo');
    const opt = await optimizacion.optimizar(ctx(), cmdOpt('p2'));
    expect(opt.decision?.tipo).toBe('aumentar_frecuencia');
    expect(opt.decision?.requiereAprobacion).toBe(true);
    expect(opt.estado).toBe('denegada'); // NO se auto-aplica: requiere aprobación humana explícita
  });
});
