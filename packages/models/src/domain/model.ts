/**
 * Núcleo de dominio de los Modelos (MED y MDM).
 *
 * Realiza la anatomía común de Modelo (Simetría, #9 inv. 11) instanciada sobre
 * dos dominios (#10 la empresa, #11 el mundo), sin redefinir ninguna entidad
 * congelada. Toda afirmación y evidencia son de primera clase (#9, #10 §3).
 *
 * Trazabilidad: #9 (invariantes y anatomía) · #10 (MED) · #11 (MDM) · #12 (frontera).
 */
import type { Attribution, RecordedEvent } from '@soec/contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de modelo y dimensiones (marco extensible, #10 §2 / #11 §2)
// ─────────────────────────────────────────────────────────────────────────────
export type ModelType = 'MED' | 'MDM';

/** Dimensiones canónicas del MED (#10 §2). El marco es extensible: son guía, no cierre. */
export const DIMENSIONES_MED = ['es', 'hace', 'tiene-debe', 'relaciona', 'quiere-ir', 'cambio'] as const;

/** Dimensiones canónicas del MDM (#11 §2). */
export const DIMENSIONES_MDM = [
  'normativo',
  'economico',
  'actores-externos',
  'tecnologico',
  'social-ambiental',
  'dinamica',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Anatomía interna (#10 §3) — conceptos de dominio
// ─────────────────────────────────────────────────────────────────────────────

/** Ámbito y supuestos declarados: qué representa el modelo y qué deja fuera (#9 inv. 2). */
export interface AmbitoDeclarado {
  readonly proposito: string;
  readonly representa: string;
  readonly excluye: string;
  readonly supuestos: readonly string[];
}

/** Vigencia temporal de la representación (#10 §4 caducidad · #11 vigencia). */
export interface Vigencia {
  readonly desde: string;
  readonly hasta: string | null;
}

/** Estado de revisión de una afirmación (#9 Revisabilidad). Nunca borra historia. */
export type EstadoAfirmacion = 'pendiente' | 'respaldada' | 'cuestionada' | 'superada';

/** Cómo una evidencia se relaciona con una afirmación (#9 Evidencia ╪ Afirmación). */
export type RelacionEvidencia = 'sostiene' | 'debilita' | 'inconclusa';

/** Entidad representada: referente interno de las afirmaciones (#10 §3). Su `tipo` es
 * contenido de instanciación (unidad, recurso, proceso… / norma, actor externo…), no
 * un concepto arquitectónico nuevo (#10 §2 distinción de instanciación). */
export interface EntidadRepresentada {
  readonly id: string;
  readonly dimension: string;
  readonly tipo: string;
  readonly atributos: Record<string, unknown>;
  readonly vigente: boolean;
}

/** Relación interna entre entidades del mismo modelo (#10 §3). */
export interface RelacionInterna {
  readonly id: string;
  readonly desde: string;
  readonly hasta: string;
  readonly naturaleza: string;
}

export interface Evidencia {
  readonly id: string;
  readonly afirmacionId: string;
  readonly relacion: RelacionEvidencia;
  readonly procedencia: string;
  readonly contenido: string;
  readonly atribucion: Attribution;
}

export interface CambioEstado {
  readonly estado: EstadoAfirmacion;
  readonly motivo: string;
  readonly registradoEn: string;
}

export interface Afirmacion {
  readonly id: string;
  readonly enunciado: string;
  readonly dimension: string;
  readonly estado: EstadoAfirmacion;
  readonly incertidumbre: string;
  readonly limitacion: string | null;
  readonly atribucion: Attribution;
  readonly evidencias: readonly string[];
  readonly supersededBy: string | null;
  readonly historialEstados: readonly CambioEstado[];
}

/** Observación externa atribuida — propia del MDM (Diferencia 2, acceso mediado, #11 §3). */
export interface Observacion {
  readonly id: string;
  readonly entidadId: string | null;
  readonly contenido: string;
  readonly atribucion: Attribution;
  readonly ocurridoEn: string;
}

/** Cambio autónomo del mundo — propio del MDM (Diferencia 3, cambio autónomo, #11 §3). */
export interface CambioExterno {
  readonly id: string;
  readonly entidadId: string | null;
  readonly descripcion: string;
  readonly ocurridoEn: string;
  readonly atribucion: Attribution;
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado del agregado (proyección sobre la historia inmutable, #9 inv. 4)
// ─────────────────────────────────────────────────────────────────────────────
export interface ModelInstanceState {
  readonly instanceId: string;
  readonly modelType: ModelType;
  readonly organizationId: string;
  /** Necesidad técnica (concurrencia optimista, ADR-0002 C-1) — NO es un concepto de dominio. */
  readonly version: number;
  readonly existe: boolean;
  readonly ambito: AmbitoDeclarado | null;
  readonly vigencia: Vigencia | null;
  readonly entidades: Readonly<Record<string, EntidadRepresentada>>;
  readonly relacionesInternas: readonly RelacionInterna[];
  readonly afirmaciones: Readonly<Record<string, Afirmacion>>;
  readonly evidencias: Readonly<Record<string, Evidencia>>;
  readonly observaciones: readonly Observacion[];
  readonly cambiosExternos: readonly CambioExterno[];
}

export function estadoInicial(instanceId: string, modelType: ModelType, organizationId: string): ModelInstanceState {
  return {
    instanceId,
    modelType,
    organizationId,
    version: 0,
    existe: false,
    ambito: null,
    vigencia: null,
    entidades: {},
    relacionesInternas: [],
    afirmaciones: {},
    evidencias: {},
    observaciones: [],
    cambiosExternos: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de evento de dominio (namespaced por modelo → separación verificable §8)
// ─────────────────────────────────────────────────────────────────────────────
export const EVENTOS = {
  med: {
    creada: 'med.instancia_creada',
    entidad: 'med.entidad_registrada',
    entidadModificada: 'med.entidad_modificada',
    relacion: 'med.relacion_interna_registrada',
    afirmacion: 'med.afirmacion_emitida',
    evidencia: 'med.evidencia_incorporada',
    revision: 'med.afirmacion_revisada',
  },
  mdm: {
    creada: 'mdm.instancia_creada',
    entidad: 'mdm.entidad_externa_registrada',
    entidadModificada: 'mdm.entidad_modificada',
    relacion: 'mdm.relacion_interna_registrada',
    observacion: 'mdm.observacion_registrada',
    afirmacion: 'mdm.afirmacion_mundo_emitida',
    evidencia: 'mdm.evidencia_externa_incorporada',
    revision: 'mdm.afirmacion_mundo_revisada',
    cambioExterno: 'mdm.cambio_externo_registrado',
  },
} as const;

/** Prefijo de stream por modelo — garantiza que MED y MDM viven en streams distintos. */
export function streamId(modelType: ModelType, instanceId: string): string {
  return `${modelType.toLowerCase()}:${instanceId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payloads (tipados; el sobre RecordedEvent aporta atribución, organización, tiempo)
// ─────────────────────────────────────────────────────────────────────────────
interface PayloadCreada {
  ambito: AmbitoDeclarado;
  vigencia: Vigencia;
}
interface PayloadEntidad {
  entidadId: string;
  dimension: string;
  tipo: string;
  atributos: Record<string, unknown>;
}
interface PayloadEntidadModificada {
  entidadId: string;
  atributos?: Record<string, unknown>;
  vigente?: boolean;
}
interface PayloadRelacion {
  relId: string;
  desde: string;
  hasta: string;
  naturaleza: string;
}
interface PayloadAfirmacion {
  afirmacionId: string;
  enunciado: string;
  dimension: string;
  incertidumbre: string;
  limitacion?: string | null;
}
interface PayloadEvidencia {
  evidenciaId: string;
  afirmacionId: string;
  relacion: RelacionEvidencia;
  procedencia: string;
  contenido: string;
}
interface PayloadRevision {
  afirmacionId: string;
  nuevoEstado: EstadoAfirmacion;
  motivo: string;
  supersededBy?: string | null;
}
interface PayloadObservacion {
  observacionId: string;
  entidadId?: string | null;
  contenido: string;
}
interface PayloadCambioExterno {
  cambioId: string;
  entidadId?: string | null;
  descripcion: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reducción: historia inmutable → estado actual (proyección, #9 inv. 4)
// ─────────────────────────────────────────────────────────────────────────────
export function aplicar(state: ModelInstanceState, event: RecordedEvent): ModelInstanceState {
  const next = { ...state, version: state.version + 1 };
  const t = event.type;

  // Creación (ambos modelos)
  if (t === EVENTOS.med.creada || t === EVENTOS.mdm.creada) {
    const p = event.payload as PayloadCreada;
    return { ...next, existe: true, ambito: p.ambito, vigencia: p.vigencia };
  }
  // Entidad representada
  if (t === EVENTOS.med.entidad || t === EVENTOS.mdm.entidad) {
    const p = event.payload as PayloadEntidad;
    return {
      ...next,
      entidades: {
        ...state.entidades,
        [p.entidadId]: {
          id: p.entidadId,
          dimension: p.dimension,
          tipo: p.tipo,
          atributos: p.atributos,
          vigente: true,
        },
      },
    };
  }
  if (t === EVENTOS.med.entidadModificada || t === EVENTOS.mdm.entidadModificada) {
    const p = event.payload as PayloadEntidadModificada;
    const actual = state.entidades[p.entidadId];
    if (!actual) return next;
    return {
      ...next,
      entidades: {
        ...state.entidades,
        [p.entidadId]: {
          ...actual,
          atributos: p.atributos ? { ...actual.atributos, ...p.atributos } : actual.atributos,
          vigente: p.vigente ?? actual.vigente,
        },
      },
    };
  }
  // Relación interna
  if (t === EVENTOS.med.relacion || t === EVENTOS.mdm.relacion) {
    const p = event.payload as PayloadRelacion;
    return {
      ...next,
      relacionesInternas: [
        ...state.relacionesInternas,
        { id: p.relId, desde: p.desde, hasta: p.hasta, naturaleza: p.naturaleza },
      ],
    };
  }
  // Afirmación emitida (nace 'pendiente' — no se convierte en hecho por existir, §9)
  if (t === EVENTOS.med.afirmacion || t === EVENTOS.mdm.afirmacion) {
    const p = event.payload as PayloadAfirmacion;
    return {
      ...next,
      afirmaciones: {
        ...state.afirmaciones,
        [p.afirmacionId]: {
          id: p.afirmacionId,
          enunciado: p.enunciado,
          dimension: p.dimension,
          estado: 'pendiente',
          incertidumbre: p.incertidumbre,
          limitacion: p.limitacion ?? null,
          atribucion: event.attribution,
          evidencias: [],
          supersededBy: null,
          historialEstados: [
            { estado: 'pendiente', motivo: 'emisión', registradoEn: event.recordedAt },
          ],
        },
      },
    };
  }
  // Evidencia incorporada (no eleva certeza automáticamente, §9)
  if (t === EVENTOS.med.evidencia || t === EVENTOS.mdm.evidencia) {
    const p = event.payload as PayloadEvidencia;
    const af = state.afirmaciones[p.afirmacionId];
    if (!af) return next;
    return {
      ...next,
      evidencias: {
        ...state.evidencias,
        [p.evidenciaId]: {
          id: p.evidenciaId,
          afirmacionId: p.afirmacionId,
          relacion: p.relacion,
          procedencia: p.procedencia,
          contenido: p.contenido,
          atribucion: event.attribution,
        },
      },
      afirmaciones: {
        ...state.afirmaciones,
        [p.afirmacionId]: { ...af, evidencias: [...af.evidencias, p.evidenciaId] },
      },
    };
  }
  // Revisión de afirmación (cambia estado; conserva la historia)
  if (t === EVENTOS.med.revision || t === EVENTOS.mdm.revision) {
    const p = event.payload as PayloadRevision;
    const af = state.afirmaciones[p.afirmacionId];
    if (!af) return next;
    return {
      ...next,
      afirmaciones: {
        ...state.afirmaciones,
        [p.afirmacionId]: {
          ...af,
          estado: p.nuevoEstado,
          supersededBy: p.supersededBy ?? af.supersededBy,
          historialEstados: [
            ...af.historialEstados,
            { estado: p.nuevoEstado, motivo: p.motivo, registradoEn: event.recordedAt },
          ],
        },
      },
    };
  }
  // Observación externa atribuida (solo MDM)
  if (t === EVENTOS.mdm.observacion) {
    const p = event.payload as PayloadObservacion;
    return {
      ...next,
      observaciones: [
        ...state.observaciones,
        {
          id: p.observacionId,
          entidadId: p.entidadId ?? null,
          contenido: p.contenido,
          atribucion: event.attribution,
          ocurridoEn: event.occurredAt,
        },
      ],
    };
  }
  // Cambio autónomo del mundo (solo MDM)
  if (t === EVENTOS.mdm.cambioExterno) {
    const p = event.payload as PayloadCambioExterno;
    return {
      ...next,
      cambiosExternos: [
        ...state.cambiosExternos,
        {
          id: p.cambioId,
          entidadId: p.entidadId ?? null,
          descripcion: p.descripcion,
          ocurridoEn: event.occurredAt,
          atribucion: event.attribution,
        },
      ],
    };
  }
  // Evento desconocido para este agregado: no altera el estado (solo la versión).
  return next;
}

/** Reconstruye el estado a partir de la historia (fold sobre eventos). */
export function reconstruir(
  instanceId: string,
  modelType: ModelType,
  organizationId: string,
  events: readonly RecordedEvent[],
): ModelInstanceState {
  return events.reduce(aplicar, estadoInicial(instanceId, modelType, organizationId));
}
