/**
 * @soec/motor-creativo · dominio · ABSTENCIÓN CREATIVA de primera clase.
 *
 * M6 no convierte la falta de información en una decisión creativa. Toda salida creativa es una UNIÓN
 * DISCRIMINADA con una rama de ABSTENCIÓN honesta. Reutiliza la `Explicacion` CANÓNICA de
 * `@soec/motor-estrategico` (no inventa un shape paralelo): qué falta, qué impide concluir, qué evidencia
 * se usó — más el motivo tipado propio del acto creativo. Así, "abstenerse" es un resultado legítimo,
 * explicable y trazable, nunca un error silencioso ni una respuesta inventada.
 */
import type { Explicacion } from '@soec/motor-estrategico';

/** Por qué M6 se abstiene de producir dirección creativa concluyente. */
export type MotivoAbstencion =
  | 'FALTA_AUDIENCIA'
  | 'FALTA_PROPUESTA_VALOR'
  | 'OBJETIVO_NO_EVALUABLE'
  | 'CONTRADICCION_DOMINANTE'
  | 'EVIDENCIA_INSUFICIENTE'
  | 'SIN_AFIRMACION_PERMITIDA'
  | 'VIOLA_RESTRICCIONES'
  | 'CONOCIMIENTO_OBSOLETO';

export interface AbstencionCreativa {
  readonly motivo: MotivoAbstencion;
  /** Explicación canónica (qué falta / qué impide concluir / qué se usó). Reusa el marco de M5. */
  readonly explicacion: Explicacion;
}

/** Resultado creativo: PROPUESTA evaluable o ABSTENCIÓN honesta. La ausencia nunca es una propuesta. */
export type ResultadoCreativo<T> =
  | { readonly tipo: 'PROPUESTA'; readonly valor: T }
  | { readonly tipo: 'ABSTENCION'; readonly abstencion: AbstencionCreativa };

export function proponer<T>(valor: T): ResultadoCreativo<T> {
  return { tipo: 'PROPUESTA', valor };
}

export function abstener<T = never>(motivo: MotivoAbstencion, explicacion: Explicacion): ResultadoCreativo<T> {
  return { tipo: 'ABSTENCION', abstencion: { motivo, explicacion } };
}

export function esPropuesta<T>(r: ResultadoCreativo<T>): r is { tipo: 'PROPUESTA'; valor: T } {
  return r.tipo === 'PROPUESTA';
}
