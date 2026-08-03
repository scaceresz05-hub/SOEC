/**
 * @soec/motor-creativo · dominio · SISTEMA DE MENSAJES tipados.
 *
 * Un mensaje creativo no es texto suelto: es un artefacto tipado por FUNCIÓN comunicacional que sabe qué
 * afirmación estratégica de M5 lo respalda, qué evidencia lo autoriza, para qué audiencia aplica y —clave
 * para la gobernanza— EN QUÉ CONDICIONES NO debe usarse. Los mensajes que hacen una afirmación sustantiva
 * (problema, beneficio, diferenciación, prueba) EXIGEN respaldo en una afirmación de M5; CTA y educativo
 * pueden no afirmar un hecho comercial y por eso no lo exigen (pero igual declaran su audiencia).
 */

export type TipoMensaje = 'PROBLEMA' | 'BENEFICIO' | 'DIFERENCIACION' | 'PRUEBA' | 'OBJECION' | 'CTA' | 'EDUCATIVO';

export const TIPOS_MENSAJE: readonly TipoMensaje[] = [
  'PROBLEMA',
  'BENEFICIO',
  'DIFERENCIACION',
  'PRUEBA',
  'OBJECION',
  'CTA',
  'EDUCATIVO',
] as const;

export interface MensajeCreativo {
  readonly mensajeId: string;
  readonly tipo: TipoMensaje;
  readonly texto: string;
  /** Afirmación de M5 que respalda el mensaje (null solo admisible en tipos que no afirman un hecho). */
  readonly afirmacionRespaldoId: string | null;
  /** Evidencia concreta (id) que autoriza el uso, si aplica. */
  readonly evidenciaRef: string | null;
  /** Audiencia (afirmación ICP/BUYER_PERSONA de M5) a la que aplica. */
  readonly audienciaId: string | null;
  /** Condiciones bajo las cuales el mensaje NO debe utilizarse (siempre explícitas). */
  readonly condicionesNoUso: readonly string[];
}

/**
 * ¿El tipo de mensaje AFIRMA un hecho comercial y por tanto EXIGE respaldo en una afirmación de M5?
 * Problema/Beneficio/Diferenciación/Prueba/Objeción afirman algo sobre la realidad y deben respaldarse.
 * CTA (invitación a actuar) y Educativo (contenido de valor sin claim comercial) no lo exigen.
 */
export function requiereRespaldo(tipo: TipoMensaje): boolean {
  return tipo === 'PROBLEMA' || tipo === 'BENEFICIO' || tipo === 'DIFERENCIACION' || tipo === 'PRUEBA' || tipo === 'OBJECION';
}

/** Validación estructural de un mensaje (previa a la validación epistémica autoritativa contra M5). */
export function validarMensaje(m: MensajeCreativo): { ok: boolean; motivo: string } {
  if (!m.mensajeId?.trim()) return { ok: false, motivo: 'mensajeId obligatorio' };
  if (!m.texto?.trim()) return { ok: false, motivo: 'el texto del mensaje es obligatorio' };
  if (requiereRespaldo(m.tipo) && !m.afirmacionRespaldoId) {
    return { ok: false, motivo: `un mensaje de tipo ${m.tipo} exige una afirmación de M5 que lo respalde` };
  }
  return { ok: true, motivo: '' };
}
