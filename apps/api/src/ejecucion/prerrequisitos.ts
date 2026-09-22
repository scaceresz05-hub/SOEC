/**
 * apps/api · EJECUCIÓN DE CAMPAÑAS · motor de requisitos (función pura).
 *
 * Doce comprobaciones, cada una con su veredicto y su motivo en lenguaje de negocio. Se ejecutan TODAS y se
 * devuelven TODAS: quien tiene que desbloquear la ejecución merece la lista completa, no un error por intento.
 *
 * DOS REGLAS QUE ESTE ARCHIVO SOSTIENE:
 *
 *  1. SI UN REQUISITO OBLIGATORIO FALLA, NO SE INTENTA CREAR NADA. Ni siquiera una parte. Una campaña a medias
 *     en la cuenta de un cliente es peor que ninguna campaña: hay que entrar a limpiarla a mano.
 *  2. `ACTION_REQUIRED` ≠ `BLOCKED`. Lo primero lo resuelve la persona desde SOEC (escribir anuncios, firmar el
 *     presupuesto). Lo segundo es una puerta de gobierno que no se abre desde una pantalla de marketing.
 */
import type { GobiernoNegocio, PerfilNegocio } from '../negocio/negocio-pg';
import type { Mandato } from '../accion/mandato';
import { restanteMinor } from '../accion/mandato';
import type { PlanCampania } from '../investigacion/plan-pg';
import type { CorridaInvestigacion } from '../investigacion/investigacion-pg';
import type { ResultadoClaims } from './claims';
import {
  MEDICION_SUFICIENTE,
  PRERREQUISITOS,
  type EstadoMedicion,
  type Prerrequisito,
  type ResultadoPrerrequisito,
  type VeredictoPrerrequisito,
} from './ejecucion-tipos';

export interface EntradaPrerrequisitos {
  readonly perfil: PerfilNegocio;
  readonly gobierno: GobiernoNegocio;
  readonly plan: PlanCampania | null;
  readonly corrida: CorridaInvestigacion | null;
  /** Conexión de Google Ads del negocio: estado y cuenta declarada. */
  readonly conexion: { readonly estado: string; readonly customerId: string | null } | null;
  readonly capacidadEscritura: boolean;
  readonly modoOperativo: string | null;
  readonly killSwitchAbierto: boolean;
  readonly mandato: Mandato | null;
  /** Estado de medición por evento de conversión declarado. Vacío ⇒ no hay nada que medir. */
  readonly medicion: readonly { readonly eventKey: string; readonly estado: EstadoMedicion }[];
  /** Ofertas del plan que tienen material de anuncio APROBADO suficiente. */
  readonly ofertasConMaterial: readonly string[];
  /** Cuántos servicios activos declaró la empresa. Sin ninguno no hay nada que anunciar. */
  readonly ofertasActivas: number;
  /** Territorios de la investigación que la plataforma sí puede segmentar. */
  readonly geosEjecutables: number;
  readonly landingsListas: readonly string[];
  readonly claims: ResultadoClaims | null;
  readonly ahora: string;
}

const ok = (requisito: Prerrequisito, motivo: string, detalle?: Record<string, unknown>): ResultadoPrerrequisito =>
  ({ requisito, veredicto: 'PASS', motivo, ...(detalle ? { detalle } : {}) });
const falta = (requisito: Prerrequisito, motivo: string, detalle?: Record<string, unknown>): ResultadoPrerrequisito =>
  ({ requisito, veredicto: 'ACTION_REQUIRED', motivo, ...(detalle ? { detalle } : {}) });
const bloquea = (requisito: Prerrequisito, motivo: string, detalle?: Record<string, unknown>): ResultadoPrerrequisito =>
  ({ requisito, veredicto: 'BLOCKED', motivo, ...(detalle ? { detalle } : {}) });

/** Evalúa los doce requisitos. El orden de la lista es el del catálogo, para que la pantalla sea estable. */
export function evaluarPrerrequisitos(e: EntradaPrerrequisitos): readonly ResultadoPrerrequisito[] {
  const r = new Map<Prerrequisito, ResultadoPrerrequisito>();

  // 1. PLAN VIGENTE — un plan viejo describe un mercado que ya no es el de hoy.
  if (e.plan === null) {
    r.set('PLAN_CURRENT', falta('PLAN_CURRENT', 'todavía no hay un plan de campaña preparado'));
  } else if (e.plan.estado === 'STALE' || e.plan.estado === 'SUPERSEDED') {
    r.set('PLAN_CURRENT', falta('PLAN_CURRENT', `el plan quedó viejo: ${e.plan.motivoStale ?? 'hay una versión más reciente'}. Vuelve a prepararlo antes de crear la campaña.`));
  } else if (e.corrida !== null && e.corrida.estado === 'STALE') {
    r.set('PLAN_CURRENT', falta('PLAN_CURRENT', `la investigación en la que se apoya quedó vieja: ${e.corrida.motivoStale ?? 'cambiaron los datos del negocio'}`));
  } else if (e.corrida !== null && e.corrida.id !== e.plan.researchRunId) {
    r.set('PLAN_CURRENT', falta('PLAN_CURRENT', 'hay una investigación más reciente que este plan no tuvo en cuenta'));
  } else {
    r.set('PLAN_CURRENT', ok('PLAN_CURRENT', `plan versión ${e.plan.version}, vigente`, { planId: e.plan.id, version: e.plan.version }));
  }

  // 2. NEGOCIO CONFIGURADO — lo que importa es el CONTENIDO (objetivo y qué vende), no el estado del asistente.
  const faltaObjetivo = (e.perfil.primaryObjective ?? '').trim() === '';
  const faltaOferta = e.ofertasActivas === 0;
  r.set('BUSINESS_READY', !faltaObjetivo && !faltaOferta
    ? ok('BUSINESS_READY', 'la empresa tiene declarado qué vende y qué quiere conseguir')
    : falta('BUSINESS_READY', faltaOferta
      ? 'falta declarar qué vende la empresa'
      : 'falta declarar qué quiere conseguir la empresa'));

  // 3 y 4. CONEXIÓN Y CUENTA — son dos cosas distintas: puede haber conexión sin cuenta elegida.
  if (e.conexion === null || e.conexion.estado !== 'CONNECTED') {
    r.set('CONNECTION_VALID', falta('CONNECTION_VALID', 'conecta tu cuenta de Google Ads para que SOEC pueda crear la campaña'));
    r.set('ACCOUNT_SELECTED', falta('ACCOUNT_SELECTED', 'sin conexión no se puede saber en qué cuenta crearla'));
  } else {
    r.set('CONNECTION_VALID', ok('CONNECTION_VALID', 'tu cuenta de Google Ads está conectada'));
    r.set('ACCOUNT_SELECTED', (e.conexion.customerId ?? '') !== ''
      ? ok('ACCOUNT_SELECTED', `se creará en la cuenta ${e.conexion.customerId}`, { customerId: e.conexion.customerId })
      : falta('ACCOUNT_SELECTED', 'elige en qué cuenta de Google Ads debe crearse la campaña'));
  }

  // 5. TERRITORIO EJECUTABLE.
  r.set('GEO_EXECUTABLE', e.geosEjecutables > 0
    ? ok('GEO_EXECUTABLE', `${e.geosEjecutables} territorio(s) confirmados por la plataforma`)
    : falta('GEO_EXECUTABLE', 'ningún territorio de tu empresa se puede segmentar todavía: revisa la investigación'));

  // 6. LANDINGS.
  const ofertasDelPlan = e.plan?.ofertas ?? [];
  const sinLanding = ofertasDelPlan.filter((o) => !e.landingsListas.includes(o));
  r.set('LANDING_READY', ofertasDelPlan.length > 0 && sinLanding.length === 0
    ? ok('LANDING_READY', 'cada servicio del plan tiene su página de destino')
    : falta('LANDING_READY', sinLanding.length > 0
      ? `falta una página de destino utilizable para: ${sinLanding.join(', ')}`
      : 'el plan no tiene servicios con página de destino'));

  // 7. MEDICIÓN — una acción creada en Google NO es medición funcionando.
  if (e.medicion.length === 0) {
    r.set('CONVERSION_READY', falta('CONVERSION_READY', 'declara qué acción de un cliente cuenta como resultado y deja la medición instalada'));
  } else {
    const noVerificadas = e.medicion.filter((m) => !MEDICION_SUFICIENTE.includes(m.estado));
    r.set('CONVERSION_READY', noVerificadas.length === 0
      ? ok('CONVERSION_READY', 'la medición está instalada y verificada')
      : falta('CONVERSION_READY', `la medición todavía no está verificada: ${noVerificadas.map((m) => `${m.eventKey} (${etiquetaMedicion(m.estado)})`).join(', ')}`));
  }

  // 8. ANUNCIOS — declarados y aprobados por una persona; y sin conflicto con lo que la empresa no puede decir.
  const sinMaterial = ofertasDelPlan.filter((o) => !e.ofertasConMaterial.includes(o));
  if (ofertasDelPlan.length === 0 || sinMaterial.length > 0) {
    r.set('CREATIVE_READY', falta('CREATIVE_READY', ofertasDelPlan.length === 0
      ? 'no hay servicios que anunciar en el plan'
      : `faltan anuncios aprobados para: ${sinMaterial.join(', ')}`));
  } else if (e.claims !== null && !e.claims.ok) {
    r.set('CREATIVE_READY', bloquea('CREATIVE_READY',
      `hay ${e.claims.conflictos.length} texto(s) que dicen algo que tu empresa declaró que no puede afirmar`,
      { conflictos: e.claims.conflictos.length }));
  } else {
    r.set('CREATIVE_READY', ok('CREATIVE_READY', 'los anuncios están escritos, aprobados y no contradicen tus restricciones'));
  }

  // 9. MANDATO FINANCIERO — la soberanía del dinero es humana, siempre.
  r.set('FINANCIAL_MANDATE_VALID', evaluarMandato(e.mandato, e.ahora));

  // 10. PERMISO DE ESCRITURA — conectar no es autorizar a crear, y son DOS decisiones: el permiso técnico
  //     sobre la cuenta y la postura de gobierno de la empresa.
  r.set('WRITE_CAPABILITY_ENABLED', !e.capacidadEscritura
    ? falta('WRITE_CAPABILITY_ENABLED', 'activa el permiso «crear campañas» en Conexiones: conectar la cuenta no basta')
    : !e.gobierno.campaignExecution
      ? falta('WRITE_CAPABILITY_ENABLED', 'tu empresa todavía no autoriza a SOEC a crear campañas: actívalo en la postura de gobierno')
      : ok('WRITE_CAPABILITY_ENABLED', 'has autorizado a SOEC a crear campañas en tu cuenta'));

  // 11. MODO OPERATIVO — esta fase sólo ejecuta supervisada.
  r.set('OPERATING_MODE_ALLOWED', evaluarModo(e.modoOperativo, e.gobierno));

  // 12. INTERRUPTOR DE SEGURIDAD del despliegue.
  r.set('KILL_SWITCH_ALLOWED', e.killSwitchAbierto
    ? ok('KILL_SWITCH_ALLOWED', 'el despliegue permite operaciones externas')
    : bloquea('KILL_SWITCH_ALLOWED', 'las operaciones externas están apagadas en este despliegue'));

  return PRERREQUISITOS.map((p) => r.get(p) ?? bloquea(p, 'no evaluado'));
}

function evaluarMandato(m: Mandato | null, ahora: string): ResultadoPrerrequisito {
  if (m === null) return falta('FINANCIAL_MANDATE_VALID', 'falta una autorización de presupuesto firmada por una persona');
  if (m.killSwitch) return bloquea('FINANCIAL_MANDATE_VALID', 'la autorización de presupuesto está detenida por su interruptor de emergencia');
  if (m.status === 'REVOKED' || m.status === 'EXPIRED' || m.status === 'EXHAUSTED') {
    return falta('FINANCIAL_MANDATE_VALID', `la autorización de presupuesto ya no sirve (${m.status.toLowerCase()}): hace falta una nueva`);
  }
  if (Date.parse(m.periodEnd) <= Date.parse(ahora)) {
    return falta('FINANCIAL_MANDATE_VALID', 'la autorización de presupuesto venció: hace falta una nueva');
  }
  if (m.status !== 'AUTHORIZED' && m.status !== 'ACTIVE') {
    return falta('FINANCIAL_MANDATE_VALID', 'la autorización de presupuesto todavía no está firmada');
  }
  if (restanteMinor(m) <= 0) {
    return falta('FINANCIAL_MANDATE_VALID', 'la autorización de presupuesto está agotada');
  }
  return ok('FINANCIAL_MANDATE_VALID', `hay ${m.authorizedBudgetMinor} ${m.currency} autorizados por ${m.authorizedBy}`, { mandatoId: m.id });
}

function evaluarModo(modo: string | null, gobierno: GobiernoNegocio): ResultadoPrerrequisito {
  if (!gobierno.externalMutations) {
    return bloquea('OPERATING_MODE_ALLOWED', 'tu empresa tiene desactivadas las operaciones en plataformas externas');
  }
  if (modo === 'SUPERVISED_REAL') {
    return ok('OPERATING_MODE_ALLOWED', 'modo supervisado: SOEC ejecuta lo que una persona aprueba');
  }
  if (modo === 'AUTONOMOUS_REAL') {
    // Existe el modo, pero esta fase NO lo usa para crear sin confirmación humana.
    return bloquea('OPERATING_MODE_ALLOWED', 'el modo autónomo todavía no crea campañas: primero se prueba el camino supervisado');
  }
  return falta('OPERATING_MODE_ALLOWED', 'tu empresa está en modo observación: cámbialo a supervisado para poder crear campañas');
}

const ETIQUETA_MEDICION: Readonly<Record<EstadoMedicion, string>> = {
  ACTION_MISSING: 'falta crearla en Google',
  ACTION_CREATED: 'creada, sin medición instalada',
  TRACKING_MISSING: 'falta instalar la medición en tu sitio',
  TRACKING_INSTALLED: 'instalada, sin verificar',
  VERIFIED: 'verificada',
  DEGRADED: 'dejó de registrar',
};
export const etiquetaMedicion = (e: EstadoMedicion): string => ETIQUETA_MEDICION[e] ?? e;

/** ¿Se puede ejecutar? Sólo si NINGÚN requisito está bloqueado o pendiente de acción. */
export function puedeEjecutar(rs: readonly ResultadoPrerrequisito[]): boolean {
  return rs.every((r) => r.veredicto === 'PASS' || r.veredicto === 'NOT_APPLICABLE');
}

export function bloqueantes(rs: readonly ResultadoPrerrequisito[]): readonly ResultadoPrerrequisito[] {
  return rs.filter((r) => r.veredicto === 'BLOCKED' || r.veredicto === 'ACTION_REQUIRED');
}

/** Resumen de un veredicto para la interfaz. */
export const COLOR_VEREDICTO: Readonly<Record<VeredictoPrerrequisito, 'ok' | 'warn' | 'error' | 'mut'>> = {
  PASS: 'ok', ACTION_REQUIRED: 'warn', BLOCKED: 'error', NOT_APPLICABLE: 'mut',
};
