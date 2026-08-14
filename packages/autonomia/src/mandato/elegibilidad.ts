/**
 * @soec/autonomia · mandato · ELEGIBILIDAD DE MANDATO (derivada de fundamentos).
 *
 * Un negocio no puede recibir autonomía de ejecución si SOEC todavía no lo entiende. La elegibilidad
 * se deriva del veredicto de fundamentos y de si la cuenta publicitaria está conectada. Fail-closed:
 * ante la duda, se concede el nivel más bajo (sólo observar). C Y P, sin fundamentos, queda bloqueado.
 */
import type { NivelAutonomia } from './mandato';

export type VeredictoFundamentos = 'FOUNDATION_REQUIRED' | 'OBSERVABLE_SIN_POLITICA' | 'EVALUABLE';

export interface ElegibilidadMandato {
  readonly elegible: boolean;
  /** Nivel máximo que los fundamentos permiten hoy (puede ser menor que el solicitado). */
  readonly nivelConcedido: NivelAutonomia;
  readonly motivos: readonly string[];
}

/**
 * ¿Puede este negocio recibir el nivel de autonomía solicitado? PURA.
 * - LEVEL_3 exige fundamentos EVALUABLE y cuenta publicitaria conectada.
 * - LEVEL_2 exige al menos cuenta conectada (preparar/simular/aprobar).
 * - LEVEL_0/1 (observar/recomendar) siempre son elegibles: no ejecutan nada externo.
 */
export function evaluarElegibilidadMandato(params: {
  readonly nivelSolicitado: NivelAutonomia;
  readonly fundamentosVeredicto: VeredictoFundamentos;
  readonly cuentaPublicitariaConectada: boolean;
  readonly motivosFundamentos: readonly string[];
}): ElegibilidadMandato {
  const { nivelSolicitado, fundamentosVeredicto, cuentaPublicitariaConectada, motivosFundamentos } = params;

  if (nivelSolicitado === 'LEVEL_0_OBSERVE' || nivelSolicitado === 'LEVEL_1_RECOMMEND') {
    return { elegible: true, nivelConcedido: nivelSolicitado, motivos: [] };
  }

  const motivos: string[] = [];
  if (fundamentosVeredicto !== 'EVALUABLE') motivos.push('FOUNDATION_REQUIRED');
  if (!cuentaPublicitariaConectada) motivos.push('ADS_ACCOUNT_NOT_CONNECTED');

  if (nivelSolicitado === 'LEVEL_2_APPROVAL_REQUIRED') {
    // Preparar/simular/aprobar exige al menos la cuenta conectada.
    if (cuentaPublicitariaConectada) return { elegible: true, nivelConcedido: 'LEVEL_2_APPROVAL_REQUIRED', motivos: [] };
    return { elegible: false, nivelConcedido: 'LEVEL_0_OBSERVE', motivos: [...motivos, ...motivosFundamentos] };
  }

  // LEVEL_3_AUTONOMOUS
  if (fundamentosVeredicto === 'EVALUABLE' && cuentaPublicitariaConectada) {
    return { elegible: true, nivelConcedido: 'LEVEL_3_AUTONOMOUS', motivos: [] };
  }
  return { elegible: false, nivelConcedido: 'LEVEL_0_OBSERVE', motivos: [...motivos, ...motivosFundamentos] };
}
