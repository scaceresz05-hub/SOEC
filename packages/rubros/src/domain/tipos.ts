/**
 * @soec/rubros · dominio · tipos del conocimiento por rubro (v1.1).
 *
 * Modela conocimiento (datos + auditoría), NO lógica de instancia. Los conjuntos de
 * estado y confianza son cerrados y tipados. La v1.1 incorpora la Capa de Producto
 * causal: SEÑALES diagnósticas (con condición de activación explícita) y MAPEOS
 * versionados señal→objetivo→estrategia, más activadores regulatorios tipados por
 * estrategia/regla. Todo entra al motor solo por el puerto (ver port.ts).
 */

/** Estados de madurez del conocimiento (conjunto cerrado). */
export type EstadoMadurez = 'DRAFT' | 'PRELIMINARY' | 'RATIFIED' | 'DEPRECATED';
export const ESTADOS_MADUREZ: readonly EstadoMadurez[] = [
  'DRAFT',
  'PRELIMINARY',
  'RATIFIED',
  'DEPRECATED',
];

/** Confianza de una entrada, para uso del motor (no del usuario). Conjunto cerrado. */
export type Confianza = 'LOW' | 'MEDIUM' | 'HIGH';
export const CONFIANZAS: readonly Confianza[] = ['LOW', 'MEDIUM', 'HIGH'];

/** Estado de verificación de una regla regulatoria. */
export type EstadoVerificacion = 'PENDING_LEGAL_REVIEW' | 'VERIFIED';

/** Activadores regulatorios tipados: característica declarada de una estrategia. */
export type ActivadorRegulatorio =
  | 'USA_DATOS_DE_PACIENTES'
  | 'CONTACTA_BASE_EXISTENTE'
  | 'USA_IMAGEN_DE_PACIENTE'
  | 'USA_ANTES_DESPUES'
  | 'AFIRMA_RESULTADO_CLINICO';
export const ACTIVADORES_REGULATORIOS: readonly ActivadorRegulatorio[] = [
  'USA_DATOS_DE_PACIENTES',
  'CONTACTA_BASE_EXISTENTE',
  'USA_IMAGEN_DE_PACIENTE',
  'USA_ANTES_DESPUES',
  'AFIRMA_RESULTADO_CLINICO',
];

/** Tipo de conocimiento (discriminante). */
export type TipoConocimiento =
  | 'objetivo'
  | 'estrategia'
  | 'metrica'
  | 'embudo'
  | 'restriccion_general'
  | 'supuesto'
  | 'regulatorio'
  | 'producto'
  | 'senal'
  | 'mapeo';

/**
 * Metadatos de auditoría que TODA entrada conserva: identidad permanente +
 * procedencia + estado + confianza. El `id` es estable de por vida.
 */
export interface Auditoria {
  readonly id: string;
  readonly tipo: TipoConocimiento;
  readonly origen: string;
  readonly motivo: string;
  readonly incorporado: string;
  readonly apareceEn: string;
  readonly cambio: string;
  readonly estado: EstadoMadurez;
  readonly confianza: Confianza;
}

export interface Objetivo extends Auditoria {
  readonly tipo: 'objetivo';
  readonly objetivo: string;
  readonly metrica: string;
  readonly costoMedicion?: string;
}

export interface Estrategia extends Auditoria {
  readonly tipo: 'estrategia';
  readonly estrategia: string;
  /** IDs de objetivos que atiende (referencial). */
  readonly atiende: readonly string[];
  /** Activadores regulatorios que esta estrategia PUEDE implicar (puede ir vacío). */
  readonly activadores: readonly ActivadorRegulatorio[];
}

export interface Metrica extends Auditoria {
  readonly tipo: 'metrica';
  readonly metrica: string;
}

export interface Embudo extends Auditoria {
  readonly tipo: 'embudo';
  readonly etapas: readonly string[];
}

export interface RestriccionGeneral extends Auditoria {
  readonly tipo: 'restriccion_general';
  readonly restriccion: string;
}

export interface Supuesto extends Auditoria {
  readonly tipo: 'supuesto';
  readonly supuesto: string;
}

export interface Regulatorio extends Auditoria {
  readonly tipo: 'regulatorio';
  readonly regla: string;
  readonly rigor: 'DURA' | 'BLANDA';
  readonly verificacion: EstadoVerificacion;
  /** Activadores que esta regla observa; se activa solo si la estrategia los declara. */
  readonly observa: readonly ActivadorRegulatorio[];
  /** Efecto cuando se activa: advierte o bloquea la estrategia afectada. */
  readonly efecto: 'ADVIERTE' | 'BLOQUEA';
}

export type ClaveProducto =
  'preguntas_diagnosticas' | 'construccion_hipotesis' | 'priorizacion' | 'plantilla_explicacion';

export interface Producto extends Auditoria {
  readonly tipo: 'producto';
  readonly clave: ClaveProducto;
  readonly texto?: string;
  readonly preguntas?: readonly string[];
}

/** Condición explícita de activación de una señal (sin coincidencia libre de texto). */
export interface CondicionActivacion {
  readonly operador: 'IGUAL_A';
  readonly valor: string | boolean;
}

/** Señal diagnóstica: se activa por el VALOR normalizado de una pregunta cerrada. */
export interface Senal extends Auditoria {
  readonly tipo: 'senal';
  /** Nombre estructurado (p. ej. 'POCAS_SOLICITUDES'). */
  readonly nombre: string;
  /** Pregunta cerrada cuyo valor evalúa la activación. */
  readonly preguntaId: string;
  readonly condicionActivacion: CondicionActivacion;
}

/** Mapeo causal versionado: señal ACTIVA → objetivo candidato (+ estrategia compatible). */
export interface Mapeo extends Auditoria {
  readonly tipo: 'mapeo';
  readonly senalId: string;
  readonly objetivoId: string;
  readonly estrategiaId: string;
  readonly porque: string;
}

export type Entrada =
  | Objetivo
  | Estrategia
  | Metrica
  | Embudo
  | RestriccionGeneral
  | Supuesto
  | Regulatorio
  | Producto
  | Senal
  | Mapeo;

export type RestriccionAplicable = RestriccionGeneral | Regulatorio;

export interface RubroKnowledge {
  readonly rubroId: string;
  readonly version: string;
  readonly objetivos: readonly Objetivo[];
  readonly estrategias: readonly Estrategia[];
  readonly metricas: readonly Metrica[];
  readonly embudos: readonly Embudo[];
  readonly restriccionesGenerales: readonly RestriccionGeneral[];
  readonly supuestos: readonly Supuesto[];
  readonly regulatorio: readonly Regulatorio[];
  readonly producto: readonly Producto[];
  readonly senales: readonly Senal[];
  readonly mapeos: readonly Mapeo[];
}

/** Todas las entradas de un rubro, en una sola lista (para auditoría/validación). */
export function todasLasEntradas(d: RubroKnowledge): readonly Entrada[] {
  return [
    ...d.objetivos,
    ...d.estrategias,
    ...d.metricas,
    ...d.embudos,
    ...d.restriccionesGenerales,
    ...d.supuestos,
    ...d.regulatorio,
    ...d.producto,
    ...d.senales,
    ...d.mapeos,
  ];
}
