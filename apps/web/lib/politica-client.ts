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
    actualizadoEn: string | null;
  };
  referencias: {
    oferta: { id: string; slug: string; name: string; priority: number; advertisingEligibility: string }[];
    territorios: { id: string; ambito: string; country: string; region: string | null; province: string | null; localities: string[] }[];
    restricciones: { id: string; tipo: string; texto: string }[];
  };
  perfilEvaluableDisponible: boolean;
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
  }>;
  kpisEliminados?: string[];
  reglas?: Array<{ id?: string; tipo: string; metrica: string; comparador?: string; valor?: number | null; estado?: string }>;
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
