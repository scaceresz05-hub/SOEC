/**
 * apps/api · V2-C · DECISION ENGINE. Traduce métricas observadas en decisiones DETERMINISTAS bajo umbrales
 * explícitos. Frontera constitucional: toda decisión que implique MÁS DINERO (aumentar presupuesto / extender
 * período) NO es una acción, es una RECOMENDACIÓN FINANCIERA en estado AWAITING_HUMAN_APPROVAL, jamás
 * auto-aplicable. Las optimizaciones DENTRO del mandato (pausar bajo rendimiento) sí son acciones (dry-run).
 */
import type { MetricasAnuncio } from './performance';
import type { Mandato } from '../accion/mandato';
import { restanteMinor } from '../accion/mandato';

export type TipoDecision = 'MANTENER' | 'PAUSAR_ANUNCIO' | 'RECOMENDAR_AUMENTO_PRESUPUESTO' | 'NO_EVALUABLE';

export interface Decision {
  readonly adRef: string;
  readonly tipo: TipoDecision;
  readonly razon: string;
  readonly requiereAprobacionHumana: boolean;
}

/** Estado ÚNICO al nacer: una recomendación financiera nunca puede nacer aprobada. */
export type EstadoRecomendacionFinanciera = 'AWAITING_HUMAN_APPROVAL';

export interface RecomendacionFinanciera {
  readonly organizationId: string;
  readonly mandatoId: string;
  readonly tipo: 'AUMENTO_PRESUPUESTO' | 'EXTENDER_PERIODO';
  readonly montoSugeridoMinor: number | null;
  readonly justificacion: string;
  readonly estado: EstadoRecomendacionFinanciera;
  readonly autoAplicable: false; // invariante de tipo: SOEC NUNCA la aplica
}

export interface UmbralesDecision {
  readonly ctrMinimo: number; // por debajo ⇒ candidato a pausa
  readonly ctrFuerte: number; // por encima ⇒ candidato a más presupuesto (recomendación humana)
  readonly agotamientoParaRecomendar: number; // fracción de gasto/presupuesto para sugerir aumento
}

export const UMBRALES_DEFECTO: UmbralesDecision = { ctrMinimo: 0.005, ctrFuerte: 0.02, agotamientoParaRecomendar: 0.8 };

export interface ResultadoDecisiones {
  readonly decisiones: readonly Decision[];
  readonly recomendacionesFinancieras: readonly RecomendacionFinanciera[];
}

export function decidir(mandato: Mandato, metricas: readonly MetricasAnuncio[], u: UmbralesDecision = UMBRALES_DEFECTO): ResultadoDecisiones {
  const decisiones: Decision[] = [];
  const recomendaciones: RecomendacionFinanciera[] = [];
  const restante = restanteMinor(mandato);
  const fraccionGastada = mandato.authorizedBudgetMinor > 0 ? mandato.spentMinor / mandato.authorizedBudgetMinor : 0;

  let hayFuerteRendimiento = false;

  for (const m of metricas) {
    if (m.calidad !== 'MEDIBLE') {
      decisiones.push({ adRef: m.adRef, tipo: 'NO_EVALUABLE', razon: m.nota, requiereAprobacionHumana: false });
      continue;
    }
    const ctr = m.ctr ?? 0;
    if (ctr < u.ctrMinimo && m.resultados === 0 && m.gastoMinor > 0) {
      decisiones.push({ adRef: m.adRef, tipo: 'PAUSAR_ANUNCIO', razon: `CTR ${(ctr * 100).toFixed(2)}% < mínimo y sin resultados con gasto: pausar (dentro del mandato)`, requiereAprobacionHumana: false });
      continue;
    }
    if (ctr >= u.ctrFuerte) hayFuerteRendimiento = true;
    decisiones.push({ adRef: m.adRef, tipo: 'MANTENER', razon: `rendimiento dentro de rango (CTR ${(ctr * 100).toFixed(2)}%)`, requiereAprobacionHumana: false });
  }

  // Recomendación de aumento SOLO como propuesta humana: rendimiento fuerte + mandato cerca de agotarse.
  if (hayFuerteRendimiento && fraccionGastada >= u.agotamientoParaRecomendar && restante < mandato.authorizedBudgetMinor) {
    recomendaciones.push({
      organizationId: mandato.organizationId,
      mandatoId: mandato.id,
      tipo: 'AUMENTO_PRESUPUESTO',
      montoSugeridoMinor: null, // SOEC no fija el monto: lo decide el humano
      justificacion: 'Hay anuncios con rendimiento fuerte y el presupuesto autorizado está por agotarse. Un humano puede evaluar reautorizar. SOEC no puede aumentarlo.',
      estado: 'AWAITING_HUMAN_APPROVAL',
      autoAplicable: false,
    });
  }
  return { decisiones, recomendacionesFinancieras: recomendaciones };
}
