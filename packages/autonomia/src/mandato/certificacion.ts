/**
 * @soec/autonomia · mandato · CICLO DE CERTIFICACIÓN (end-to-end en SOMBRA, sin efecto externo).
 *
 * Ejercita el ciclo operacional completo con un adaptador FALSO de certificación (SIMULATION_ONLY):
 *   OBSERVAR → DECIDIR (gates) → SIMULAR MUTACIÓN → LEER DE VUELTA → MEDIR → MANTENER/REVERTIR → AUDITAR.
 * Prueba el PIPELINE, no marketing. Nunca usa credenciales ni red reales: `mutacionesExternas` = 0.
 *
 * Reglas duras que certifica:
 *   · resultado ambiguo/timeout/crash ⇒ UNKNOWN_EXECUTION_RESULT, NUNCA reintento ciego;
 *   · si la medición posterior empeora ⇒ ROLLBACK; si el rollback falla ⇒ PAUSA + ALERTA CRÍTICA;
 *   · no se atribuye causalidad sin evidencia suficiente (muestra insuficiente ⇒ seguir midiendo).
 */
import { evaluarAccion, type AccionPropuesta, type ContextoEjecucion, type Decision } from './gates';

/** Los 9 escenarios de plataforma externa a certificar. El adaptador es FALSO: sólo simula. */
export type EscenarioCertificacion =
  | 'EXITO'
  | 'TIMEOUT'
  | 'HTTP_500'
  | 'HTTP_429'
  | 'AMBIGUO'
  | 'CRASH_POST_ENVIO'
  | 'READBACK_MISMATCH'
  | 'ROLLBACK_OK'
  | 'ROLLBACK_FALLA';

export type ResultadoExterno = 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN';

export interface RespuestaSimulada {
  readonly resultado: ResultadoExterno;
  /** Estado leído de vuelta tras la operación. `null` si no se pudo leer (timeout/ambiguo). */
  readonly readBack: string | null;
  readonly detalle: string;
}

/**
 * Adaptador FALSO de certificación. NO recibe credenciales, NO tiene URL, NO usa red: es un switch
 * puro que simula la respuesta de una plataforma externa. Jamás toca Google Ads real.
 */
export class AdaptadorCertificacion {
  readonly esSimulacion = true as const;
  private llamadas = 0;
  get mutacionesExternas(): 0 {
    return 0;
  }
  /** Llamadas SIMULADAS emitidas (para verificar que no hay reintento ciego). */
  get intentos(): number {
    return this.llamadas;
  }

  mutar(desiredState: string, escenario: EscenarioCertificacion): RespuestaSimulada {
    this.llamadas += 1;
    switch (escenario) {
      case 'EXITO':
        return { resultado: 'APPLIED', readBack: desiredState, detalle: 'aplicado (simulado)' };
      case 'HTTP_500':
        return { resultado: 'NOT_APPLIED', readBack: 'ANTES', detalle: '500 (simulado): no aplicado' };
      case 'HTTP_429':
        return { resultado: 'NOT_APPLIED', readBack: 'ANTES', detalle: '429 (simulado): límite de tasa, no aplicado' };
      case 'TIMEOUT':
        return { resultado: 'UNKNOWN', readBack: null, detalle: 'timeout (simulado): sin respuesta' };
      case 'AMBIGUO':
        return { resultado: 'UNKNOWN', readBack: null, detalle: 'respuesta ambigua (simulado)' };
      case 'CRASH_POST_ENVIO':
        return { resultado: 'UNKNOWN', readBack: null, detalle: 'crash tras enviar (simulado): resultado desconocido' };
      case 'READBACK_MISMATCH':
        return { resultado: 'APPLIED', readBack: 'ESTADO_INESPERADO', detalle: 'aplicado pero el read-back no coincide (simulado)' };
      case 'ROLLBACK_OK':
        return { resultado: 'APPLIED', readBack: 'REVERTIDO', detalle: 'rollback aplicado (simulado)' };
      case 'ROLLBACK_FALLA':
        return { resultado: 'NOT_APPLIED', readBack: 'SIGUE_APLICADO', detalle: 'el rollback falló (simulado)' };
    }
  }
}

export type EstadoCiclo =
  | 'PROPOSED'
  | 'ELIGIBLE'
  | 'SIMULATED'
  | 'EXECUTED'
  | 'MEASURING'
  | 'KEPT'
  | 'ROLLED_BACK'
  | 'FAILED'
  | 'UNKNOWN_EXECUTION'
  | 'PAUSED';

/** Medición posterior: ¿mejoró, empeoró o falta muestra? No hay causalidad sin evidencia. */
export interface MedicionPosterior {
  readonly muestra: number;
  readonly muestraMinima: number;
  readonly mejora: boolean | null; // null = neutro/indeterminado
}
export type VeredictoMedicion = 'KEEP' | 'ROLLBACK' | 'WAIT_MORE' | 'N/A';

export function medir(m: MedicionPosterior): VeredictoMedicion {
  if (m.muestra < m.muestraMinima) return 'WAIT_MORE'; // sin muestra suficiente no se concluye
  if (m.mejora === false) return 'ROLLBACK';
  if (m.mejora === true) return 'KEEP';
  return 'WAIT_MORE';
}

export interface ResultadoCiclo {
  readonly estados: readonly EstadoCiclo[];
  readonly decisionGate: Decision;
  readonly resultadoExterno: ResultadoExterno | 'N/A';
  readonly readBackVerificado: boolean;
  readonly medicion: VeredictoMedicion;
  readonly rollbackEjecutado: boolean;
  readonly rollbackExitoso: boolean | null;
  readonly autonomiaPausada: boolean;
  readonly alertaCritica: boolean;
  /** Invariante: ante resultado desconocido NUNCA se reintenta a ciegas. */
  readonly reintentoCiego: false;
  readonly intentosSimulados: number;
  readonly mutacionesExternas: 0;
  readonly auditoria: readonly string[];
}

/**
 * Recorre el ciclo completo para UNA acción, con un escenario de plataforma simulado. PURA salvo por
 * el adaptador falso (que no tiene efecto). Certifica KEEP / ROLLBACK / ROLLBACK_FAILURE / UNKNOWN.
 */
export function ejecutarCicloCertificacion(
  accion: AccionPropuesta,
  ctx: ContextoEjecucion,
  escenario: EscenarioCertificacion,
  medicionPosterior: MedicionPosterior,
  opts: { escenarioRollback?: EscenarioCertificacion; adaptador?: AdaptadorCertificacion } = {},
): ResultadoCiclo {
  const adaptador = opts.adaptador ?? new AdaptadorCertificacion();
  const escRollback: EscenarioCertificacion = opts.escenarioRollback ?? 'ROLLBACK_OK';
  const estados: EstadoCiclo[] = ['PROPOSED'];
  const audit: string[] = [];

  // 1 · DECIDIR (mismos gates que la ejecución real; TOCTOU: se revalida el mandato ACTUAL).
  const gate = evaluarAccion(accion, ctx);
  audit.push(`gate=${gate.decision}:${gate.razon}`);
  if (gate.decision !== 'EXECUTE') {
    return base(estados, gate.decision, 'N/A', false, 'N/A', false, null, gate.decision === 'DENY' && false, false, adaptador, audit);
  }
  estados.push('ELIGIBLE', 'SIMULATED');

  // 2 · SIMULAR MUTACIÓN + LEER DE VUELTA.
  const resp = adaptador.mutar(accion.desiredState, escenario);
  audit.push(`mutate_simulado=${resp.resultado}:${resp.detalle}`);

  // 3 · Resultado desconocido ⇒ UNKNOWN_EXECUTION, sin reintento ciego, read-back requerido, PAUSA.
  if (resp.resultado === 'UNKNOWN') {
    estados.push('UNKNOWN_EXECUTION', 'PAUSED');
    audit.push('resultado_desconocido: NO reintento ciego; read-back requerido; target en pausa');
    return base(estados, gate.decision, resp.resultado, false, 'N/A', false, null, true, false, adaptador, audit);
  }

  // 4 · No aplicado (500/429) ⇒ FAILED limpio, sin reintento ciego.
  if (resp.resultado === 'NOT_APPLIED') {
    estados.push('FAILED');
    audit.push('no_aplicado: fallo limpio; sin reintento ciego; sin cambio de estado');
    return base(estados, gate.decision, resp.resultado, false, 'N/A', false, null, false, false, adaptador, audit);
  }

  // 5 · Aplicado: verificar read-back.
  const readBackOk = resp.readBack === accion.desiredState;
  audit.push(`read_back=${readBackOk ? 'OK' : 'MISMATCH'} (esperado=${accion.desiredState}, leido=${resp.readBack})`);
  estados.push('EXECUTED');

  // 5a · Read-back no coincide ⇒ se intenta revertir; si el rollback falla ⇒ PAUSA + alerta.
  if (!readBackOk) {
    return revertir(estados, gate.decision, resp.resultado, false, 'ROLLBACK', escRollback, adaptador, audit);
  }

  // 6 · MEDIR (no hay causalidad sin evidencia suficiente).
  estados.push('MEASURING');
  const veredicto = medir(medicionPosterior);
  audit.push(`medicion=${veredicto} (muestra ${medicionPosterior.muestra}/${medicionPosterior.muestraMinima})`);

  if (veredicto === 'WAIT_MORE') {
    return base(estados, gate.decision, resp.resultado, true, veredicto, false, null, false, false, adaptador, audit);
  }
  if (veredicto === 'KEEP') {
    estados.push('KEPT');
    return base(estados, gate.decision, resp.resultado, true, veredicto, false, null, false, false, adaptador, audit);
  }
  // 7 · ROLLBACK: la medición empeoró.
  return revertir(estados, gate.decision, resp.resultado, true, veredicto, escRollback, adaptador, audit);
}

function revertir(
  estados: EstadoCiclo[],
  decision: Decision,
  resultadoExterno: ResultadoExterno,
  readBackVerificado: boolean,
  medicion: VeredictoMedicion,
  escenarioRollback: EscenarioCertificacion,
  adaptador: AdaptadorCertificacion,
  audit: string[],
): ResultadoCiclo {
  const resp = adaptador.mutar('REVERTIDO', escenarioRollback);
  const exitoso = resp.resultado === 'APPLIED';
  audit.push(`rollback_simulado=${resp.resultado}:${resp.detalle}`);
  if (exitoso) {
    estados.push('ROLLED_BACK');
    return base(estados, decision, resultadoExterno, readBackVerificado, medicion, true, true, false, false, adaptador, audit);
  }
  // Rollback falló ⇒ PAUSA + ALERTA CRÍTICA + no más acciones sobre el target.
  estados.push('FAILED', 'PAUSED');
  audit.push('rollback_fallo: AUTONOMIA_PAUSADA + ALERTA_CRITICA + sin más acciones sobre el target');
  return base(estados, decision, resultadoExterno, readBackVerificado, medicion, true, false, true, true, adaptador, audit);
}

function base(
  estados: EstadoCiclo[],
  decisionGate: Decision,
  resultadoExterno: ResultadoExterno | 'N/A',
  readBackVerificado: boolean,
  medicion: VeredictoMedicion,
  rollbackEjecutado: boolean,
  rollbackExitoso: boolean | null,
  autonomiaPausada: boolean,
  alertaCritica: boolean,
  adaptador: AdaptadorCertificacion,
  auditoria: string[],
): ResultadoCiclo {
  return {
    estados,
    decisionGate,
    resultadoExterno,
    readBackVerificado,
    medicion,
    rollbackEjecutado,
    rollbackExitoso,
    autonomiaPausada,
    alertaCritica,
    reintentoCiego: false,
    intentosSimulados: adaptador.intentos,
    mutacionesExternas: 0,
    auditoria,
  };
}
