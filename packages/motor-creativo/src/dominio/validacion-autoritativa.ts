/**
 * @soec/motor-creativo · dominio · VALIDACIÓN CREATIVA AUTORITATIVA (gate obligatorio).
 *
 * El validador semántico A-3 de M3 (`validarContenidoComercial`) detecta afirmaciones de riesgo por
 * PATRÓN de texto + whitelist. Es necesario pero NO suficiente: el Bloque Maestro exige que la
 * trazabilidad epistémica sea AUTORITATIVA — cada afirmación que respalda un mensaje debe resolverse
 * contra M5 y estar realmente sostenida (evaluada `VERDADERO`), no retirada ni obsoleta. Este módulo
 * COMPONE (no duplica) el veredicto textual A-3 con el veredicto EPISTÉMICO de M5.
 *
 * Regla: el contenido se AUTORIZA solo si (a) el texto pasa A-3 y (b) TODA afirmación de respaldo existe,
 * no está retirada y evalúa `VERDADERO`. Un respaldo `NO_EVALUABLE`/`GRIS`/`FALSO`/retirado/inexistente
 * bloquea, aunque el texto sea impecable. La ausencia de respaldo nunca autoriza.
 */
import type { VeredictoContenido } from '@soec/estrategia-creativa';
import type { EstadoEvaluabilidad } from '@soec/motor-estrategico';

/** Estado de una afirmación de M5 que respalda un mensaje, resuelto por el servicio contra M5. */
export interface RespaldoAfirmacion {
  readonly mensajeId: string;
  readonly afirmacionId: string;
  readonly existe: boolean;
  readonly retirada: boolean;
  readonly estado: EstadoEvaluabilidad;
}

export type MotivoRespaldoInvalido = 'INEXISTENTE' | 'RETIRADA' | 'NO_VERDADERA';

export interface RespaldoInvalido {
  readonly mensajeId: string;
  readonly afirmacionId: string;
  readonly motivo: MotivoRespaldoInvalido;
  readonly estado: EstadoEvaluabilidad;
}

export interface VeredictoAutoritativo {
  /** Autoriza SOLO si el texto pasa A-3 y todos los respaldos son válidos (VERDADERO, existe, no retirado). */
  readonly autoriza: boolean;
  readonly veredictoTextual: VeredictoContenido;
  readonly respaldosInvalidos: readonly RespaldoInvalido[];
  readonly razones: readonly string[];
}

/** Evalúa un respaldo individual: válido solo si existe, no está retirado y su estado es VERDADERO. */
function respaldoInvalido(r: RespaldoAfirmacion): RespaldoInvalido | null {
  if (!r.existe) return { mensajeId: r.mensajeId, afirmacionId: r.afirmacionId, motivo: 'INEXISTENTE', estado: r.estado };
  if (r.retirada) return { mensajeId: r.mensajeId, afirmacionId: r.afirmacionId, motivo: 'RETIRADA', estado: r.estado };
  if (r.estado !== 'VERDADERO') return { mensajeId: r.mensajeId, afirmacionId: r.afirmacionId, motivo: 'NO_VERDADERA', estado: r.estado };
  return null;
}

/**
 * COMBINA (puro, determinista) el veredicto textual A-3 con los respaldos epistémicos resueltos contra
 * M5. Autoriza solo si ambos pasan. La resolución de los respaldos (leer/evaluar M5) la hace el servicio;
 * aquí se decide con esos hechos ya resueltos.
 */
export function combinarVeredicto(
  textual: VeredictoContenido,
  respaldos: readonly RespaldoAfirmacion[],
): VeredictoAutoritativo {
  const invalidos = respaldos.map(respaldoInvalido).filter((x): x is RespaldoInvalido => x !== null);
  const razones: string[] = [];
  if (textual.resultado !== 'VALIDO') {
    razones.push(`el validador semántico A-3 no autorizó el texto (${textual.resultado})`);
  }
  for (const iv of invalidos) {
    const detalle =
      iv.motivo === 'INEXISTENTE'
        ? 'la afirmación de respaldo no existe en M5'
        : iv.motivo === 'RETIRADA'
          ? 'la afirmación de respaldo fue retirada'
          : `la afirmación de respaldo no está sostenida (estado ${iv.estado}, se requiere VERDADERO)`;
    razones.push(`mensaje ${iv.mensajeId}: ${detalle} (${iv.afirmacionId})`);
  }
  const autoriza = textual.resultado === 'VALIDO' && invalidos.length === 0;
  return { autoriza, veredictoTextual: textual, respaldosInvalidos: invalidos, razones };
}
