/**
 * Afirmaciones y procedencia (F2-CONT-01 §6). SOEC no puede producir contenido
 * comercial inventando datos del negocio: toda afirmación relevante se clasifica
 * por su origen y su riesgo, y conserva su fuente. La ausencia de información es
 * VISIBLE, nunca se rellena; una propuesta creativa no se convierte en dato real.
 */

/** Tipo de afirmación según su origen epistémico. */
export type TipoAfirmacion =
  | 'hecho_confirmado' // verificable, respaldado por fuente
  | 'declarada_empresa' // la empresa lo declara (no verificado por SOEC)
  | 'inferencia' // derivada de datos disponibles
  | 'propuesta_creativa' // recurso editorial, NO un dato del negocio
  | 'no_sustentada' // afirmación sin respaldo (no puede presentarse como hecho)
  | 'prohibida' // vetada por política (bloquea la pieza)
  | 'dato_faltante'; // información necesaria que no se posee

export type RiesgoAfirmacion = 'bajo' | 'medio' | 'alto';
export type EstadoAfirmacion = 'pendiente' | 'validada' | 'rechazada';

/** Una afirmación relevante dentro de una pieza, con su procedencia y control. */
export interface Afirmacion {
  readonly id: string;
  readonly texto: string;
  readonly tipo: TipoAfirmacion;
  /** De dónde proviene (documento, declaración, política, recurso creativo…). */
  readonly fuente: string;
  /** Confianza declarada [0,1]; nunca elevada por la adaptación. */
  readonly confianza: number;
  /** Política aplicable (id de la versión que la rige), si corresponde. */
  readonly politicaAplicable: string | null;
  readonly riesgo: RiesgoAfirmacion;
  readonly estado: EstadoAfirmacion;
}

/** Tipos que NO pueden presentarse al público como un hecho establecido. */
const NO_PRESENTABLES_COMO_HECHO: ReadonlySet<TipoAfirmacion> = new Set([
  'inferencia',
  'propuesta_creativa',
  'no_sustentada',
  'prohibida',
  'dato_faltante',
]);

export function puedePresentarseComoHecho(tipo: TipoAfirmacion): boolean {
  return !NO_PRESENTABLES_COMO_HECHO.has(tipo);
}

/** Una afirmación prohibida (o no sustentada presentada como hecho) bloquea la pieza. */
export function afirmacionBloquea(a: Afirmacion): boolean {
  if (a.tipo === 'prohibida') return true;
  if (a.tipo === 'no_sustentada' && a.estado !== 'rechazada') return true;
  return false;
}

/** La ausencia de información queda visible como afirmación de tipo dato_faltante. */
export function faltantesDe(afirmaciones: readonly Afirmacion[]): readonly string[] {
  return afirmaciones.filter((a) => a.tipo === 'dato_faltante').map((a) => a.texto);
}

/**
 * La adaptación/traducción NO puede elevar la certeza de una afirmación de la
 * pieza fuente. Devuelve la afirmación con confianza acotada por la original.
 */
export function sinElevarCerteza(original: Afirmacion, adaptada: Afirmacion): Afirmacion {
  const confianza = Math.min(original.confianza, adaptada.confianza);
  return { ...adaptada, confianza, tipo: original.tipo };
}
