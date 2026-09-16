/**
 * @soec/campanias · dominio · Campaña gobernada derivada de una decisión (Bloque C).
 *
 * Una campaña NO puede ser huérfana: siempre referencia una `decisionId` de
 * `@soec/decisiones-mkt`, de la MISMA organización. No es un simple contenedor
 * de publicaciones: conserva objetivo, público, hipótesis, presupuesto, criterios de éxito y
 * de pausa, nivel de autonomía y aprobaciones. Event-sourced (`campania:<org>:<id>`).
 *
 * BORRADOR SIN PRESUPUESTO. Una campaña puede existir, editarse y especificarse por completo
 * —objetivo, canal planificado, destino, alcance geográfico, requisitos previos— con
 * `presupuesto: null`, porque planificar no es invertir y un presupuesto no se inventa para poder
 * escribir un plan. Lo que NO puede hacer así es volverse ejecutable: la entrada a un estado
 * ejecutable exige presupuesto > 0 y una decisión aprobada, y eso se comprueba aquí, en dominio
 * (`evaluarActivacion`), no en la interfaz.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { AlcanceGeografico } from './alcance';

export type EstadoCampania = 'BORRADOR' | 'ACTIVA' | 'PAUSADA' | 'COMPLETADA' | 'CANCELADA';

export interface Presupuesto {
  readonly monto: number;
  readonly moneda: string;
}

/** Destino de un grupo dentro de la campaña (p. ej. un grupo de anuncios con su propia landing). */
export interface DestinoGrupo {
  readonly grupo: string;
  readonly destino: string;
}

/** Política que gobierna cómo puede nacer una campaña (definida por el usuario). */
export interface PoliticaCampania {
  readonly requiereAprobacion: boolean;
  readonly presupuestoMaximo: number;
  /** Permite campañas operativas no experimentales (sin hipótesis). Por defecto false. */
  readonly permiteNoExperimental: boolean;
}
export const POLITICA_CAMPANIA_CONSERVADORA: PoliticaCampania = {
  requiereAprobacion: true,
  presupuestoMaximo: Number.POSITIVE_INFINITY,
  permiteNoExperimental: false,
};

export interface Campania {
  readonly campaniaId: string;
  readonly organizacionId: string;
  readonly decisionId: string;
  /** Nombre comercial legible («CP | Implantes | Provincia de Curicó»). El id sigue siendo la identidad. */
  readonly nombre: string;
  readonly objetivo: string;
  readonly publico: string;
  readonly propuesta: string;
  readonly mensaje: string;
  /** Canal PLANIFICADO. Planificar un canal no crea nada en él. */
  readonly canal: string;
  readonly contenidoRequerido: readonly string[];
  readonly calendario: string;
  /** `null` = todavía no decidido. Nunca se sustituye por 0 ni por una cifra de relleno. */
  readonly presupuesto: Presupuesto | null;
  readonly hipotesis: readonly string[];
  readonly metricas: readonly string[];
  readonly criterioExito: string;
  readonly criterioPausa: string;
  readonly nivelAutonomia: number;
  readonly aprobaciones: readonly string[];
  readonly riesgos: readonly string[];
  /** Landing principal. */
  readonly destino: string | null;
  /** Landings por grupo, cuando la campaña agrupa varias. */
  readonly destinosPorGrupo: readonly DestinoGrupo[];
  /** Lo que debe cumplirse ANTES de invertir. Registrado, no inferido. */
  readonly requisitosPrevios: readonly string[];
  readonly alcanceGeografico: AlcanceGeografico | null;
  readonly estado: EstadoCampania;
  readonly autor: string;
  readonly en: string;
  readonly version: number;
  readonly existe: boolean;
}

const TRANSICIONES: Readonly<Record<EstadoCampania, readonly EstadoCampania[]>> = {
  BORRADOR: ['ACTIVA', 'CANCELADA'],
  ACTIVA: ['PAUSADA', 'COMPLETADA', 'CANCELADA'],
  PAUSADA: ['ACTIVA', 'CANCELADA'],
  COMPLETADA: [],
  CANCELADA: [],
};
export function transicionCampaniaValida(desde: EstadoCampania, hacia: EstadoCampania): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/** Estados en los que una campaña puede ejecutar gasto, publicar o crear objetos externos. */
export const ESTADOS_CAMPANIA_EJECUTABLES: readonly EstadoCampania[] = ['ACTIVA'];

export function esEstadoCampaniaEjecutable(estado: EstadoCampania): boolean {
  return ESTADOS_CAMPANIA_EJECUTABLES.includes(estado);
}

/** Presupuesto que autoriza ejecutar: definido, numérico, finito y estrictamente positivo. */
export function presupuestoEjecutable(p: Presupuesto | null): boolean {
  return p !== null && typeof p.monto === 'number' && Number.isFinite(p.monto) && p.monto > 0;
}

/**
 * Estado de la decisión referenciada que autoriza ejecutar. `APROBADA` o ya `EN_EJECUCION` (que sólo se
 * alcanza desde `APROBADA`). Cualquier otro —incluido `NO_EVALUABLE`— bloquea.
 */
const ESTADOS_DECISION_QUE_AUTORIZAN = ['APROBADA', 'EN_EJECUCION'] as const;

/**
 * ¿Puede esta campaña entrar en un estado ejecutable? Devuelve TODOS los motivos que lo impiden, para
 * que quien pregunte sepa qué falta sin tener que intentarlo. Función pura: la usa `transicionar` para
 * bloquear y cualquier lectura para informar.
 */
export function evaluarActivacion(
  c: Campania,
  estadoDecision: string | null,
): { readonly ok: boolean; readonly motivos: readonly string[] } {
  const motivos: string[] = [];
  if (c.presupuesto === null) motivos.push('presupuesto no definido: una campaña sin presupuesto no puede activarse');
  else if (!presupuestoEjecutable(c.presupuesto)) motivos.push(`presupuesto no positivo (${c.presupuesto.monto}): debe ser > 0 para activarse`);
  if (estadoDecision === null) motivos.push('la decisión referenciada no existe');
  else if (!(ESTADOS_DECISION_QUE_AUTORIZAN as readonly string[]).includes(estadoDecision)) {
    motivos.push(`la decisión referenciada está en ${estadoDecision}; se requiere APROBADA`);
  }
  return { ok: motivos.length === 0, motivos };
}

export const EVENTOS_CAMPANIA = {
  creada: 'campania.creada',
  transicionada: 'campania.transicionada',
  borradorActualizado: 'campania.borrador_actualizado',
} as const;

/** Campos que un BORRADOR puede cambiar. Identidad, decisión, estado y aprobaciones quedan fuera. */
export type CambiosBorrador = Partial<
  Pick<
    Campania,
    | 'nombre'
    | 'objetivo'
    | 'publico'
    | 'propuesta'
    | 'mensaje'
    | 'canal'
    | 'contenidoRequerido'
    | 'calendario'
    | 'presupuesto'
    | 'hipotesis'
    | 'metricas'
    | 'criterioExito'
    | 'criterioPausa'
    | 'riesgos'
    | 'destino'
    | 'destinosPorGrupo'
    | 'requisitosPrevios'
    | 'alcanceGeografico'
  >
>;

export function campaniaStreamId(organizacionId: string, campaniaId: string): string {
  return `campania:${organizacionId}:${campaniaId}`;
}

export function estadoInicialCampania(organizacionId: string, campaniaId: string): Campania {
  return {
    campaniaId,
    organizacionId,
    decisionId: '',
    nombre: '',
    objetivo: '',
    publico: '',
    propuesta: '',
    mensaje: '',
    canal: '',
    contenidoRequerido: [],
    calendario: '',
    presupuesto: null,
    hipotesis: [],
    metricas: [],
    criterioExito: '',
    criterioPausa: '',
    nivelAutonomia: 0,
    aprobaciones: [],
    riesgos: [],
    destino: null,
    destinosPorGrupo: [],
    requisitosPrevios: [],
    alcanceGeografico: null,
    estado: 'BORRADOR',
    autor: '',
    en: '',
    version: 0,
    existe: false,
  };
}

export function aplicarCampania(state: Campania, event: RecordedEvent): Campania {
  const next = { ...state, version: state.version + 1, existe: true };
  switch (event.type) {
    case EVENTOS_CAMPANIA.creada:
      // Los eventos anteriores a los campos nuevos no los traen: conservan los valores iniciales.
      return { ...next, ...(event.payload as Partial<Campania>), autor: String(event.actor), en: event.recordedAt };
    case EVENTOS_CAMPANIA.transicionada:
      return { ...next, estado: (event.payload as { estado: EstadoCampania }).estado };
    case EVENTOS_CAMPANIA.borradorActualizado:
      return { ...next, ...(event.payload as CambiosBorrador) };
    default:
      return next;
  }
}

export function reconstruirCampania(organizacionId: string, campaniaId: string, events: readonly RecordedEvent[]): Campania {
  return events.reduce(aplicarCampania, estadoInicialCampania(organizacionId, campaniaId));
}
