/**
 * Propuesta DETERMINISTA de política inicial del piloto (F2-PILOT-01 §10). Se genera a
 * partir del onboarding con criterio CONSERVADOR; no se activa en silencio: debe
 * mostrarse, validarse y aceptarse explícitamente, y versionarse. No usa narrativa
 * generativa como fuente de reglas.
 */
import type { OrgState } from './organizacion';

export interface PoliticaInicialPropuesta {
  readonly nivelAutonomia: number;
  readonly canalesPermitidos: readonly string[];
  readonly accionesPermitidas: readonly string[];
  readonly presupuestoMaximo: number;
  readonly variacionMaxPresupuesto: number;
  readonly frecuenciaMaxima: number;
  readonly horario: string;
  readonly escalamientoRequiereAprobacion: boolean;
  readonly afirmacionesProhibidas: readonly string[];
  readonly retiroAutomatico: boolean;
  readonly anomaliaBloqueaEscalamiento: boolean;
  readonly pausaAutomaticaPorAnomalia: boolean;
  readonly datosInsuficientesEspera: boolean;
}

export const POLITICA_INICIAL_VERSION = 'politica-inicial@1';

/** Genera una propuesta conservadora: escalamiento con aprobación, presupuesto acotado. */
export function proponerPoliticaInicial(org: OrgState): PoliticaInicialPropuesta {
  const perfil = org.perfil;
  const pres = org.presupuesto;
  return {
    // Conservador: nunca por encima de lo declarado, tope 3 (ejecución por política).
    nivelAutonomia: Math.min(perfil?.nivelAutonomia ?? 2, 3),
    canalesPermitidos: perfil?.canales ?? [],
    accionesPermitidas: perfil?.actividadesPermitidas ?? ['publicar_organico'],
    presupuestoMaximo: pres?.limiteTotal ?? 0,
    variacionMaxPresupuesto: 0.1, // conservador
    frecuenciaMaxima: perfil?.frecuenciaMaxima ?? 1,
    horario: perfil?.ventanaOperacional ?? 'L-V 09:00-18:00',
    escalamientoRequiereAprobacion: true, // el escalamiento no es automático
    afirmacionesProhibidas: ['oferta imperdible', 'garantizado', 'resultados garantizados'],
    retiroAutomatico: false,
    anomaliaBloqueaEscalamiento: true,
    pausaAutomaticaPorAnomalia: true,
    datosInsuficientesEspera: true,
  };
}
