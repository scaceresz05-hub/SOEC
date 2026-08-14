/**
 * apps/api · CAPA DE COMPOSICIÓN · DOMINIO de la AUTONOMÍA GOBERNADA de Google Ads (G1 · ASISTIDO DRY-RUN).
 *
 * `IntencionDeCambio` = una propuesta TIPADA de cambio (antes→después) con su evidencia, confianza, riesgo,
 * autorización requerida y rollback previsto, EN LENGUAJE SIMPLE para un usuario sin conocimientos de Ads
 * (el detalle técnico queda disponible aparte). En G1 NADA se ejecuta: la intención sólo se planifica,
 * se somete a los gates y se SIMULA (dry-run).
 *
 * `PlanificadorDeCambios` (capa Decision) es PURO: traduce la decisión de M9 + la evidencia real en cero o más
 * intenciones. Con evidencia insuficiente por palanca ⇒ CERO intenciones (prevalece OBSERVAR). No fabrica.
 */
import { crearPredicadoIrrelevancia, evaluarTermino, type EvaluacionTermino } from './evaluacion-termino';
import type { LimitesAutonomia } from './limites-smileflow';

/** Palancas posibles sobre la campaña. La habilitación de cada una la fija la ETAPA (ver HabilitacionEtapa). */
export type PalancaAds =
  | 'agregar_negativa'
  | 'bajar_presupuesto'
  | 'subir_presupuesto'
  | 'bajar_cpc_techo'
  | 'subir_cpc_techo'
  | 'pausar_campana'
  | 'modificar_keyword';

/**
 * Estado de HABILITACIÓN por etapa (NO son prohibiciones permanentes salvo las invariantes de seguridad):
 *  - INVARIANTE_SEGURIDAD: prohibido de forma permanente y arquitectónica (jamás se habilita).
 *  - HABILITADA_G1_DRYRUN: se ejercita en G1, pero SÓLO en simulación (sin efecto real).
 *  - NO_HABILITADA_ETAPA: podría habilitarse en una etapa futura; hoy no se propone para ejecutar.
 */
export type HabilitacionEtapa = 'INVARIANTE_SEGURIDAD' | 'HABILITADA_G1_DRYRUN' | 'NO_HABILITADA_ETAPA';

export type Riesgo = 'bajo' | 'medio' | 'alto';
export type Confianza = 'baja' | 'media' | 'alta';
/** Quién debe autorizar. NUNCA = invariante de seguridad (ninguna autorización la habilita en ninguna etapa). */
export type AutorizacionRequerida = 'AUTOMATICA_BAJO_RIESGO' | 'HUMANA_POR_CAMBIO' | 'NUNCA';

export interface IntencionDeCambio {
  readonly id: string;
  readonly org: string;
  readonly customerId: string;
  readonly campaniaRef: string;
  readonly palanca: PalancaAds;
  readonly entidadRef: string; // término/keyword/campaña concreta afectada
  readonly habilitacionEtapa: HabilitacionEtapa;
  readonly autorizacionRequerida: AutorizacionRequerida;
  readonly riesgo: Riesgo;
  readonly confianza: Confianza;
  // ── Lenguaje simple (para un usuario sin conocimientos de Google Ads) ──
  readonly problema: string;         // qué problema real detectó SOEC
  readonly recomendacion: string;    // qué propone hacer, en simple
  readonly impactoEsperado: string;  // qué se espera que pase
  readonly riesgoExplicacion: string;// qué podría salir mal, en simple
  readonly rollbackPrevisto: string; // cómo se desharía, en simple
  // ── Antes / después ──
  readonly valorAntes: string;
  readonly valorDespues: string;
  readonly unidad: string;
  // ── Evidencia y límites ──
  readonly evidencia: { readonly resumen: string; readonly muestra: number; readonly suficiente: boolean };
  readonly limitesAplicados: readonly string[];
  // ── Detalle técnico (disponible, no destacado) ──
  readonly detalleTecnico: { readonly operacion: string; readonly descripcionMutate: string };
}

/** Insumos REALES para planificar (subconjunto de MedState + ResultadoCampania + decisión de M9 + términos). */
export interface InsumosPlan {
  readonly org: string;
  readonly customerId: string;
  readonly campaniaRef: string;
  readonly evidenciaSuficiente: boolean;
  readonly clasificacionDesempeno: string;
  readonly roiClasificacion: string;
  readonly decisionTipo: string | null; // decisión de M9 (esperar_datos/mantener/... )
  readonly terminos: readonly { readonly termino: string; readonly impresiones: number; readonly clics: number }[];
  readonly limites: LimitesAutonomia;
}

function idNegativa(termino: string): string {
  return `intencion:negativa:${termino.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

/**
 * Planifica intenciones de cambio a partir de evidencia REAL. PURO y determinista. En G1 la ÚNICA palanca que
 * se ejercita (en dry-run) es `agregar_negativa`, y SÓLO cuando la EVALUACIÓN del término concluye
 * `NEGATIVA_JUSTIFICADA` — lo que exige evidencia de IRRELEVANCIA (política del negocio), no sólo "N
 * impresiones sin clics". Un término de bajo rendimiento con relevancia desconocida NO se excluye: se observa /
 * se optimiza el mensaje (ver `evaluarOportunidadesTacticas`). Sin evidencia ⇒ CERO intenciones. No fabrica.
 */
export function planificarCambios(insumos: InsumosPlan): IntencionDeCambio[] {
  const intenciones: IntencionDeCambio[] = [];
  const min = insumos.limites.muestraMinimaNegativaImpresiones;
  const esIrrelevante = crearPredicadoIrrelevancia(insumos.limites.politicaIrrelevancia);

  for (const t of insumos.terminos) {
    const ev = evaluarTermino(t.termino, t.clics, t.impresiones, { muestraMinima: min, esIrrelevante });
    if (ev.accion !== 'NEGATIVA_JUSTIFICADA') continue; // sólo se excluye con evidencia de IRRELEVANCIA

    intenciones.push({
      id: idNegativa(t.termino),
      org: insumos.org,
      customerId: insumos.customerId,
      campaniaRef: insumos.campaniaRef,
      palanca: 'agregar_negativa',
      entidadRef: t.termino,
      habilitacionEtapa: 'HABILITADA_G1_DRYRUN',
      autorizacionRequerida: 'HUMANA_POR_CAMBIO', // en G1/ASISTIDO toda acción se aprueba a mano
      riesgo: 'bajo',
      confianza: ev.confianza,
      problema: `La búsqueda "${t.termino}" mostró tu anuncio ${t.impresiones} veces con 0 clics y coincide con lo que tu negocio marcó como fuera de su oferta.`,
      recomendacion: `Dejar de mostrar el anuncio en la búsqueda "${t.termino}" (agregarla como palabra excluida).`,
      impactoEsperado: 'Evita gastar en una búsqueda fuera de tu oferta. No sube tu gasto; reduce desperdicio.',
      riesgoExplicacion: 'Bajo: si en el futuro esa búsqueda sí fuera útil, se puede quitar la exclusión en segundos.',
      rollbackPrevisto: `Quitar la palabra excluida "${t.termino}" y todo vuelve a como estaba.`,
      valorAntes: 'la búsqueda muestra el anuncio',
      valorDespues: 'la búsqueda queda excluida',
      unidad: 'término',
      evidencia: { resumen: ev.motivo, muestra: t.impresiones, suficiente: true },
      limitesAplicados: [`muestra mínima por término ≥ ${min} impresiones`, `evidencia de irrelevancia (política del negocio)`, `máx ${insumos.limites.maxCambiosPorDia} cambios/día`, `cooldown ${insumos.limites.cooldownHoras} h`],
      detalleTecnico: {
        operacion: 'campaign_criterion.create (negative keyword, match EXACT)',
        descripcionMutate: `AdGroupCriterion/CampaignCriterion negativo EXACT "${t.termino}" en campaña ${insumos.campaniaRef}`,
      },
    });
  }
  return intenciones;
}

/**
 * OPORTUNIDADES TÁCTICAS (no ejecutables): términos con muestra suficiente y bajo rendimiento (0 clics) cuya
 * relevancia es DESCONOCIDA. NO se proponen para excluir — se sugiere revisar el anuncio/message-match. Es la
 * diferencia entre "esta búsqueda no sirve" (que aquí NO se afirma) y "esta búsqueda no está convirtiendo, quizá
 * el mensaje no coincide". Devuelve la evaluación completa (evidencia para el usuario), sin fabricar acciones.
 */
export function evaluarOportunidadesTacticas(insumos: InsumosPlan): EvaluacionTermino[] {
  const min = insumos.limites.muestraMinimaNegativaImpresiones;
  const esIrrelevante = crearPredicadoIrrelevancia(insumos.limites.politicaIrrelevancia);
  return insumos.terminos
    .map((t) => evaluarTermino(t.termino, t.clics, t.impresiones, { muestraMinima: min, esIrrelevante }))
    .filter((e) => e.accion === 'OPTIMIZAR_MENSAJE' || e.accion === 'CANDIDATO_NEGATIVA');
}
