/**
 * apps/api · POLÍTICA DE EVALUACIÓN COMO DATO · completitud y reconstrucción del perfil.
 *
 * Dos funciones PURAS, sin base de datos y sin reloj:
 *
 *   `evaluarCompletitud`            ¿es evaluable este negocio? y si no, QUÉ falta exactamente.
 *   `construirPerfilDeEvaluacion`   el `BusinessEvaluationProfile` que el runtime ya consumía, armado desde
 *                                   datos persistidos en lugar de un módulo TypeScript.
 *
 * La reconstrucción es la pieza que permite cambiar la FUENTE sin cambiar a los consumidores: el Director, la
 * autonomía de ads y el plan de acción siguen recibiendo exactamente la misma forma que antes. Hay una prueba
 * que compara, campo por campo, el perfil reconstruido de SmileFlow con el de su módulo histórico.
 *
 * FAIL-CLOSED: si la política está incompleta, se devuelve `null`. Un perfil a medias sería peor que ninguno,
 * porque el Director evaluaría con metas inventadas.
 */
import type {
  BusinessEvaluationProfile,
  CuentaExternaRef,
  DirectorContext,
  ModeloDeNegocio,
  RecursoGoogleAds,
} from '../plataforma/tipos';
import type { CriterioObjetivo, PoliticaOptimizacion } from '@soec/medicion';
import type { LimitesAutonomia } from '../autonomia-ads/limites-smileflow';
import type { PerfilNegocio, TipoNegocio } from '../negocio/negocio-pg';
import type { EventoConversion, Kpi, PoliticaCompleta, ReglaEvaluacion } from './politica-pg';
import {
  MOTIVOS,
  type CampoFaltante,
  type CompletitudPerfil,
  type MotivoIncompletitud,
  type Recomendacion,
} from './politica-tipos';

export interface DatosDePolitica {
  /** Perfil comercial persistido (Fase A). Aporta el tipo de negocio y el objetivo en lenguaje humano. */
  readonly perfil: PerfilNegocio;
  readonly politica: PoliticaCompleta;
  /** Recurso de Google Ads resuelto desde la CONEXIÓN (Fase B). `null` si el negocio no la tiene. */
  readonly recursoGoogleAds?: RecursoGoogleAds | null;
  readonly cuentasExternas?: readonly CuentaExternaRef[];
  /** Sólo para RECOMENDACIONES: no participan en la decisión de completitud. */
  readonly tieneTerritorio?: boolean;
  readonly tienePrioridadesDeOferta?: boolean;
}

const primario = <T extends { rol: string }>(xs: readonly T[]): T | null => xs.find((x) => x.rol === 'PRIMARY') ?? null;

const reglaDe = (reglas: readonly ReglaEvaluacion[], tipo: ReglaEvaluacion['tipo'], metrica?: ReglaEvaluacion['metrica']): ReglaEvaluacion | null =>
  reglas.find((r) => r.tipo === tipo && (metrica === undefined || r.metrica === metrica) && r.estado === 'CONFIGURED' && r.valor !== null) ?? null;

/** KPI principal CONFIGURADO: tiene su meta puesta y sirve para evaluar hoy. */
function kpiPrincipal(kpis: readonly Kpi[]): Kpi | null {
  const p = primario(kpis);
  return p !== null && p.estado === 'CONFIGURED' ? p : null;
}

/**
 * KPI principal DECLARADO: el negocio eligió QUÉ mirar, con meta o sin ella. Un KPI `UNKNOWN` cuya procedencia
 * es `TO_BE_LEARNED` no es un hueco —es la respuesta «todavía no sé qué número sería bueno», que el asistente
 * ofrece a propósito—. Exigir un número aquí obligaría a inventarlo, que es justo lo que no puede pasar.
 */
function kpiPrincipalDeclarado(kpis: readonly Kpi[]): Kpi | null {
  const p = primario(kpis);
  if (p === null) return null;
  if (p.estado === 'CONFIGURED') return p;
  return p.procedencia === 'TO_BE_LEARNED' ? p : null;
}

/** ¿La meta está por aprender? Sólo cuando el indicador está declarado y NO hay ningún número detrás. */
function metaPorAprender(kpis: readonly Kpi[], reglas: readonly ReglaEvaluacion[]): boolean {
  const declarado = kpiPrincipalDeclarado(kpis);
  return declarado !== null && declarado.procedencia === 'TO_BE_LEARNED' && criterioDeExito(kpis, reglas) === null;
}

/** ¿Hay criterio de éxito? La meta del KPI principal vale; una regla SUCCESS explícita también. */
function criterioDeExito(kpis: readonly Kpi[], reglas: readonly ReglaEvaluacion[]): { readonly valor: number } | null {
  const kpi = kpiPrincipal(kpis);
  if (kpi?.targetValue !== null && kpi?.targetValue !== undefined) return { valor: kpi.targetValue };
  const regla = reglaDe(reglas, 'SUCCESS');
  return regla?.valor !== null && regla?.valor !== undefined ? { valor: regla.valor } : null;
}

/**
 * ¿Es evaluable? Requisitos MÍNIMOS —los cuatro que hacen falta para que una evaluación signifique algo—:
 * objetivo, acción del cliente que cuenta, indicador principal y criterio de éxito. Todo lo demás mejora la
 * evaluación pero no la habilita, y se informa como recomendación en lugar de bloquear.
 */
export function evaluarCompletitud(d: DatosDePolitica): CompletitudPerfil {
  const { politica, kpis, eventos, reglas, limites, canales } = d.politica;
  const faltantes: MotivoIncompletitud[] = [];
  const agregar = (campo: CampoFaltante): void => {
    faltantes.push({ campo, ...MOTIVOS[campo] });
  };

  const aprendiendo = metaPorAprender(kpis, reglas);
  if (politica === null || politica.objectiveId.trim() === '') agregar('primaryObjective');
  if (primario(eventos) === null) agregar('primaryConversionEvent');
  if (kpiPrincipalDeclarado(kpis) === null) agregar('primaryKpi');
  // La meta puede estar POR APRENDER: eso no es un campo que falte, es un estado declarado de la línea base.
  if (criterioDeExito(kpis, reglas) === null && !aprendiendo) agregar('successCriterion');
  // Sin mínimo de evidencia, una conclusión puede venir de un puñado de datos: es requisito, no recomendación.
  if (reglaDe(reglas, 'EVIDENCE_MINIMUM') === null) agregar('evidenceMinimum');

  const recomendaciones: Recomendacion[] = [];
  const objetivoEnTexto = (politica?.objectiveText ?? d.perfil.primaryObjective ?? '').trim();
  if (objetivoEnTexto === '') {
    recomendaciones.push({ campo: 'objectiveText', motivo: 'el objetivo no está escrito en lenguaje de negocio' });
  }
  if (reglaDe(reglas, 'PAUSE') === null) {
    recomendaciones.push({ campo: 'pauseCriterion', motivo: 'no hay umbral declarado a partir del cual convendría detener el gasto' });
  }
  if (politica?.evaluationHorizonDays === null || politica?.evaluationHorizonDays === undefined) {
    recomendaciones.push({ campo: 'evaluationHorizon', motivo: 'sin horizonte de evaluación no se sabe en cuánto tiempo se espera el resultado' });
  }
  if (kpis.filter((k) => k.rol === 'SECONDARY').length === 0) {
    recomendaciones.push({ campo: 'secondaryKpi', motivo: 'un solo indicador deja fuera parte de la realidad del negocio' });
  }
  if (canales.length === 0) {
    recomendaciones.push({ campo: 'channelRules', motivo: 'no se declaró qué canales están permitidos o prohibidos' });
  }
  if (d.tieneTerritorio === false) {
    recomendaciones.push({ campo: 'geographicScope', motivo: 'sin territorio declarado no hay límite geográfico que respetar' });
  }
  if (d.tienePrioridadesDeOferta === false) {
    recomendaciones.push({ campo: 'offerPriorities', motivo: 'no se declaró qué servicios o productos son prioritarios' });
  }
  void limites; // los límites de autonomía no condicionan la evaluación: condicionan la EJECUCIÓN

  return {
    estado: faltantes.length === 0 ? 'EVALUATION_PROFILE_COMPLETE' : 'EVALUATION_PROFILE_INCOMPLETE',
    faltantes,
    recomendaciones,
    lineaBase: aprendiendo ? 'LEARNING_BASELINE' : 'CONFIRMED',
    actualizadoEn: politica?.updatedAt ?? null,
  };
}

/** Tipo de negocio → modelo de evaluación. Mismo mapeo que usa la proyección del negocio. */
export function modeloDeEvaluacion(tipo: TipoNegocio): ModeloDeNegocio {
  switch (tipo) {
    case 'SAAS': return 'SAAS_FUNNEL';
    case 'ECOMMERCE': return 'ECOMMERCE_DISTRIBUCION';
    default: return 'SERVICIOS';
  }
}

function contextoDirector(
  politica: NonNullable<PoliticaCompleta['politica']>,
  eventos: readonly EventoConversion[],
): DirectorContext {
  const principal = primario(eventos);
  return {
    descripcion: politica.businessContext ?? '',
    conversionPrimaria: principal?.eventKey ?? '',
    conversionesSecundarias: eventos.filter((e) => e.rol === 'SECONDARY').map((e) => e.eventKey),
    vocabulario: politica.vocabulary,
  };
}

/**
 * Reconstruye el perfil de evaluación DESDE DATOS. Devuelve `null` si la política está incompleta: el
 * llamador responde entonces `PROFILE_INCOMPLETE` con los motivos, en lugar de evaluar con huecos.
 */
export function construirPerfilDeEvaluacion(d: DatosDePolitica): BusinessEvaluationProfile | null {
  const completitud = evaluarCompletitud(d);
  if (completitud.estado === 'EVALUATION_PROFILE_INCOMPLETE') return null;
  // LÍNEA BASE POR APRENDER: el perfil histórico exige un número (`criterio.meta`) y aquí no hay ninguno.
  // Devolver cero, o el mínimo de evidencia, sería fabricar la meta que el negocio dijo no conocer. Se
  // devuelve `null`: se puede entender, planificar y medir a la empresa; juzgar el resultado todavía no.
  if (completitud.lineaBase === 'LEARNING_BASELINE') return null;
  const { politica, kpis, eventos, reglas, limites } = d.politica;
  if (politica === null) return null;
  const kpi = kpiPrincipal(kpis);
  const exito = criterioDeExito(kpis, reglas);
  if (kpi === null || exito === null) return null;

  const evidencia = reglaDe(reglas, 'EVIDENCE_MINIMUM', 'IMPRESSIONS')?.valor ?? reglaDe(reglas, 'EVIDENCE_MINIMUM')?.valor ?? 0;
  const criterio: CriterioObjetivo = {
    objetivoId: politica.objectiveId,
    indicador: kpi.clave,
    lineaBase: kpi.baselineValue ?? 0,
    meta: kpi.targetValue ?? exito.valor,
    tolerancia: kpi.tolerance ?? 0,
    muestraMinima: evidencia,
  };

  const policy: PoliticaOptimizacion = {
    muestraMinima: evidencia,
    umbralPausaTasaConversion: reglaDe(reglas, 'PAUSE', 'CONVERSION_RATE')?.valor ?? 0,
    umbralEscalamiento: reglaDe(reglas, 'ESCALATION', 'CONVERSION_RATE')?.valor ?? 0,
    variacionMaxPresupuesto: politica.maxBudgetVariationPct ?? 0,
    cooldownDias: politica.cooldownDays ?? 0,
    campaniasProtegidas: politica.protectedCampaigns,
    actividadesNoModificables: politica.nonModifiableActivities,
    escalamientoRequiereAprobacion: politica.scalingRequiresApproval,
  };

  // Los topes de autonomía son de EJECUCIÓN, no de evaluación: si el negocio no los fijó, quedan en 0, que es
  // el valor más restrictivo posible (ningún cambio automático cabe dentro de un tope 0).
  const limitesAutonomia: LimitesAutonomia = {
    presupuestoMaxDiarioCLP: limites?.maxDailyBudgetClp ?? 0,
    cpcTechoMaxCLP: limites?.maxCpcClp ?? 0,
    variacionMaxPct: limites?.maxVariationPct ?? 0,
    maxCambiosPorDia: limites?.maxChangesPerDay ?? 0,
    cooldownHoras: limites?.cooldownHours ?? 0,
    muestraMinimaNegativaImpresiones: limites?.minTermImpressionsForNegative ?? 0,
    // Sólo se declara si el negocio aportó patrones: ausente ⇒ ninguna negativa automática (fail-closed).
    ...(limites && limites.irrelevancePatterns.length > 0 ? { politicaIrrelevancia: limites.irrelevancePatterns } : {}),
  };

  return {
    organizationId: d.perfil.organizationId,
    modeloDeNegocio: modeloDeEvaluacion(d.perfil.businessType),
    objetivoId: politica.objectiveId,
    criterio,
    policy,
    gastoAutorizado: politica.authorizedSpendClp,
    limitesAutonomia,
    externalResourceRefs: { googleAds: d.recursoGoogleAds ?? null },
    cuentasExternas: d.cuentasExternas ?? [],
    directorContext: contextoDirector(politica, eventos),
  };
}
