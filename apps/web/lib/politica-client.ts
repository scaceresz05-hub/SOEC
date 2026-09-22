/**
 * Cliente de OBJETIVOS Y CRITERIOS (política de evaluación) vía BFF autenticado `/api/backend/politica`.
 *
 * La organización activa viaja en cabecera; la sesión en cookie httpOnly. Este cliente sólo transporta
 * decisiones del negocio (qué quiere conseguir, qué acción cuenta, qué meta): nunca métricas observadas.
 */
import { cabecerasOrg } from './org-activa';

export type RolMetrica = 'PRIMARY' | 'SECONDARY';
export type EstadoDato = 'CONFIGURED' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type EstadoPerfil = 'EVALUATION_PROFILE_COMPLETE' | 'EVALUATION_PROFILE_INCOMPLETE';

export interface Kpi {
  id: string;
  rol: RolMetrica;
  clave: string;
  displayName: string;
  tipo: string;
  unidad: string;
  direccion: string;
  eventKey: string | null;
  targetValue: number | null;
  baselineValue: number | null;
  tolerance: number | null;
  estado: EstadoDato;
  orden: number;
}

export interface EventoConversion {
  eventKey: string;
  rol: RolMetrica;
  orden: number;
  displayName: string | null;
}

export interface ReglaEvaluacion {
  id: string;
  tipo: 'SUCCESS' | 'ALERT' | 'PAUSE' | 'ESCALATION' | 'EVIDENCE_MINIMUM';
  metrica: string;
  comparador: string;
  valor: number | null;
  estado: EstadoDato;
  /** Quién puso el número: la persona, el sistema, lo aprendido… La pantalla lo necesita para no confundirlos. */
  procedencia?: string;
  nota?: string | null;
}

export interface MotivoIncompletitud {
  campo: string;
  motivo: string;
  comoSeResuelve: string;
}

export interface VistaPolitica {
  organizationId: string;
  objetivoDeclarado: string | null;
  politica: {
    politica: {
      objectiveId: string;
      objectiveText: string | null;
      businessContext: string | null;
      evaluationHorizonDays: number | null;
      authorizedSpendClp: number | null;
      maxBudgetVariationPct: number | null;
      cooldownDays: number | null;
      scalingRequiresApproval: boolean;
      updatedAt: string;
    } | null;
    kpis: Kpi[];
    eventos: EventoConversion[];
    reglas: ReglaEvaluacion[];
    limites: {
      maxDailyBudgetClp: number | null;
      maxCpcClp: number | null;
      maxVariationPct: number | null;
      maxChangesPerDay: number | null;
      cooldownHours: number | null;
      minTermImpressionsForNegative: number | null;
      irrelevancePatterns: string[];
    } | null;
    canales: { canal: string; modo: string; nota: string | null }[];
  };
  completitud: {
    estado: EstadoPerfil;
    faltantes: MotivoIncompletitud[];
    recomendaciones: { campo: string; motivo: string }[];
    /** `LEARNING_BASELINE` ⇒ el indicador está elegido y la meta se está aprendiendo. */
    lineaBase?: 'CONFIRMED' | 'LEARNING_BASELINE';
    actualizadoEn: string | null;
  };
  referencias: {
    oferta: { id: string; slug: string; name: string; priority: number; advertisingEligibility: string }[];
    territorios: { id: string; ambito: string; country: string; region: string | null; province: string | null; localities: string[] }[];
    restricciones: { id: string; tipo: string; texto: string }[];
  };
  perfilEvaluableDisponible: boolean;
  /** Punto de partida que recomienda SOEC para el mínimo de evidencia. Lo fija el servidor, no la pantalla. */
  recomendacionEvidencia?: { metrica: string; valor: number; version: string } | null;
}

/**
 * Acciones de cliente frecuentes, en lenguaje humano. Es un MENÚ de la interfaz: la elección la hace el
 * dueño y se guarda tal cual. No se preselecciona ninguna ni se infiere del rubro.
 */
export const ACCIONES_FRECUENTES: ReadonlyArray<{ eventKey: string; etiqueta: string }> = [
  { eventKey: 'whatsapp_intent', etiqueta: 'Te escribe por WhatsApp' },
  { eventKey: 'phone_intent', etiqueta: 'Te llama por teléfono' },
  { eventKey: 'appointment_intent', etiqueta: 'Pide una hora o una cita' },
  { eventKey: 'form_submitted', etiqueta: 'Deja sus datos en un formulario' },
  { eventKey: 'demo_requested', etiqueta: 'Solicita una demostración' },
  { eventKey: 'purchase', etiqueta: 'Compra en el sitio' },
];

/** Indicadores frecuentes. El tipo y la unidad se derivan de la elección: el usuario no ve jerga. */
export const INDICADORES_FRECUENTES: ReadonlyArray<{
  clave: string; etiqueta: string; tipo: string; unidad: string; direccion: string; ayudaMeta: string;
}> = [
  { clave: 'contactos', etiqueta: 'Cantidad de contactos conseguidos', tipo: 'EVENT_COUNT', unidad: 'COUNT', direccion: 'HIGHER_IS_BETTER', ayudaMeta: '¿Cuántos quieres conseguir en el período?' },
  { clave: 'cpa', etiqueta: 'Cuánto te cuesta cada contacto', tipo: 'COST_PER', unidad: 'CURRENCY', direccion: 'LOWER_IS_BETTER', ayudaMeta: '¿Cuánto es aceptable pagar por cada contacto? (CLP)' },
  { clave: 'tasa_conversion', etiqueta: 'Porcentaje de visitas que terminan en contacto', tipo: 'RATE', unidad: 'RATE', direccion: 'HIGHER_IS_BETTER', ayudaMeta: 'Meta como fracción (0,03 = 3 %)' },
  { clave: 'ventas', etiqueta: 'Cantidad de ventas', tipo: 'EVENT_COUNT', unidad: 'COUNT', direccion: 'HIGHER_IS_BETTER', ayudaMeta: '¿Cuántas ventas esperas en el período?' },
  { clave: 'roas', etiqueta: 'Retorno de lo invertido en publicidad', tipo: 'RATIO', unidad: 'RATIO', direccion: 'HIGHER_IS_BETTER', ayudaMeta: 'Por cada $1 invertido, cuántos $ de venta (ej. 3)' },
];

/** Traducción de los motivos de incompletitud a un título corto para la lista de pendientes. */
export const TITULO_FALTANTE: Record<string, string> = {
  primaryObjective: 'Qué quieres conseguir',
  primaryConversionEvent: 'Qué acción de un cliente cuenta',
  primaryKpi: 'Con qué indicador se mide',
  successCriterion: 'Cuál es la meta',
  evidenceMinimum: 'Cuántos datos hacen falta antes de concluir',
};

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(c.message ?? c.error ?? `error ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function leerPolitica(org: string): Promise<VistaPolitica> {
  return j<VistaPolitica>(await fetch('/api/backend/politica', { cache: 'no-store', headers: cabecerasOrg(org) }));
}

export interface DocumentoPolitica {
  objetivoText?: string | null;
  businessContext?: string | null;
  evaluationHorizonDays?: number | null;
  eventos?: Array<{ eventKey: string; rol?: RolMetrica; orden?: number; displayName?: string | null }>;
  eventosEliminados?: string[];
  kpis?: Array<{
    id?: string; clave: string; displayName?: string; rol?: RolMetrica; tipo?: string; unidad?: string;
    direccion?: string; eventKey?: string | null; targetValue?: number | null; baselineValue?: number | null; tolerance?: number | null;
    /** Sin meta, el servidor lo guarda como `TO_BE_LEARNED`: se declara qué falta en vez de firmar un número. */
    estado?: string; procedencia?: string; nota?: string | null;
  }>;
  kpisEliminados?: string[];
  reglas?: Array<{
    id?: string; tipo: string; metrica: string; comparador?: string; valor?: number | null; estado?: string;
    /** `SYSTEM_DEFAULT` cuando el número lo pone SOEC; `USER_DEFINED` cuando lo escribe una persona. */
    procedencia?: string; nota?: string | null;
  }>;
  reglasEliminadas?: string[];
  limites?: {
    maxDailyBudgetClp?: number | null; maxCpcClp?: number | null; maxVariationPct?: number | null;
    maxChangesPerDay?: number | null; cooldownHours?: number | null; minTermImpressionsForNegative?: number | null;
    irrelevancePatterns?: string[];
  };
  prioridadesDeOferta?: Array<{ slug: string; priority: number }>;
  restriccionesNuevas?: Array<{ texto: string; tipo?: string }>;
  restriccionesRetiradas?: string[];
}

export async function guardarPolitica(org: string, doc: DocumentoPolitica): Promise<VistaPolitica> {
  return j<VistaPolitica>(
    await fetch('/api/backend/politica', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...cabecerasOrg(org) },
      body: JSON.stringify(doc),
    }),
  );
}

/** Campos del formulario de objetivos. Se usan para saber cuáles tocó la persona. */
export type CampoObjetivos =
  | 'objetivo' | 'contexto' | 'accion' | 'accionLibre' | 'indicador'
  | 'conoceMeta' | 'meta' | 'horizonte' | 'modoEvidencia' | 'evidencia' | 'pausa';

/** Lo que la pantalla de objetivos tiene que saber para armar el documento que se guarda. */
export interface FormularioObjetivos {
  readonly objetivo: string;
  readonly contexto: string;
  readonly accion: string;
  readonly accionLibre: string;
  readonly indicador: string;
  /** `SI` ⇒ el negocio declara su meta. `TODAVIA_NO` ⇒ la aprende SOEC y NADIE inventa un número. */
  readonly conoceMeta: 'SI' | 'TODAVIA_NO' | '';
  readonly meta: string;
  readonly horizonte: string;
  /** `RECOMENDADA` usa el punto de partida del sistema; `PROPIA`, el número que escriba la persona. */
  readonly modoEvidencia: 'RECOMENDADA' | 'PROPIA';
  readonly evidencia: string;
  readonly pausa: string;
}

/**
 * Traduce el formulario al documento de política. Pura a propósito: aquí vive la regla de qué se guarda y con
 * qué procedencia, y eso se prueba sin navegador.
 *
 *  · SÓLO SE ENVÍA LO QUE LA PERSONA TOCÓ. El formulario se precarga con lo que SOEC ya sabe (el objetivo del
 *    perfil, un horizonte sugerido); enviarlo todo convertía esos valores mostrados en decisiones guardadas
 *    de la empresa, aunque nadie los hubiera mirado. Un campo intacto no se manda, y el servidor no lo toca.
 *  · Elegir el indicador YA vale: se envía aunque no haya meta, y el servidor lo guarda como `TO_BE_LEARNED`.
 *  · La evidencia recomendada se envía con `SYSTEM_DEFAULT` y su versión: es una sugerencia del sistema, no
 *    una decisión del negocio, y así queda escrito.
 */
export function documentoDeObjetivos(
  f: FormularioObjetivos,
  recomendacion: { metrica: string; valor: number; version: string } | null | undefined,
  tocados: ReadonlySet<CampoObjetivos>,
): DocumentoPolitica {
  const toco = (...campos: readonly CampoObjetivos[]): boolean => campos.some((c) => tocados.has(c));
  const eventKey = f.accion === 'OTRA' ? f.accionLibre.trim().toLowerCase().replace(/\s+/g, '_') : f.accion;
  const elegido = INDICADORES_FRECUENTES.find((i) => i.clave === f.indicador) ?? null;
  const doc: DocumentoPolitica = {
    ...(toco('objetivo') ? { objetivoText: f.objetivo.trim() || null } : {}),
    ...(toco('contexto') ? { businessContext: f.contexto.trim() || null } : {}),
    ...(toco('horizonte') ? { evaluationHorizonDays: f.horizonte.trim() === '' ? null : Number(f.horizonte) } : {}),
  };
  if (eventKey && toco('accion', 'accionLibre')) {
    doc.eventos = [{ eventKey, rol: 'PRIMARY', orden: 0, displayName: ACCIONES_FRECUENTES.find((a) => a.eventKey === eventKey)?.etiqueta ?? null }];
  }
  if (elegido !== null && toco('indicador', 'conoceMeta', 'meta')) {
    const conMeta = f.conoceMeta === 'SI' && f.meta.trim() !== '';
    doc.kpis = [{
      id: 'principal', clave: elegido.clave, displayName: elegido.etiqueta, rol: 'PRIMARY',
      tipo: elegido.tipo, unidad: elegido.unidad, direccion: elegido.direccion,
      eventKey: eventKey || null,
      targetValue: conMeta ? Number(f.meta.replace(',', '.')) : null,
      baselineValue: 0,
      tolerance: 0.2,
      ...(conMeta ? {} : { nota: 'el negocio todavía no conoce la meta; SOEC la aprenderá con los primeros datos' }),
    }];
  }
  const reglas: NonNullable<DocumentoPolitica['reglas']> = [];
  if (toco('modoEvidencia', 'evidencia') && f.modoEvidencia === 'RECOMENDADA' && recomendacion) {
    reglas.push({
      id: 'evidencia-impresiones', tipo: 'EVIDENCE_MINIMUM', metrica: recomendacion.metrica, comparador: 'GTE',
      valor: recomendacion.valor, procedencia: 'SYSTEM_DEFAULT',
      nota: `punto de partida del sistema (${recomendacion.version}); puedes cambiarlo cuando quieras`,
    });
  } else if (toco('modoEvidencia', 'evidencia') && f.modoEvidencia === 'PROPIA' && f.evidencia.trim() !== '') {
    reglas.push({
      id: 'evidencia-impresiones', tipo: 'EVIDENCE_MINIMUM', metrica: 'IMPRESSIONS', comparador: 'GTE',
      valor: Number(f.evidencia), procedencia: 'USER_DEFINED',
    });
  }
  if (toco('pausa') && f.pausa.trim() !== '') {
    reglas.push({ id: 'pausa-tasa-conversion', tipo: 'PAUSE', metrica: 'CONVERSION_RATE', comparador: 'LTE', valor: Number(f.pausa.replace(',', '.')) });
  }
  if (reglas.length > 0) doc.reglas = reglas;
  return doc;
}
