import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import {
  BriefService,
  FactoryService,
  ProveedorGenerativoDeterminista,
  type ProveedorGenerativo,
  type RespuestaGenerativa,
} from '../src';
import { attr, ctxFor, montar, now, prepararCmd, sembrar, IDS_MKT_CONT } from './helpers';

const PLAN = IDS_MKT_CONT.plan;
const act = (canal: string) => `act-${canal}-0`;

async function estadoActividad(m: ReturnType<typeof montar>, ctx: RequestContext, canal: string) {
  const plan = await m.planning.cargar(ctx, PLAN);
  return plan.actividades[act(canal)];
}

describe('Vertical de la Fábrica de Contenido (actividad bloqueada → paquete → autorizable → ejecución simulada)', () => {
  it('Caso A — blog: produce un paquete LISTO y desbloquea la actividad a autorizable', async () => {
    const m = montar();
    const { ctx } = await sembrar(m);
    expect((await estadoActividad(m, ctx, 'blog'))?.estado).toBe('bloqueada');

    const r = await m.content.prepararContenidoParaActividad(ctx, prepararCmd(act('blog')));
    expect(r.actividadDesbloqueada).toBe(true);
    expect(r.paquete.resultadoProduccion).toBe('listo');
    expect(r.paquete.pieza?.cuerpo.length).toBeGreaterThan(0);
    expect(r.paquete.adaptaciones.length).toBeGreaterThan(0);
    expect(r.paquete.activos.length).toBeGreaterThan(0);
    expect((await estadoActividad(m, ctx, 'blog'))?.estado).toBe('autorizable');
  });

  it('Caso B — meta_ads: la generación trae una afirmación prohibida; la revisión la corrige y ninguna versión inválida llega a ejecución', async () => {
    const m = montar();
    const { ctx } = await sembrar(m);
    const r = await m.content.prepararContenidoParaActividad(ctx, prepararCmd(act('meta_ads')));
    // Hubo al menos una revisión que corrigió el hallazgo.
    expect(r.paquete.revisiones.some((rev) => rev.accion === 'corregida')).toBe(true);
    // La adaptación final NO contiene la afirmación prohibida.
    const ad = r.paquete.adaptaciones.find((a) => a.canal === 'meta_ads');
    expect(ad?.cuerpo.toLowerCase()).not.toContain('oferta imperdible');
    expect(r.paquete.resultadoProduccion).toBe('listo');
    expect(r.actividadDesbloqueada).toBe(true);
  });

  it('Caso C — facebook (canal no autorizado): produce borrador pero NO entrega ni ejecuta', async () => {
    const m = montar();
    const { ctx } = await sembrar(m);
    expect((await estadoActividad(m, ctx, 'facebook'))?.motivoBloqueo).toBe('canal_no_autorizado');
    const r = await m.content.prepararContenidoParaActividad(ctx, prepararCmd(act('facebook')));
    expect(r.actividadDesbloqueada).toBe(false);
    expect(r.motivo).toContain('canal_no_autorizado');
    expect((await estadoActividad(m, ctx, 'facebook'))?.estado).toBe('bloqueada');
  });

  it('Caso D — información insuficiente: el brief queda incompleto con faltantes; la pieza no se inventa', async () => {
    const m = montar();
    const ctx = ctxFor('orgA');
    const briefs = new BriefService(m.store);
    const incompleto = await briefs.crear(
      ctx,
      'brief-incompleto',
      {
        organizationId: 'orgA', marcaId: 'm', objetivoComercial: '', objetivoMarketing: '', iniciativaId: '', campaniaId: '', planId: 'p', actividadId: 'a',
        audiencia: 'administradores', segmento: '', etapaEmbudo: 'conversion', canalDestino: 'blog', proposito: 'informar',
        mensajePrincipal: 'x', propuestaValor: '', productoServicio: '', problemaCliente: '', llamadaAccion: '', tono: '', idioma: 'es', territorio: 'Chile',
        restricciones: [], afirmacionesPermitidas: [], afirmacionesProhibidas: [], requisitosLegales: [], fuentesDisponibles: [], fechaObjetivo: now,
      },
      attr,
      now,
    );
    expect(incompleto.estado).toBe('incompleto');
    expect(incompleto.faltantes).toContain('propuestaValor');
    expect(incompleto.faltantes).toContain('llamadaAccion');

    // La fábrica con un proveedor malformado no inventa: el paquete queda incompleto.
    const malformado: ProveedorGenerativo = {
      nombre: 'malformado', version: '0',
      async generar(): Promise<RespuestaGenerativa> {
        return { estado: 'valida', salida: { campos: {}, listas: {} }, proveedorLogico: 'malformado', modeloLogico: 'm@0', generadoEn: '2020-01-01T00:00:00.000Z', uso: { unidades: 0, costoEstimado: 0 }, advertencias: [], promptRef: 'p' };
      },
    };
    const factory = new FactoryService(malformado);
    const payload = await factory.producir(ctx, {
      paqueteId: 'pq', briefId: 'b', marcaId: 'm', planId: 'p', campaniaId: 'c', actividadId: 'a',
      brief: incompleto.contenido!, marca: null, afirmacionesProhibidas: [], canalesAutorizados: ['blog'], canalesDestino: ['blog'],
      promptPiezaRef: 'pp', promptAdaptRef: 'pa', occurredAt: now,
    });
    expect(payload.resultado).toBe('incompleto');
    expect(payload.pieza.estado).toBe('rechazada');
  });

  it('Caso E — multicanal: una misma pieza fuente produce varias adaptaciones conservando la semántica', async () => {
    const m = montar();
    const { ctx } = await sembrar(m);
    const r = await m.content.prepararContenidoParaActividad(ctx, prepararCmd(act('blog'), { canalesAdicionales: ['linkedin', 'instagram', 'correo'] }));
    const canales = r.paquete.adaptaciones.map((a) => a.canal).sort();
    expect(canales).toEqual(['blog', 'correo', 'instagram', 'linkedin']);
    // La semántica central (afirmaciones de la pieza) se conserva en cada adaptación, sin elevar certeza.
    const refAfirmaciones = JSON.stringify(r.paquete.pieza?.afirmaciones ?? []);
    for (const a of r.paquete.adaptaciones) {
      expect(JSON.stringify(a.afirmaciones)).toBe(refAfirmaciones);
    }
  });

  it('ejecuta la actividad preparada por el plano operacional (simulado) y verifica el paquete', async () => {
    const m = montar();
    const { ctx } = await sembrar(m);
    await m.content.prepararContenidoParaActividad(ctx, prepararCmd(act('blog')));
    const r = await m.planning.ejecutarSiguiente(ctx, PLAN, attr, now);
    expect(r.permitida).toBe(true);
    const paqueteId = `${PLAN}--${r.actividad}`;
    const paquete = await m.content.registrarEjecucion(ctx, paqueteId, { permitida: r.permitida, resultado: r.resultado, executionRef: `${PLAN}:${r.actividad}`, attribution: attr, occurredAt: now });
    expect(paquete.estado).toBe('verificado');
  });

  it('deniega el paquete cuando el costo de producción excede el límite (presupuesto de producción)', async () => {
    const ctx = ctxFor('orgA');
    const briefs = new BriefService(new InMemoryEventStore());
    const b = await briefs.crear(
      ctx,
      'brief-ok',
      {
        organizationId: 'orgA', marcaId: 'm', objetivoComercial: 'vender', objetivoMarketing: 'leads', iniciativaId: 'i', campaniaId: 'c', planId: 'p', actividadId: 'a',
        audiencia: 'administradores', segmento: 's', etapaEmbudo: 'conversion', canalDestino: 'blog', proposito: 'informar',
        mensajePrincipal: 'mantención confiable', propuestaValor: 'respuesta en 24h', productoServicio: 'mantención', problemaCliente: 'fallas', llamadaAccion: 'Cotiza', tono: 'cercano', idioma: 'es', territorio: 'Chile',
        restricciones: [], afirmacionesPermitidas: [], afirmacionesProhibidas: [], requisitosLegales: [], fuentesDisponibles: [], fechaObjetivo: now,
      },
      attr,
      now,
    );
    const factory = new FactoryService(new ProveedorGenerativoDeterminista());
    const payload = await factory.producir(ctx, {
      paqueteId: 'pq2', briefId: 'brief-ok', marcaId: 'm', planId: 'p', campaniaId: 'c', actividadId: 'a',
      brief: b.contenido!, marca: null, afirmacionesProhibidas: [], canalesAutorizados: ['blog'], canalesDestino: ['blog'],
      promptPiezaRef: 'pp', promptAdaptRef: 'pa', limiteProduccionPorPieza: 1, occurredAt: now,
    });
    expect(payload.resultado).toBe('denegado');
    expect(payload.hallazgos.some((h) => h.codigo === 'presupuesto_produccion_excedido')).toBe(true);
  });

  it('es idempotente por identidad de paquete y aisla por organización', async () => {
    const m = montar();
    const { ctx } = await sembrar(m);
    const r1 = await m.content.prepararContenidoParaActividad(ctx, prepararCmd(act('blog')));
    const r2 = await m.content.prepararContenidoParaActividad(ctx, prepararCmd(act('blog')));
    expect(r2.motivo).toBe('ya_producido');
    expect(r2.paquete.version).toBe(r1.paquete.version);
    const otra = await m.content.cargarPaquete(ctxFor('orgB'), r1.paquete.paqueteId);
    expect(otra.existe).toBe(false);
  });
});
