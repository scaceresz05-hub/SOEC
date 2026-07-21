/**
 * Productos intelectuales de las operaciones (#13 §4).
 *
 * Cada producto se OFRECE al juicio humano: porta justificación, tipo,
 * incertidumbre, alcance y atribución; ninguno es una decisión ni es vinculante
 * (invariante de soberanía, #13 §5). No eleva la autoridad de las representaciones
 * sobre las que opera (#13 inv. 3). Puede abstenerse ("no sé" es legítimo, inv. 4).
 *
 * Trazabilidad: #12 (entrada: ECE) · #13 (autoridad principal).
 */
import type { Attribution } from '@soec/contracts';

/** Las cuatro operaciones arquitectónicas (marco extensible, #13 §3). */
export type TipoOperacion = 'esclarecer' | 'detectar' | 'proyectar' | 'orientar';

/** Causas de abstención (#16 de la orden). Clasificadas: conceptual o técnica. */
export type CausaAbstencion =
  | 'evidencia_insuficiente'
  | 'contradiccion_no_resoluble'
  | 'ausencia_critica'
  | 'alcance_insuficiente'
  | 'ece_desactualizado'
  | 'proposito_no_permitido'
  | 'mecanismo_no_disponible'
  | 'limite_presupuestario'
  | 'timeout'
  | 'cancelacion'
  | 'politica_datos';

const CAUSAS_CONCEPTUALES: readonly CausaAbstencion[] = [
  'evidencia_insuficiente',
  'contradiccion_no_resoluble',
  'ausencia_critica',
  'alcance_insuficiente',
  'proposito_no_permitido',
];

export function esCausaConceptual(c: CausaAbstencion): boolean {
  return CAUSAS_CONCEPTUALES.includes(c);
}

/** Corte del ECE consumido (tiempo de conocimiento). */
export interface CorteEce {
  readonly version: number;
  readonly recordedAt: string | null;
}

/** Anatomía común mínima de todo producto intelectual (#12 de la orden). */
export interface ProductoBase {
  readonly operacion: TipoOperacion;
  readonly eceId: string;
  readonly eceCorte: CorteEce;
  readonly proposito: string;
  readonly procedencia: string;
  readonly evidencia: readonly string[];
  /** Información faltante preservada explícitamente (#9 de la orden). */
  readonly faltante: readonly string[];
  readonly limitaciones: readonly string[];
  readonly incertidumbre: string;
  /** Estructura justificativa: por qué (anti-atrofia, #13 inv. 6). */
  readonly razones: readonly string[];
  /** Aspectos reservados al juicio humano (soberanía, #13 §5). */
  readonly cuestionesJuicioHumano: readonly string[];
  readonly atribucion: Attribution;
  readonly abstenido: boolean;
  readonly causaAbstencion: CausaAbstencion | null;
  /** Garantía estructural: ningún producto es una decisión vinculante. */
  readonly bindingDecision: false;
  readonly mecanismo: string;
  readonly mecanismoVersion: string;
}

// ── Productos especializados ────────────────────────────────────────────────

/** Un lado de una comprensión esclarecida (p. ej. cada parte de una contradicción). */
export interface LadoEsclarecido {
  readonly referencia: string;
  readonly tipo: 'observacion' | 'afirmacion' | 'evidencia';
  readonly contenido: string;
}
export interface Esclarecimiento {
  readonly elementoTipo: string;
  readonly lados: readonly LadoEsclarecido[];
  readonly relacionesExplicitas: readonly string[];
  readonly contradiccionSinResolver: boolean;
}

export interface Senal {
  readonly objeto: string;
  readonly entradas: readonly string[];
  readonly condiciones: readonly string[];
  readonly incertidumbre: string;
  readonly posibleFalsoPositivo: boolean;
  readonly noEvaluable: boolean;
}
export interface Deteccion {
  readonly senales: readonly Senal[];
}

export interface Escenario {
  readonly nombre: string;
  readonly supuestos: readonly string[];
  readonly condiciones: readonly string[];
  readonly resultadoProyectado: string;
  readonly incertidumbre: string;
}
export interface Proyeccion {
  readonly horizonte: string;
  readonly estadoObservado: readonly string[];
  readonly supuestos: readonly string[];
  readonly factoresNoObservados: readonly string[];
  readonly escenarios: readonly Escenario[];
}

export interface Consideracion {
  readonly asunto: string;
  readonly razones: readonly string[];
  readonly consecuenciasConocidas: readonly string[];
}
export interface Orientacion {
  readonly asunto: string;
  readonly consideraciones: readonly Consideracion[];
  readonly cuestionesReservadas: readonly string[];
  readonly noVinculante: true;
}

export type ProductoIntelectual =
  | (ProductoBase & { readonly operacion: 'esclarecer'; readonly esclarecimiento: Esclarecimiento })
  | (ProductoBase & { readonly operacion: 'detectar'; readonly deteccion: Deteccion })
  | (ProductoBase & { readonly operacion: 'proyectar'; readonly proyeccion: Proyeccion })
  | (ProductoBase & { readonly operacion: 'orientar'; readonly orientacion: Orientacion });

// ── Guardarraíles verificables ──────────────────────────────────────────────

/** Soberanía (#13 §5): ningún producto cierra el lazo ni ejecuta acciones. */
export function violaSoberania(p: ProductoIntelectual): boolean {
  return (p as { bindingDecision: unknown }).bindingDecision !== false;
}

/**
 * Anti-atrofia (#13 inv. 6): un producto no puede ser una conclusión opaca.
 * Debe mostrar razones/estructura, evidencia o faltante, y — si orienta —
 * qué queda reservado al juicio humano. Una abstención es comprensible si
 * declara su causa y qué falta.
 */
export function esOpaco(p: ProductoIntelectual): boolean {
  if (p.abstenido) {
    return p.causaAbstencion === null || (p.faltante.length === 0 && p.limitaciones.length === 0);
  }
  const tieneSoporte = p.razones.length > 0 || p.evidencia.length > 0 || p.faltante.length > 0;
  if (!tieneSoporte) return true;
  if (p.operacion === 'orientar' && p.cuestionesJuicioHumano.length === 0) return true;
  return false;
}
