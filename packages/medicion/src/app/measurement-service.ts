/**
 * Servicio de medición (F2-MET-01 §8, §12–§15, §21). Ingesta métricas de una fuente
 * proveedor-independiente, las normaliza y deduplica (conservando correcciones), evalúa
 * la calidad de la evidencia, calcula indicadores deterministas, atribuye con cautela,
 * detecta anomalías y evalúa el objetivo. No publica, no gasta, no modifica planes.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { detectarAnomalias, type Anomalia } from '../domain/anomaly';
import { atribuir, type ConversionObservada } from '../domain/attribution';
import { evaluar, type CriterioObjetivo, type Evaluacion } from '../domain/evaluation';
import { calcularIndicador, type Indicador, type TipoIndicador } from '../domain/indicator';
import { EVENTOS_MED, type MedState, medStreamId, reconstruirMed, valoresDe } from '../domain/med';
import { deduplicar, normalizar, type MetricaNormalizada, type Observacion } from '../domain/metrics';
import { evaluarCalidad, type SenalesCalidad } from '../domain/quality';
import type { MetricsSource } from './metrics-source';

const REQUERIDAS = ['impresiones', 'clics', 'conversiones', 'gasto'];
const INDICADORES: readonly TipoIndicador[] = ['ctr', 'tasa_conversion', 'cpl', 'cpa', 'roas'];

export interface SincronizarCmd {
  readonly publicationId: string;
  readonly externalRef: string;
  readonly canal: string;
  readonly cuenta: string;
  readonly token: string;
  readonly campaniaRef: string;
  readonly objetivoRef: string;
  readonly criterio: CriterioObjetivo;
  readonly gastoAutorizado: number | null;
  readonly muestraMinima: number;
  readonly attribution: Attribution;
  readonly occurredAt: string;
}

export class MeasurementService {
  constructor(
    private readonly store: EventStore,
    private readonly source: MetricsSource,
  ) {}

  cargar(ctx: RequestContext, publicationId: string): Promise<MedState> {
    return this.store.readStream(ctx, medStreamId(publicationId)).then((e) => reconstruirMed(publicationId, ctx.organizationId, e));
  }
  private input(type: string, payload: unknown, a: Attribution, o: string): EventInput {
    return { type, payload, attribution: a, occurredAt: o };
  }

  async sincronizar(ctx: RequestContext, cmd: SincronizarCmd): Promise<MedState> {
    const lote = await this.source.obtener(cmd.token, cmd.cuenta);
    const filas = lote.filas.filter((f) => f.externalId === cmd.externalRef);
    const observaciones: Observacion[] = filas.map((f) => ({
      fuenteId: this.source.nombre,
      canal: cmd.canal,
      cuenta: cmd.cuenta,
      externalRef: f.externalId,
      metricaProveedor: f.metrica,
      valor: f.valor,
      unidad: f.unidad,
      moneda: f.moneda,
      periodo: f.periodo,
      dimension: 'total',
      ocurridoEn: f.ocurridoEn,
      recibidoEn: cmd.occurredAt,
      proveedorSeq: f.proveedorSeq,
      acumulativa: f.acumulativa,
      estimada: f.estimada,
    }));
    const { conservadas, duplicadosDescartados, correcciones } = deduplicar(observaciones);
    const normalizadas = conservadas.map(normalizar).filter((x): x is MetricaNormalizada => x !== null);

    const previo = await this.cargar(ctx, cmd.publicationId);

    // Calidad de evidencia.
    const presentes = new Set(normalizadas.map((n) => n.metrica));
    const cobertura = REQUERIDAS.filter((r) => presentes.has(r as never)).length / REQUERIDAS.length;
    const muestra = normalizadas.find((n) => n.metrica === 'impresiones')?.valor ?? 0;
    const valoresPrevios = valoresDe(previo);
    const anomaliasPre = detectarAnomalias({ ...valoresPrevios, ...Object.fromEntries(normalizadas.map((n) => [n.metrica, n.valor])) }, cmd.gastoAutorizado);
    const senales: SenalesCalidad = {
      observaciones: conservadas.length + previo.observacionesTotales,
      muestra: Math.max(muestra, valoresPrevios.impresiones ?? 0),
      duplicados: duplicadosDescartados,
      inconsistencias: anomaliasPre.filter((a) => a.codigo === 'tasa_imposible').length,
      estimadas: normalizadas.filter((n) => n.estimada).length,
      cobertura,
    };
    const calidad = evaluarCalidad(senales, cmd.muestraMinima);

    await this.store.append(ctx, medStreamId(cmd.publicationId), previo.version, [
      this.input(EVENTOS_MED.sincronizado, { campaniaRef: cmd.campaniaRef, objetivoRef: cmd.objetivoRef, metricas: normalizadas, observaciones: conservadas.length, duplicadosDescartados, correcciones, calidad: calidad.nivel }, cmd.attribution, cmd.occurredAt),
    ]);

    // Evaluación sobre el estado fusionado (incluye datos previos y tardíos, sin duplicar).
    const med = await this.cargar(ctx, cmd.publicationId);
    const valores = valoresDe(med);
    const indicadores: Indicador[] = INDICADORES.map((t) => calcularIndicador(t, valores, undefined, senales.estimadas > 0));
    const conversiones: ConversionObservada[] = lote.conversiones.map((c) => ({ id: c.id, externalRef: c.externalId, campaignRef: c.campaignRef, valor: c.valor, ocurridoEn: c.ocurridoEn }));
    const atribucion = atribuir(cmd.campaniaRef, conversiones, cmd.criterio.indicador);
    const anomalias: Anomalia[] = [...detectarAnomalias(valores, cmd.gastoAutorizado)];
    const tasaConv = indicadores.find((i) => i.tipo === 'tasa_conversion')?.valor ?? null;
    const faltantes = REQUERIDAS.filter((r) => !(r in valores));
    const evaluacion: Evaluacion = evaluar(cmd.criterio, tasaConv, calidad.nivel, calidad.suficiente, anomalias.some((a) => a.requiereIntervencion), faltantes);

    await this.store.append(ctx, medStreamId(cmd.publicationId), med.version, [
      this.input(EVENTOS_MED.evaluado, { indicadores, atribucion, anomalias, evaluacion }, cmd.attribution, cmd.occurredAt),
    ]);
    return this.cargar(ctx, cmd.publicationId);
  }
}
