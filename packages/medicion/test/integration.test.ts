import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { CRITERIO_DEMO, GASTO_AUTORIZADO_DEMO, POLICY_OPT_DEMO, evaluarExperimento } from '../src';
import { FuenteMetricasSimulada } from '../src/app/metrics-source';
import { attr, ctxFor, filas, IDS_MKT_CONT, montar, now, sembrarYPublicar } from './helpers';

function sincronizarCmd(publicationId: string, externalRef: string, canal: string) {
  return { publicationId, externalRef, canal, cuenta: 'cuenta-demo', token: 't', campaniaRef: `cmp-${canal}`, objetivoRef: IDS_MKT_CONT.objetivo, criterio: CRITERIO_DEMO, gastoAutorizado: GASTO_AUTORIZADO_DEMO, muestraMinima: 500, attribution: attr, occurredAt: now };
}
function optimizarCmd(publicationId: string, actividadId: string, canal: string) {
  return { publicationId, planId: IDS_MKT_CONT.plan, campaniaId: `cmp-${canal}`, actividadId, canal, objetivoId: IDS_MKT_CONT.objetivo, policyIdOperacional: IDS_MKT_CONT.politica, policyOpt: POLICY_OPT_DEMO, attribution: attr, occurredAt: now };
}

describe('Vertical de medición y optimización (piloto A–H)', () => {
  it('Caso A — evidencia insuficiente: no optimiza, decide esperar', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(new InMemoryEventStore(), source);
    const { ctx, publicationId, externalRef } = await sembrarYPublicar(m, 'act-blog-0');
    source.cargar(externalRef, filas(externalRef, 'insuficiente'));
    const med = await m.medicion.sincronizar(ctx, sincronizarCmd(publicationId, externalRef, 'blog'));
    expect(med.evaluacion?.clasificacion).toBe('evidencia_insuficiente');
    const opt = await m.optimizacion.optimizar(ctx, optimizarCmd(publicationId, 'act-blog-0', 'blog'));
    expect(opt.decision?.tipo).toBe('esperar_datos');
    expect(opt.estado).toBe('autorizada');
  });

  it('Caso C — variante ineficiente: pausa autorizada y aplicada (plan versionado)', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(new InMemoryEventStore(), source);
    const { ctx, publicationId, externalRef } = await sembrarYPublicar(m, 'act-blog-0');
    source.cargar(externalRef, filas(externalRef, 'bajo'));
    await m.medicion.sincronizar(ctx, sincronizarCmd(publicationId, externalRef, 'blog'));
    const opt = await m.optimizacion.optimizar(ctx, optimizarCmd(publicationId, 'act-blog-0', 'blog'));
    expect(opt.decision?.tipo).toBe('pausar_actividad');
    expect(opt.estado).toBe('aplicada');
    const plan = await m.planning.cargar(ctx, IDS_MKT_CONT.plan);
    expect(plan.actividades['act-blog-0']?.estado).toBe('omitida');
    expect(plan.optimizaciones.length).toBeGreaterThan(0);
  });

  it('Caso D — escalamiento bloqueado: sobre objetivo pero la política exige aprobación → denegada', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(new InMemoryEventStore(), source);
    const { ctx, publicationId, externalRef } = await sembrarYPublicar(m, 'act-blog-0');
    source.cargar(externalRef, filas(externalRef, 'alto'));
    await m.medicion.sincronizar(ctx, sincronizarCmd(publicationId, externalRef, 'blog'));
    const opt = await m.optimizacion.optimizar(ctx, optimizarCmd(publicationId, 'act-blog-0', 'blog'));
    expect(opt.decision?.tipo).toBe('aumentar_frecuencia');
    expect(opt.estado).toBe('denegada');
  });

  it('Caso E — datos retrasados: reevalúa sin duplicar; conclusión versionada', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(new InMemoryEventStore(), source);
    const { ctx, publicationId, externalRef } = await sembrarYPublicar(m, 'act-blog-0');
    source.cargar(externalRef, filas(externalRef, 'insuficiente', 1));
    const med1 = await m.medicion.sincronizar(ctx, sincronizarCmd(publicationId, externalRef, 'blog'));
    expect(med1.evaluacion?.clasificacion).toBe('evidencia_insuficiente');
    source.cargar(externalRef, filas(externalRef, 'alto', 2)); // datos tardíos, secuencia mayor
    const med2 = await m.medicion.sincronizar(ctx, sincronizarCmd(publicationId, externalRef, 'blog'));
    expect(med2.evaluacion?.clasificacion).toBe('sobre_objetivo');
    expect(med2.correcciones).toBeGreaterThan(0);
    expect(med2.metricas.impresiones?.valor).toBe(1000); // corregido, no duplicado
  });

  it('Caso F — atribución incierta: conversión sin identificador es inferencia, no atribución', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(new InMemoryEventStore(), source);
    const { ctx, publicationId, externalRef } = await sembrarYPublicar(m, 'act-blog-0');
    source.cargar(externalRef, filas(externalRef, 'bajo'));
    source.registrarConversion({ id: 'c1', externalId: externalRef, campaignRef: null, valor: 1, ocurridoEn: now });
    const med = await m.medicion.sincronizar(ctx, sincronizarCmd(publicationId, externalRef, 'blog'));
    expect(med.atribucion?.clase).toBe('inferencia');
    expect(med.atribucion?.conversiones).toBe(0);
  });

  it('Caso G — anomalía de gasto: bloquea escalamiento y registra la anomalía', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(new InMemoryEventStore(), source);
    const { ctx, publicationId, externalRef } = await sembrarYPublicar(m, 'act-blog-0');
    source.cargar(externalRef, filas(externalRef, 'gasto_excedido'));
    const med = await m.medicion.sincronizar(ctx, sincronizarCmd(publicationId, externalRef, 'blog'));
    expect(med.anomalias.some((a) => a.codigo === 'gasto_superior_autorizado')).toBe(true);
    const opt = await m.optimizacion.optimizar(ctx, optimizarCmd(publicationId, 'act-blog-0', 'blog'));
    expect(opt.decision?.tipo).toBe('mantener');
    expect(['autorizada', 'denegada']).toContain(opt.estado);
  });

  it('Caso B — variante superior: el experimento elige la ganadora con evidencia suficiente', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(new InMemoryEventStore(), source);
    const ctx = ctxFor();
    const a = await sembrarYPublicar(m, 'act-blog-0', ctx);
    const b = await sembrarYPublicar(m, 'act-linkedin-0', ctx);
    source.cargar(a.externalRef, filas(a.externalRef, 'bajo'));
    source.cargar(b.externalRef, filas(b.externalRef, 'alto'));
    const medA = await m.medicion.sincronizar(ctx, sincronizarCmd(a.publicationId, a.externalRef, 'blog'));
    const medB = await m.medicion.sincronizar(ctx, sincronizarCmd(b.publicationId, b.externalRef, 'linkedin'));
    const tcA = medA.indicadores.find((i) => i.tipo === 'tasa_conversion')!.valor!;
    const tcB = medB.indicadores.find((i) => i.tipo === 'tasa_conversion')!.valor!;
    const exp = { experimentoId: 'e1', hipotesis: 'B convierte más', metricaPrincipal: 'tasa_conversion', control: { actividadId: 'act-blog-0', publicationId: a.publicationId }, variante: { actividadId: 'act-linkedin-0', publicationId: b.publicationId }, minimoObservaciones: 500, margenMinimo: 0.2 };
    const res = evaluarExperimento(exp, tcA, 1000, tcB, 1000);
    expect(res.ganador).toBe('variante');
  });

  it('Caso H — ciclo completo: medir → optimizar → replanificar → re-medir → evaluación posterior', async () => {
    const source = new FuenteMetricasSimulada();
    const m = montar(new InMemoryEventStore(), source);
    const { ctx, publicationId, externalRef } = await sembrarYPublicar(m, 'act-blog-0');
    source.cargar(externalRef, filas(externalRef, 'bajo'));
    await m.medicion.sincronizar(ctx, sincronizarCmd(publicationId, externalRef, 'blog'));
    const opt = await m.optimizacion.optimizar(ctx, optimizarCmd(publicationId, 'act-blog-0', 'blog'));
    expect(opt.estado).toBe('aplicada');
    const planV = (await m.planning.cargar(ctx, IDS_MKT_CONT.plan)).optimizaciones.length;
    expect(planV).toBeGreaterThan(0);
    const post = await m.optimizacion.registrarEvaluacionPosterior(ctx, opt.optId, 'actividad pausada; sin nuevo gasto', attr, now);
    expect(post.estado).toBe('evaluada_posterior');
  });
});
