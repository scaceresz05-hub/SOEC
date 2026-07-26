/**
 * @soec/diagnostico · dominio · tipos del motor de Diagnóstico.
 *
 * Separa explícitamente las tres cosas: RESPUESTAS entregadas por la instancia
 * (entrada), la COMPRENSIÓN producida por el motor (salida), y —fuera de aquí— el
 * CONOCIMIENTO del rubro (que se inyecta solo por `RubroKnowledgePort`). Cada
 * resultado conserva procedencia estable para reconstruir por qué apareció.
 *
 * `preguntaId` referencia una pregunta del diagnóstico del rubro (su texto estable).
 */

/** Respuesta de la instancia a una pregunta del diagnóstico. */
export type Respuesta =
  | {
      readonly preguntaId: string;
      readonly tipo: 'afirmada';
      readonly enunciado: string;
      readonly sustento: string;
      /** Valor normalizado de la respuesta (p. ej. true/false en preguntas cerradas). */
      readonly valor?: string | boolean;
    }
  | { readonly preguntaId: string; readonly tipo: 'ausente' }
  | {
      readonly preguntaId: string;
      readonly tipo: 'contradictoria';
      readonly enunciado: string;
      readonly aFavor: string;
      readonly enContra: string;
    };

export type RespuestasDiagnostico = readonly Respuesta[];

/** Un hecho comprendido, con procedencia hasta la respuesta y su evidencia. */
export interface HechoComprendido {
  readonly preguntaId: string;
  readonly afirmacionId: string;
  readonly evidenciaIds: readonly string[];
  readonly enunciado: string;
  /** Valor normalizado del hecho, preservado para evaluar la activación de señales. */
  readonly valor?: string | boolean;
}

/** Un faltante explícito: ausencia de información, NUNCA una conclusión negativa. */
export interface FaltanteDiagnostico {
  readonly preguntaId: string;
  readonly motivo: 'SIN_RESPUESTA' | 'RESPUESTA_AUSENTE' | 'EVIDENCIA_INSUFICIENTE';
  /** Mensaje en clave de ausencia de evidencia (p. ej. «No existe información suficiente sobre …»). */
  readonly mensaje: string;
}

/** Una contradicción abierta (no resuelta), con su evidencia a favor y en contra. */
export interface ContradiccionDiagnostico {
  readonly preguntaId: string;
  readonly afirmacionId: string;
  readonly evidenciaAFavor: readonly string[];
  readonly evidenciaEnContra: readonly string[];
}

/** Traza del mecanismo que produjo cada operación (para probar el determinismo). */
export interface OperacionEjecutada {
  readonly operacion: string;
  readonly mecanismo: string | null;
}

/** La comprensión evaluable producida por el motor «Comprender el estado». */
export interface ComprensionEvaluable {
  readonly diagnosticoId: string;
  readonly rubroId: string;
  readonly hechos: readonly HechoComprendido[];
  readonly faltantes: readonly FaltanteDiagnostico[];
  readonly contradicciones: readonly ContradiccionDiagnostico[];
  readonly abstenido: boolean;
  /** Síntesis del producto de la capacidad (comprensión evaluable del motor). */
  readonly comprension: {
    readonly nombre: string;
    readonly incertidumbre: string;
    readonly contradiccionesAbiertas: readonly string[];
    readonly faltante: readonly string[];
    readonly productoCompuesto: readonly string[];
  };
  /** Operaciones ejecutadas y su mecanismo (debe ser solo el determinista). */
  readonly operaciones: readonly OperacionEjecutada[];
}
