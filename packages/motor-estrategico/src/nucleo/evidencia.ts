/**
 * @soec/motor-estrategico · núcleo · EVIDENCIA y PERTINENCIA.
 *
 * La unidad epistémica sobre la que se evalúa una afirmación. Reutiliza el vocabulario CANÓNICO de
 * `@soec/negocio` (naturaleza de la evidencia y confianza) — NO se redefine aquí, para no crear un
 * modelo epistémico paralelo (SSOT). Aporta lo que faltaba como concepto de primera clase: el SENTIDO
 * (a favor / en contra) y la PERTINENCIA (si la evidencia atañe realmente a la afirmación).
 *
 * Pertinencia EXPLÍCITA, nunca inferida: igual que las hipótesis nunca infieren su ICP por nombre o
 * posición, aquí la pertinencia la declara quien aporta la evidencia y queda registrada con su motivo.
 * Una evidencia no pertinente no se descarta ni se borra: se conserva y se excluye del cómputo, para
 * poder explicar por qué no contó.
 */
import type { Confianza, TipoEvidencia } from '@soec/negocio';

export type { Confianza, TipoEvidencia };

/** Hacia dónde empuja una evidencia respecto de la afirmación. */
export type Sentido = 'A_FAVOR' | 'EN_CONTRA';

/**
 * Orígenes que cuentan como evidencia FUERTE (hecho verificable o dato importado de una fuente).
 * Una inferencia, estimación, hipótesis o simulación no fabrica un veredicto concluyente por sí sola.
 * Canónico: cualquier dominio que pondere fuerza epistémica debe derivar de esta lista.
 */
export const ORIGENES_FUERTES: readonly TipoEvidencia[] = ['HECHO_VERIFICADO', 'DATO_IMPORTADO'] as const;

export function esOrigenFuerte(origen: TipoEvidencia): boolean {
  return ORIGENES_FUERTES.includes(origen);
}

/** Una pieza de evidencia con su procedencia epistémica, su sentido y su pertinencia declarada. */
export interface Evidencia {
  readonly evidenciaId: string;
  readonly enunciado: string;
  /** Naturaleza epistémica (canon de `@soec/negocio`): distingue hecho de suposición. */
  readonly origen: TipoEvidencia;
  readonly sentido: Sentido;
  /** ¿Atañe realmente a la afirmación? Declarada explícitamente, jamás inferida. */
  readonly pertinente: boolean;
  /** Por qué es (o no) pertinente / de dónde sale — para poder explicarlo. */
  readonly motivoPertinencia: string | null;
  /** Referencia a la fuente (id de actividad, documento, ítem de negocio…), si la hay. */
  readonly fuente: string | null;
}
