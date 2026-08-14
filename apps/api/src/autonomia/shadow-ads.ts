/**
 * apps/api · autonomía · MODO SOMBRA sobre Google Ads (wiring con datos reales, SIN efecto externo).
 *
 * Deriva un MANDATO conservador desde el perfil real de la organización (sus `LimitesAutonomia`),
 * transforma los search terms reales en acciones CANDIDATAS usando el MISMO razonamiento honesto
 * (`evaluarTermino`: 0 clics ≠ irrelevancia), y las evalúa con el pipeline de gates de `@soec/autonomia`.
 * NO importa ningún adaptador de escritura: las mutaciones externas son 0 por construcción.
 */
import {
  evaluarSombra,
  type AccionPropuesta,
  type ContextoEjecucion,
  type InterruptoresSeguridad,
  type MandatoAutonomia,
  type NivelAutonomia,
  type ReporteSombra,
} from '@soec/autonomia';
import { crearPredicadoIrrelevancia, evaluarTermino, type EvaluacionTermino } from '../autonomia-ads/evaluacion-termino';
import type { LimitesAutonomia } from '../autonomia-ads/limites-smileflow';

/** Construye un mandato CONSERVADOR a partir de los límites reales del perfil. No infiere lo ausente. */
export function construirMandatoConservador(params: {
  organizationId: string;
  businessKey: string;
  externalAccountId: string;
  limites: LimitesAutonomia;
  nivel: NivelAutonomia;
  ahora: string;
  diasVigencia: number;
}): MandatoAutonomia {
  const { limites } = params;
  const validUntil = new Date(new Date(params.ahora).getTime() + params.diasVigencia * 86400000).toISOString();
  return {
    organizationId: params.organizationId,
    businessKey: params.businessKey,
    externalAccountId: params.externalAccountId,
    nivel: params.nivel,
    // Sólo acciones REVERSIBLES y que no suben gasto quedan como autónomas; el resto exige aprobación.
    accionesPermitidas: ['SEARCH_TERM_EXCLUDE', 'AD_PAUSE', 'KEYWORD_PAUSE'],
    accionesRequierenAprobacion: ['BID_ADJUST', 'BUDGET_REALLOCATE', 'BUDGET_TOTAL_INCREASE', 'CAMPAIGN_ENABLE', 'AD_ENABLE', 'KEYWORD_ENABLE'],
    accionesProhibidas: ['CAMPAIGN_CREATE'],
    limitesFinancieros: {
      maxDailySpend: limites.presupuestoMaxDiarioCLP,
      maxDailySpendIncreasePercent: Math.round(limites.variacionMaxPct * 100),
      // maxMonthlySpend / maxSingleChangeAmount NO se infieren: quedan sin configurar a propósito.
    },
    limitesCambio: {
      maxChangesPerDay: limites.maxCambiosPorDia,
      cooldownAfterChangeMinutes: limites.cooldownHoras * 60,
    },
    politicaEvidencia: {
      muestraMinima: limites.muestraMinimaNegativaImpresiones,
      ventanaMinimaHoras: limites.cooldownHoras,
    },
    politicaRollback: { exigirParaMutaciones: true, ventanaMedicionHoras: limites.cooldownHoras },
    politicaMedicion: { ventanaHoras: limites.cooldownHoras, metricaObjetivo: 'conversiones' },
    validFrom: params.ahora,
    validUntil,
    createdBy: 'humano (shadow)',
    approvedBy: null,
    approvedAt: null,
    status: 'ACTIVE',
    version: 1,
  };
}

export interface Termino {
  readonly termino: string;
  readonly impresiones: number;
  readonly clics: number;
}

export interface EntradaSombraAds {
  readonly mandato: MandatoAutonomia;
  readonly interruptores: InterruptoresSeguridad;
  readonly ahora: string;
  readonly gastoDiario: number;
  readonly gastoMensual: number;
  readonly gastoDiarioPrevio: number;
  readonly cambiosHoy: number;
  readonly terminos: readonly Termino[];
  /** Política de irrelevancia por-organización (VACÍA por defecto: 0 clics NO es irrelevancia). */
  readonly politicaIrrelevancia?: readonly string[];
}

export interface ResultadoSombraAds {
  readonly reporte: ReporteSombra;
  /** Nº de situaciones (search terms) que SOEC evaluó. */
  readonly situacionesEvaluadas: number;
  /** Términos que sugieren revisar el mensaje del anuncio (oportunidad, NO mutación). */
  readonly revisarMensaje: number;
  /** Clasificación de cada término (auditable: por qué). */
  readonly evaluacionesTermino: readonly EvaluacionTermino[];
  /** Acciones mutantes candidatas (sólo negativas JUSTIFICADAS). Insumo del canary. */
  readonly candidatas: readonly AccionPropuesta[];
}

/**
 * Evalúa en SOMBRA la situación publicitaria de una organización. PURA. Sólo produce SEARCH_TERM_EXCLUDE
 * cuando `evaluarTermino` da NEGATIVA_JUSTIFICADA (exige irrelevancia por política, no sólo 0 clics).
 * El resto de términos son «revisar el mensaje» — informativos, no mutaciones.
 */
export function evaluarSombraAds(entrada: EntradaSombraAds): ResultadoSombraAds {
  const esIrrelevante =
    entrada.politicaIrrelevancia && entrada.politicaIrrelevancia.length > 0
      ? crearPredicadoIrrelevancia(entrada.politicaIrrelevancia)
      : undefined;

  const evaluaciones = entrada.terminos.map((t) =>
    evaluarTermino(t.termino, t.clics, t.impresiones, {
      muestraMinima: entrada.mandato.politicaEvidencia.muestraMinima,
      ...(esIrrelevante ? { esIrrelevante } : {}),
    }),
  );

  // Sólo las negativas JUSTIFICADAS se vuelven acciones mutantes candidatas.
  const candidatas: AccionPropuesta[] = evaluaciones
    .filter((e) => e.accion === 'NEGATIVA_JUSTIFICADA')
    .map((e) => ({
      actionId: `SEARCH_TERM_EXCLUDE:${entrada.mandato.externalAccountId}:${e.termino}`,
      organizationId: entrada.mandato.organizationId,
      businessKey: entrada.mandato.businessKey,
      externalAccountId: entrada.mandato.externalAccountId,
      targetId: entrada.mandato.externalAccountId,
      tipo: 'SEARCH_TERM_EXCLUDE' as const,
      desiredState: 'excluded',
      evidencia: { muestra: e.impresiones, ventanaHoras: entrada.mandato.politicaEvidencia.ventanaMinimaHoras },
      credentialRefOwnerOrg: entrada.mandato.organizationId,
      rollbackDisponible: true, // restaurar es la inversa
      aprobacion: null,
      mandateVersionVista: entrada.mandato.version,
    }));

  const ctx: ContextoEjecucion = {
    mandato: entrada.mandato,
    interruptores: entrada.interruptores,
    ahora: entrada.ahora,
    gastoDiario: entrada.gastoDiario,
    gastoMensual: entrada.gastoMensual,
    gastoDiarioPrevio: entrada.gastoDiarioPrevio,
    cambiosUltimaHora: 0,
    cambiosHoy: entrada.cambiosHoy,
    cambiosCampaniaHoy: entrada.cambiosHoy,
    enCooldown: false,
    accionesYaEjecutadas: [],
  };

  return {
    reporte: evaluarSombra(candidatas, ctx),
    situacionesEvaluadas: evaluaciones.length,
    revisarMensaje: evaluaciones.filter((e) => e.accion === 'OPTIMIZAR_MENSAJE').length,
    evaluacionesTermino: evaluaciones,
    candidatas,
  };
}
