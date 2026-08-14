/**
 * apps/api · CAPA DE COMPOSICIÓN · LECTURA DEL DIRECTOR sobre datos REALES, POR ORGANIZACIÓN.
 *
 * Puente acotado que REUTILIZA los motores existentes (no crea un segundo motor de recomendaciones):
 *   observaciones REAL (M8) → FuenteMetricasRealSOEC → MeasurementService → MedState → M9 (OptimizationService)
 *   + evaluarResultadoCampania → DTO "Lectura del Director".
 *
 * MULTIEMPRESA (D-3): el objetivo, el criterio, la política y la campaña observada NO son constantes
 * de la plataforma: se resuelven del `BusinessEvaluationProfile` de la organización solicitada. Si la
 * organización no tiene perfil, se LANZA `BUSINESS_PROFILE_NOT_CONFIGURED`. Nunca se evalúa una
 * organización con la configuración de otra.
 *
 * GARANTÍAS:
 *  - Tenant: la organización recibida y sólo esa. Nunca mezcla datos REAL/SIMULADO ni tenants.
 *  - Naturaleza REAL declarada; el ROI usa procedencia OBSERVADA (nunca degrada a SIMULADO).
 *  - Diagnóstico excluido aguas arriba (FuenteMetricasRealSOEC).
 *  - Atribución honesta: 0 conversiones Ads-atribuibles ⇒ ResultadoCampania NO_CONCLUYENTE por contrato.
 *  - NINGUNA acción externa automática: Google Ads es READ ONLY; toda recomendación queda
 *    `PENDIENTE_APROBACION_HUMANA`. `optimizar` nunca aplica sobre Google Ads (solo planes internos, que aquí
 *    no existen ⇒ se captura y la propuesta queda pendiente).
 */
import {
  ActorId,
  OrganizationId,
  type Attribution,
  type EventStore,
  type RequestContext,
} from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import {
  MeasurementService,
  OptimizationService,
  evaluarResultadoCampania,
  generarDecision,
  type DecisionContenido,
  type MedState,
  type ResultadoCampania,
} from '@soec/medicion';
import { PlanningService } from '@soec/marketing';
import { OperationalService } from '@soec/operacional';
import { adsSnapshotStreamId, ultimoSnapshotAds } from '../ingesta/ingesta-google-ads-service';
import { getProfile, getRecursoGoogleAds, type RecursoGoogleAds } from '../plataforma';
import { FuenteMetricasRealSOEC, filasDesdeSnapshot } from './fuente-metricas-real';

/** Período de dedup FIJO para el acumulado: cada recalcular corrige la misma observación (la última gana). */
const PERIODO_ACUMULADO = 'acumulado';
export const EVENTO_LECTURA = 'lectura-director.registrada';
export function lecturaDirectorStreamId(org: string): string {
  return `lectura-director:${org}`;
}

export type VeredictoDirector = 'NO_EVALUABLE' | 'OBSERVAR' | 'RECOMENDAR';

export interface LecturaDirectorReal {
  readonly veredicto: VeredictoDirector;
  readonly naturaleza: 'REAL';
  readonly fuente: string;
  readonly campaignId: string;
  readonly campaniaRef: string;
  readonly at: string;
  /** HECHOS REALES observados. */
  readonly hechos: {
    readonly impresiones: number;
    readonly clics: number;
    readonly gasto: number;
    readonly ctr: number | null;
    readonly cpc: number | null;
    readonly conversionesAtribuiblesAds: number;
  };
  /** INTERPRETACIÓN de SOEC (evaluación + ROI + calidad/limitaciones). */
  readonly interpretacion: {
    readonly clasificacionDesempeno: string;
    readonly roi: { readonly clasificacion: string; readonly motivo: string };
    readonly calidad: string;
    readonly evidenciaSuficiente: boolean;
    readonly explicacion: string;
    readonly limitaciones: readonly string[];
    readonly faltantes: readonly string[];
    readonly estadoGobernanza: string;
  };
  /** RECOMENDACIÓN — solo cuando corresponde; SIEMPRE pendiente de aprobación humana. */
  readonly recomendacion: {
    readonly tipo: string;
    readonly motivo: string;
    readonly evidencia: string;
    readonly confianza: string;
    readonly estado: 'PENDIENTE_APROBACION_HUMANA';
  } | null;
}

const ATRIB: Attribution = {
  source: 'lectura-director-real',
  purpose: 'lectura del Director sobre evidencia real (observe-only)',
  assumptions: [
    'datos REALES OBSERVADOS; sin gasto ni efecto externo; recomendaciones requieren aprobación humana',
  ],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

/** Veredicto = proyección honesta de la decisión de M9 (sin efecto → OBSERVAR; cambio → RECOMENDAR). */
function veredictoDe(med: MedState, decision: DecisionContenido | null): VeredictoDirector {
  if (
    !med.existe ||
    !med.evaluacion ||
    decision === null ||
    med.evaluacion.clasificacion === 'sin_datos'
  )
    return 'NO_EVALUABLE';
  if (decision.tipo === 'esperar_datos' || decision.tipo === 'mantener') return 'OBSERVAR';
  return 'RECOMENDAR';
}

/**
 * Compone el DTO de lectura a partir del MedState (M8/medición), la decisión de M9 y el ResultadoCampania.
 * PURA y determinista. Separa HECHOS REALES → INTERPRETACIÓN → RECOMENDACIÓN.
 */
export function componerLectura(
  med: MedState,
  resultado: ResultadoCampania,
  decision: DecisionContenido | null,
  estadoGobernanza: string,
  at: string,
  ads: Pick<RecursoGoogleAds, 'campaignId' | 'campaniaRef'>,
): LecturaDirectorReal {
  const veredicto = veredictoDe(med, decision);
  const impresiones = med.metricas.impresiones?.valor ?? 0;
  const clics = med.metricas.clics?.valor ?? 0;
  const gasto = med.metricas.gasto?.valor ?? 0;
  const ctr = med.indicadores.find((i) => i.tipo === 'ctr')?.valor ?? null;
  const cpc = clics > 0 ? gasto / clics : null; // NO_CALCULABLE si 0 clics
  const conversiones = med.atribucion?.conversiones ?? 0;

  const faltantes = [...(med.evaluacion?.faltantes ?? [])];
  if (conversiones === 0)
    faltantes.push('sin conversión Ads-atribuible (0 conversiones con evidencia de procedencia)');

  const recomendacion =
    veredicto === 'RECOMENDAR' && decision
      ? {
          tipo: decision.tipo,
          motivo: decision.motivo,
          evidencia: decision.evidencia,
          confianza: decision.confianza,
          estado: 'PENDIENTE_APROBACION_HUMANA' as const,
        }
      : null;

  return {
    veredicto,
    naturaleza: 'REAL',
    fuente: med.organizationId,
    campaignId: ads.campaignId,
    campaniaRef: ads.campaniaRef,
    at,
    hechos: { impresiones, clics, gasto, ctr, cpc, conversionesAtribuiblesAds: conversiones },
    interpretacion: {
      clasificacionDesempeno: med.evaluacion?.clasificacion ?? 'sin_datos',
      roi: { clasificacion: resultado.clasificacion, motivo: resultado.motivo },
      calidad: med.calidad,
      evidenciaSuficiente: med.evaluacion?.evidenciaSuficiente ?? false,
      explicacion: med.evaluacion?.explicacion ?? 'no hay evaluación',
      limitaciones: [...(med.evaluacion?.limitaciones ?? []), ...resultado.advertencias],
      faltantes,
      estadoGobernanza,
    },
    recomendacion,
  };
}

export class LecturaDirectorRealService {
  private readonly observaciones: ObservacionService;
  private readonly optimizacion: OptimizationService;

  constructor(private readonly store: EventStore) {
    this.observaciones = new ObservacionService(store, {} as never);
    // MeasurementService se instancia por corrida (la fuente REAL depende del snapshot vigente).
    this.optimizacion = new OptimizationService(
      store,
      new PlanningService(store, new OperationalService(store, [])),
    );
  }

  private ctx(org: string): RequestContext {
    const o = OrganizationId(org);
    return {
      organizationId: o,
      actor: ActorId('director-real'),
      scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
      correlationId: `lectura-director-${org}`,
    };
  }

  /** Cuenta observaciones REALES de Google Ads en M8 (naturaleza REAL, NO diagnóstico) — prueba de evidencia. */
  private async evidenciaM8(ctx: RequestContext): Promise<number> {
    const ids = await this.observaciones.listarIds(ctx);
    let n = 0;
    for (const id of ids) {
      const st = await this.observaciones.cargar(ctx, id);
      const d = st.datos;
      if (!d || d.naturaleza !== 'REAL' || !d.provenanciaReal) continue;
      if (d.provenanciaReal.provider === 'google-ads' && !d.provenanciaReal.diagnostico) n += 1;
    }
    return n;
  }

  /**
   * Recalcula la lectura del Director desde la evidencia REAL y la persiste (stream last-wins).
   * Ejecuta el recorrido completo M8 → MeasurementService → M9 → ResultadoCampania. WRITE (event-sourced).
   * Métricas = snapshot acumulado vigente (fresco); las observaciones diarias de M8 (first-wins) prueban el
   * arribo de evidencia real pero no serían el acumulado vigente del día en curso.
   */
  async recalcular(org: string, ahora: string): Promise<LecturaDirectorReal> {
    // ── Perfil de negocio de ESTA organización. FAIL-CLOSED: sin perfil no hay evaluación posible,
    //    y JAMÁS se sustituye por el de otra organización (lanza BUSINESS_PROFILE_NOT_CONFIGURED).
    const perfil = getProfile(org);
    const ads = getRecursoGoogleAds(org);

    const ctx = this.ctx(org);
    const ventana = ahora.slice(0, 10);
    const publicationId = `real:${ads.campaignId}`;
    // Acumulado REAL vigente (mismo snapshot que /resultados), scoped por org (aislamiento de tenant).
    const snap = ultimoSnapshotAds(await this.store.readStream(ctx, adsSnapshotStreamId(org)));
    await this.evidenciaM8(ctx); // prueba (y excluye diagnóstico) de que la evidencia real llegó a M8

    // Secuencia de corrección: el snapshot es ACUMULADO y se recalcula cada sync; una proveedorSeq creciente
    // hace que la lectura vigente GANE la deduplicación (si no, el MedState se congela en el primer valor).
    const previo = await new MeasurementService(this.store, new FuenteMetricasRealSOEC([])).cargar(
      ctx,
      publicationId,
    );
    const filas = filasDesdeSnapshot(snap, {
      campaignRef: ads.campaniaRef,
      ocurridoEn: ahora,
      periodo: PERIODO_ACUMULADO,
      proveedorSeq: previo.sincronizaciones + 1,
    });
    const gasto = snap?.cost ?? 0;

    // M8 → MeasurementService (mide sin saber el proveedor). Fuente REAL por corrida.
    const medicion = new MeasurementService(this.store, new FuenteMetricasRealSOEC(filas));
    const med = await medicion.sincronizar(ctx, {
      publicationId,
      externalRef: ads.campaniaRef,
      canal: ads.canal,
      cuenta: org,
      token: '-',
      campaniaRef: ads.campaniaRef,
      objetivoRef: perfil.objetivoId,
      criterio: perfil.criterio,
      gastoAutorizado: perfil.gastoAutorizado,
      muestraMinima: perfil.criterio.muestraMinima,
      attribution: ATRIB,
      occurredAt: ahora,
    });

    // M9 → OptimizationService (procesa el MedState REAL). Nunca aplica sobre Google Ads (READ ONLY); si
    // intentara aplicar sobre un plan interno inexistente, se captura y la propuesta queda PENDIENTE.
    let decision: DecisionContenido | null = null;
    let estadoGobernanza = 'sin_evaluacion';
    if (med.evaluacion) {
      try {
        const opt = await this.optimizacion.optimizar(ctx, {
          publicationId,
          planId: `plan-real:${ads.campaignId}`,
          campaniaId: ads.campaniaRef,
          actividadId: ads.actividadId,
          canal: ads.canal,
          objetivoId: perfil.objetivoId,
          policyIdOperacional: `policy-op-real:${ads.campaignId}`,
          policyOpt: perfil.policy,
          attribution: ATRIB,
          occurredAt: ahora,
        });
        decision = opt.decision;
        estadoGobernanza = opt.estado;
      } catch {
        // Un cambio con evidencia suficiente intentó aplicarse sobre un plan interno inexistente: NO se aplica.
        // Se deriva la MISMA decisión de M9 (generarDecision) como PROPUESTA, que queda PENDIENTE_APROBACION_HUMANA.
        decision = med.atribucion
          ? generarDecision(med.evaluacion, med.atribucion, med.anomalias, perfil.policy, {
              campaniaId: ads.campaniaRef,
              actividadId: ads.actividadId,
              canal: ads.canal,
              tasaConversion:
                med.indicadores.find((i) => i.tipo === 'tasa_conversion')?.valor ?? null,
            })
          : null;
        estadoGobernanza = 'propuesta_pendiente';
      }
    }

    // ResultadoCampania REAL (procedencia OBSERVADA). Sin conversión atribuible ⇒ NO_CONCLUYENTE por contrato.
    const resultado = evaluarResultadoCampania({
      organizacionId: org,
      campaignRef: ads.campaniaRef,
      ventana,
      gasto: { valor: gasto, procedencia: 'OBSERVADA' },
      ingresos: { valor: 0, procedencia: 'OBSERVADA' },
      conversiones: [],
      periodoCompleto: false,
    });

    const lectura = componerLectura(med, resultado, decision, estadoGobernanza, ahora, ads);
    await this.persistir(ctx, lectura);
    return lectura;
  }

  private async persistir(ctx: RequestContext, lectura: LecturaDirectorReal): Promise<void> {
    const streamId = lecturaDirectorStreamId(String(ctx.organizationId));
    const eventos = await this.store.readStream(ctx, streamId);
    try {
      await this.store.append(ctx, streamId, eventos.length, [
        { type: EVENTO_LECTURA, payload: lectura, attribution: ATRIB, occurredAt: lectura.at },
      ]);
    } catch {
      // carrera con otra corrida ⇒ tolerada (last-wins por lectura posterior)
    }
  }

  /** Lee la última lectura persistida (PURA lectura, sin efectos). null si aún no se calculó. */
  async leerUltima(org: string): Promise<LecturaDirectorReal | null> {
    const ctx = this.ctx(org);
    const eventos = await this.store.readStream(ctx, lecturaDirectorStreamId(org));
    let ultima: LecturaDirectorReal | null = null;
    for (const e of eventos)
      if (e.type === EVENTO_LECTURA) ultima = e.payload as LecturaDirectorReal;
    return ultima;
  }
}
