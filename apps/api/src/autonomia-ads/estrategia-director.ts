/**
 * apps/api · CAPA DE COMPOSICIÓN · MOTOR DE ESTRATEGIA DEL DIRECTOR (PURO, sin I/O).
 *
 * Convierte EVIDENCIA comercial ya observada (impresiones, clics, gasto, contactos reales, cap autorizado,
 * estado de campaña, términos) en → INTERPRETACIÓN → HIPÓTESIS → ESTRATEGIA → DECISIONES humanas.
 * NO es un motor nuevo de recomendaciones de Google Ads: REUTILIZA la evidencia que ya alimenta el panel /
 * la lectura del Director / el guardrail, y produce decisiones que son PLANES HUMANOS, no mutaciones.
 *
 * INVARIANTES:
 *  - READ-ONLY / OBSERVE_ONLY: ninguna decisión ejecuta nada (ni reactiva, ni pausa, ni cambia presupuesto,
 *    keywords o anuncios). Toda decisión requiere aprobación humana. SOEC_AUTONOMOUS_REAL permanece false.
 *  - HECHO ≠ HIPÓTESIS: los hechos son lo observado; las hipótesis son causas posibles, NUNCA afirmadas.
 *  - NO se inventa: el cap histórico ausente se pide (REQUEST_AUTHORIZED_BUDGET), no se fabrica un tope.
 *  - PRECEDENCIA: gasto real + clics + 0 contactos ES evidencia suficiente para decidir NO escalar gasto;
 *    esta señal (FUNNEL_ZERO_CONVERSION) PREVALECE sobre "datos insuficientes/observar".
 */

export type TipoDecisionMarketing =
  | 'FUNNEL_ZERO_CONVERSION'
  | 'REQUEST_AUTHORIZED_BUDGET'
  | 'PREPARE_RELAUNCH_EXPERIMENT';

export type PrioridadDecision = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ExperimentoRelanzamiento {
  readonly estado: 'PROPOSED' | 'PENDING_DIAGNOSIS';
  /** Cambio concreto a probar. 'PENDING_DIAGNOSIS' cuando aún falta diagnóstico (mejor que inventar estrategia). */
  readonly cambioAProbar: string;
  readonly criterioExito: string;
  readonly criterioDetencion: string;
  readonly requiereCapAutorizado: boolean;
}

export interface DecisionMarketing {
  readonly tipo: TipoDecisionMarketing;
  readonly prioridad: PrioridadDecision;
  readonly decisionRequerida: boolean;
  readonly titulo: string;
  /** Afirmación basada en HECHOS (nunca causa presunta). */
  readonly diagnostico: string;
  readonly recomendacion: string;
  readonly hechos: readonly string[];
  /** Causas POSIBLES, explícitamente NO afirmadas como hechos. */
  readonly hipotesis: readonly string[];
  readonly experimento?: ExperimentoRelanzamiento;
}

export interface EntradaEstrategia {
  readonly impresiones: number;
  readonly clics: number;
  readonly gasto: number;
  readonly contactosReales: number;
  readonly capAutorizado: number | null;
  readonly campaignStatus: string | null;
  readonly moneda?: string;
  readonly terminos?: readonly { readonly termino: string; readonly impresiones: number; readonly clics: number }[];
}

export interface EstrategiaDirector {
  readonly generada: boolean;
  readonly funnelZeroConversion: boolean;
  /** ¿SOEC recomienda seguir gastando? Con 0 contactos tras gasto real ⇒ NO. */
  readonly continuarGastoRecomendado: boolean;
  /** La señal FUNNEL_ZERO_CONVERSION prevalece sobre INSUFFICIENT_DATA (no la suprime). */
  readonly insufficientDataSuppressed: boolean;
  readonly hechos: readonly string[];
  readonly diagnostico: string;
  readonly hipotesis: readonly string[];
  readonly estrategia: readonly string[];
  readonly decisiones: readonly DecisionMarketing[];
  readonly siguienteExperimento: ExperimentoRelanzamiento | null;
  /** Términos ofrecidos como EVIDENCIA al Director (sin clasificarlos como compradores/irrelevantes). */
  readonly terminosEvidencia: readonly string[];
}

/** Hipótesis (NO hechos) de por qué hay clics pero no contactos. Ninguna se afirma automáticamente. */
const HIPOTESIS_FUNNEL: readonly string[] = [
  'desalineación entre el anuncio y la landing',
  'CTA débil o poco visible',
  'formulario o WhatsApp con fricción',
  'medición (tracking) incompleta',
  'intención de búsqueda que no coincide con la oferta',
  'oferta o mensaje insuficiente',
];

function fmt(moneda: string, n: number): string {
  return `${moneda} ${Math.round(n)}`;
}

/**
 * Motor puro. Devuelve la estrategia del Director a partir de la evidencia. Determinista e idempotente:
 * la misma evidencia produce las mismas decisiones (persistibles/reproducibles).
 */
export function evaluarEstrategiaDirector(e: EntradaEstrategia): EstrategiaDirector {
  const moneda = e.moneda ?? 'CLP';
  const hayGasto = e.gasto > 0;
  const hayTrafico = e.impresiones > 0 && e.clics > 0;
  const sinContactos = e.contactosReales === 0;
  const funnelZeroConversion = hayTrafico && hayGasto && sinContactos;

  const hechos: string[] = [
    `${e.impresiones} impresiones`,
    `${e.clics} clics`,
    `${fmt(moneda, e.gasto)} de gasto`,
    `${e.contactosReales} contactos reales`,
  ];
  if (e.campaignStatus) hechos.push(`campaña ${e.campaignStatus}`);

  const terminosEvidencia = (e.terminos ?? []).map((t) => t.termino);
  const hipotesisTerminos =
    terminosEvidencia.length > 0
      ? ['Parte del tráfico procede de búsquedas relacionadas con productos/competidores del sector; debe evaluarse si esa intención coincide con la propuesta de la landing (hipótesis, no un hecho).']
      : [];

  const decisiones: DecisionMarketing[] = [];
  let siguienteExperimento: ExperimentoRelanzamiento | null = null;

  if (funnelZeroConversion) {
    // 1) DIAGNÓSTICO — la señal más fuerte: hay tráfico pagado y CERO contactos.
    decisiones.push({
      tipo: 'FUNNEL_ZERO_CONVERSION',
      prioridad: 'HIGH',
      decisionRequerida: true,
      titulo: 'Diagnosticar la conversión antes de volver a invertir',
      diagnostico: 'La campaña generó clics pero no contactos reales.',
      recomendacion:
        'Mantener la campaña pausada y auditar el recorrido anuncio → landing → CTA → contacto antes de autorizar nuevo gasto.',
      hechos: [...hechos],
      hipotesis: [...HIPOTESIS_FUNNEL, ...hipotesisTerminos],
    });

    // 3) EXPERIMENTO — se propone, pero el cambio queda PENDIENTE DE DIAGNÓSTICO (no se inventa la estrategia).
    siguienteExperimento = {
      estado: 'PROPOSED',
      cambioAProbar: 'PENDING_DIAGNOSIS',
      criterioExito:
        'Al menos 1 contacto real atribuible dentro del presupuesto total autorizado (definir el umbral al fijar el experimento).',
      criterioDetencion: 'Alcanzar el presupuesto total autorizado sin ningún contacto real.',
      requiereCapAutorizado: true,
    };
  }

  if (hayGasto && e.capAutorizado == null) {
    // 2) PRESUPUESTO — hubo gasto sin cap total autorizado. NO se inventa el tope histórico: se PIDE.
    decisiones.push({
      tipo: 'REQUEST_AUTHORIZED_BUDGET',
      prioridad: funnelZeroConversion ? 'HIGH' : 'MEDIUM',
      decisionRequerida: true,
      titulo: 'Definir el presupuesto total autorizado para el próximo experimento',
      diagnostico: `Hubo gasto (${fmt(moneda, e.gasto)}) sin un presupuesto total autorizado registrado en SOEC.`,
      recomendacion:
        'Antes de volver a invertir, definí el presupuesto TOTAL que estás dispuesto a autorizar para el próximo experimento.',
      hechos: [`${fmt(moneda, e.gasto)} de gasto`, 'sin presupuesto total autorizado (histórico = NONE, no se inventa)'],
      hipotesis: [],
    });
  }

  if (siguienteExperimento) {
    decisiones.push({
      tipo: 'PREPARE_RELAUNCH_EXPERIMENT',
      prioridad: 'MEDIUM',
      decisionRequerida: false, // requiere primero diagnóstico + presupuesto autorizado
      titulo: 'Preparar experimento de relanzamiento (cuando exista diagnóstico y presupuesto)',
      diagnostico: 'El relanzamiento se plantea como experimento controlado, no como reanudación directa.',
      recomendacion:
        'Aprobar el experimento sólo cuando exista una hipótesis diagnosticada, un cambio concreto a probar y un presupuesto total autorizado.',
      hechos: [...hechos],
      hipotesis: [],
      experimento: siguienteExperimento,
    });
  }

  const diagnostico = funnelZeroConversion
    ? 'Hay tráfico (clics) pero no existe evidencia de conversión a contacto.'
    : hayGasto
      ? 'Hubo gasto; se evalúa la evidencia disponible.'
      : 'Aún no hay gasto ni tráfico suficiente para una estrategia.';

  const estrategia = funnelZeroConversion
    ? [
        'Mantener la campaña pausada.',
        'Diagnosticar el funnel (anuncio → landing → CTA → contacto) antes de seguir gastando.',
        'Definir el presupuesto total autorizado antes de relanzar.',
      ]
    : [];

  return {
    generada: decisiones.length > 0,
    funnelZeroConversion,
    continuarGastoRecomendado: !funnelZeroConversion,
    insufficientDataSuppressed: funnelZeroConversion,
    hechos,
    diagnostico,
    hipotesis: funnelZeroConversion ? [...HIPOTESIS_FUNNEL, ...hipotesisTerminos] : hipotesisTerminos,
    estrategia,
    decisiones,
    siguienteExperimento,
    terminosEvidencia,
  };
}
