/**
 * apps/api · ONBOARDING INTELIGENTE · READINESS ENGINE.
 *
 * Responde «¿está esta empresa preparada?» sin un único porcentaje que no significa nada. Dos ideas:
 *
 *  1. POR DOMINIOS. Perfil, oferta, territorio, objetivo, conversiones, restricciones, evaluación, conexiones,
 *     techo de inversión y gobierno se evalúan por separado, cada uno con sus motivos. Un negocio puede tener
 *     el perfil perfecto y ninguna conexión: decir «60 % completo» ocultaría exactamente lo que falta.
 *  2. VARIAS PREPARACIONES DISTINTAS. Estar listo para que SOEC te entienda no es estar listo para gastar
 *     dinero. Cinco niveles independientes, y que uno sea NO mientras otro es SÍ es una respuesta correcta.
 *
 * FUNCIÓN PURA: recibe lo persistido y devuelve el read model. No escribe, no pregunta y no decide nada.
 */
import type { GobiernoNegocio, OfertaNegocio, PerfilNegocio, RestriccionNegocio, TerritorioNegocio } from '../negocio/negocio-pg';
import type { CapacidadPersistida, Conexion } from '../conexion/conexion-pg';
import type { PoliticaCompleta } from '../politica/politica-pg';
import type { CompletitudPerfil } from '../politica/politica-tipos';
import type { IntencionPresupuesto } from './onboarding-pg';
import { monedaValida } from '../dinero';

export type DominioReadiness =
  | 'BUSINESS_PROFILE'
  | 'OFFER'
  | 'GEOGRAPHY'
  | 'OBJECTIVE'
  | 'CONVERSIONS'
  | 'RESTRICTIONS'
  | 'EVALUATION'
  | 'CONNECTIONS'
  | 'FINANCIAL_MANDATE'
  | 'GOVERNANCE';

export const DOMINIOS: readonly DominioReadiness[] = [
  'BUSINESS_PROFILE', 'OFFER', 'GEOGRAPHY', 'OBJECTIVE', 'CONVERSIONS',
  'RESTRICTIONS', 'EVALUATION', 'CONNECTIONS', 'FINANCIAL_MANDATE', 'GOVERNANCE',
];

/**
 * `OPTIONAL` = no hace falta para operar y nadie lo ha tocado. `ACTION_REQUIRED` = no lo resuelve una
 * respuesta, lo resuelve un ACTO del usuario fuera del formulario (conectar una cuenta, autorizar dinero).
 */
export type EstadoDominio = 'COMPLETE' | 'INCOMPLETE' | 'OPTIONAL' | 'ACTION_REQUIRED';

export interface MotivoReadiness {
  readonly campo: string;
  readonly motivo: string;
  readonly comoSeResuelve: string;
}

export interface DominioEvaluado {
  readonly dominio: DominioReadiness;
  readonly estado: EstadoDominio;
  readonly motivos: readonly MotivoReadiness[];
}

export type NivelPreparacion =
  | 'BUSINESS_READY'
  | 'MEASUREMENT_READY'
  | 'CAMPAIGN_PLANNING_READY'
  | 'CAMPAIGN_EXECUTION_READY'
  | 'AUTONOMY_READY';

export const NIVELES: readonly NivelPreparacion[] = [
  'BUSINESS_READY', 'MEASUREMENT_READY', 'CAMPAIGN_PLANNING_READY', 'CAMPAIGN_EXECUTION_READY', 'AUTONOMY_READY',
];

export interface NivelEvaluado {
  readonly nivel: NivelPreparacion;
  readonly listo: boolean;
  /** Qué falta, en lenguaje de negocio. Vacío cuando el nivel está listo. */
  readonly bloqueos: readonly string[];
}

export type ResumenReadiness = 'LISTO' | 'FALTA_INFORMACION' | 'REQUIERE_TU_ACCION';

export interface BusinessReadiness {
  readonly organizationId: string;
  readonly dominios: readonly DominioEvaluado[];
  readonly niveles: readonly NivelEvaluado[];
  readonly resumen: ResumenReadiness;
}

export interface DatosDeReadiness {
  readonly perfil: PerfilNegocio;
  readonly oferta: readonly OfertaNegocio[];
  readonly territorios: readonly TerritorioNegocio[];
  readonly restricciones: readonly RestriccionNegocio[];
  readonly politica: PoliticaCompleta;
  readonly completitudPolitica: CompletitudPerfil;
  readonly conexiones: readonly Conexion[];
  readonly capacidades: readonly CapacidadPersistida[];
  readonly gobierno: GobiernoNegocio | null;
  readonly presupuesto: IntencionPresupuesto | null;
  /** Modo operativo vigente (identidad). `PILOT` es el nombre almacenado de OBSERVE. */
  readonly modoOperativo: string;
  /** `true` cuando el usuario ya respondió las preguntas de límites (aunque haya dicho «no hay»). */
  readonly restriccionesRevisadas: boolean;
  /**
   * ¿Hay una autorización de presupuesto HUMANA vigente (Safe Action Plane)? Ningún formulario la produce: la
   * firma una persona en un acto aparte. Se recibe como hecho para no tener que afirmar que falta cuando existe.
   */
  readonly mandatoVigente?: boolean;
}

const motivo = (campo: string, m: string, c: string): MotivoReadiness => ({ campo, motivo: m, comoSeResuelve: c });

function perfilDominio(d: DatosDeReadiness): DominioEvaluado {
  const motivos: MotivoReadiness[] = [];
  const p = d.perfil;
  if ((p.description ?? '').trim() === '') motivos.push(motivo('description', 'no sabemos a qué se dedica la empresa', 'contar en una frase a qué se dedica'));
  if ((p.displayName ?? '').trim() === '') motivos.push(motivo('displayName', 'falta el nombre comercial', 'escribir el nombre con el que te conocen'));
  if ((p.country ?? '').trim() === '' || (p.currency ?? '').trim() === '' || (p.timezone ?? '').trim() === '') {
    motivos.push(motivo('mercado', 'falta el país, la moneda o la zona horaria', 'confirmar dónde opera la empresa'));
  }
  return { dominio: 'BUSINESS_PROFILE', estado: motivos.length === 0 ? 'COMPLETE' : 'INCOMPLETE', motivos };
}

function ofertaDominio(d: DatosDeReadiness): DominioEvaluado {
  const activas = d.oferta.filter((o) => o.status === 'ACTIVE');
  if (activas.length === 0) {
    return {
      dominio: 'OFFER',
      estado: 'INCOMPLETE',
      motivos: [motivo('oferta', 'no sabemos qué vendes o qué servicios prestas', 'escribir tus productos o servicios como los nombras tú')],
    };
  }
  const motivos: MotivoReadiness[] = [];
  if (activas.length > 1 && activas.every((o) => o.priority === 100)) {
    motivos.push(motivo('prioridades', 'no se declaró qué quieres potenciar primero', 'marcar los servicios prioritarios (opcional)'));
  }
  return { dominio: 'OFFER', estado: 'COMPLETE', motivos };
}

function geografiaDominio(d: DatosDeReadiness): DominioEvaluado {
  const comercial = d.territorios.find((t) => t.ambito === 'BUSINESS');
  if (comercial === undefined || comercial.localities.length === 0) {
    // Un SaaS puede vender sin comunas: le basta el país declarado en el perfil.
    if (d.perfil.businessType === 'SAAS' && (d.perfil.country ?? '').trim() !== '') {
      return { dominio: 'GEOGRAPHY', estado: 'COMPLETE', motivos: [] };
    }
    return {
      dominio: 'GEOGRAPHY',
      estado: 'INCOMPLETE',
      motivos: [motivo('territorio', 'no sabemos dónde atiendes o vendes', 'indicar las comunas o ciudades donde atiendes')],
    };
  }
  const motivos: MotivoReadiness[] = [];
  const ejecutable = d.territorios.find((t) => t.ambito === 'ADVERTISING');
  if (ejecutable === undefined) {
    // El territorio EJECUTABLE en una plataforma se resuelve al planificar; aquí sólo se avisa.
    motivos.push(motivo('territorioEjecutable', 'aún no se ha comprobado qué parte de tu territorio es segmentable en publicidad', 'se resuelve al preparar la primera campaña'));
  }
  return { dominio: 'GEOGRAPHY', estado: 'COMPLETE', motivos };
}

function objetivoDominio(d: DatosDeReadiness): DominioEvaluado {
  const texto = (d.politica.politica?.objectiveText ?? d.perfil.primaryObjective ?? '').trim();
  return texto === ''
    ? { dominio: 'OBJECTIVE', estado: 'INCOMPLETE', motivos: [motivo('objetivo', 'no sabemos qué quieres conseguir', 'elegir el objetivo del negocio')] }
    : { dominio: 'OBJECTIVE', estado: 'COMPLETE', motivos: [] };
}

function conversionesDominio(d: DatosDeReadiness): DominioEvaluado {
  const principal = d.politica.eventos.find((e) => e.rol === 'PRIMARY');
  return principal === undefined
    ? {
        dominio: 'CONVERSIONS',
        estado: 'INCOMPLETE',
        motivos: [motivo('conversionPrincipal', 'no sabemos qué hace una persona interesada en tu negocio', 'elegir la acción más importante (llamar, escribir, agendar, comprar…)')],
      }
    : { dominio: 'CONVERSIONS', estado: 'COMPLETE', motivos: [] };
}

function restriccionesDominio(d: DatosDeReadiness): DominioEvaluado {
  if (d.restricciones.length > 0) return { dominio: 'RESTRICTIONS', estado: 'COMPLETE', motivos: [] };
  if (d.restriccionesRevisadas) {
    // Responder «no hay nada» es una respuesta válida y deja el dominio resuelto.
    return { dominio: 'RESTRICTIONS', estado: 'COMPLETE', motivos: [] };
  }
  return {
    dominio: 'RESTRICTIONS',
    estado: 'OPTIONAL',
    motivos: [motivo('restricciones', 'no se han revisado los límites de lo que se puede afirmar', 'revisar si hay algo que la publicidad nunca deba decir')],
  };
}

function evaluacionDominio(d: DatosDeReadiness): DominioEvaluado {
  const c = d.completitudPolitica;
  if (c.estado === 'EVALUATION_PROFILE_COMPLETE') return { dominio: 'EVALUATION', estado: 'COMPLETE', motivos: [] };
  const porAprender = d.politica.kpis.some((k) => k.rol === 'PRIMARY' && k.procedencia === 'TO_BE_LEARNED');
  const motivos = c.faltantes.map((f) =>
    (f.campo === 'successCriterion' || f.campo === 'primaryKpi') && porAprender
      // El indicador SÍ se eligió; lo que falta es su meta. Decir «no hay indicador» sería falso.
      ? motivo(f.campo, 'la meta todavía no se conoce: se aprenderá observando los primeros datos', 'cuando haya datos, SOEC propondrá una meta para que la confirmes')
      : motivo(f.campo, f.motivo, f.comoSeResuelve),
  );
  return { dominio: 'EVALUATION', estado: 'INCOMPLETE', motivos };
}

function conexionesDominio(d: DatosDeReadiness): DominioEvaluado {
  const conectadas = d.conexiones.filter((c) => c.estado === 'CONNECTED');
  if (conectadas.length > 0) return { dominio: 'CONNECTIONS', estado: 'COMPLETE', motivos: [] };
  const pendientes = d.conexiones.filter((c) => c.estado !== 'CONNECTED' && c.estado !== 'DISABLED');
  if (pendientes.length > 0) {
    return {
      dominio: 'CONNECTIONS',
      estado: 'ACTION_REQUIRED',
      motivos: pendientes.map((c) =>
        motivo(c.provider, `la conexión de ${c.provider === 'GOOGLE_ADS' ? 'Google' : c.provider === 'META_ADS' ? 'Meta' : 'tu sistema'} quedó a medias`, 'terminar de conectarla desde Conexiones y permisos'),
      ),
    };
  }
  return {
    dominio: 'CONNECTIONS',
    estado: 'ACTION_REQUIRED',
    motivos: [motivo('conexiones', 'todavía no hay ninguna fuente de datos conectada', 'conectar Google, Meta o los datos de tu sitio')],
  };
}

function presupuestoDominio(d: DatosDeReadiness): DominioEvaluado {
  if (d.presupuesto === null) {
    return {
      dominio: 'FINANCIAL_MANDATE',
      estado: 'INCOMPLETE',
      motivos: [motivo('techo', 'no se ha declarado cuánto como máximo estarías dispuesto a invertir', 'elegir un máximo, o decir que todavía no quieres invertir')],
    };
  }
  if (d.presupuesto.modalidad === 'NONE' || d.presupuesto.modalidad === 'LATER') {
    // «Todavía no quiero invertir» es una respuesta COMPLETA: no hay importe ni moneda que declarar.
    return {
      dominio: 'FINANCIAL_MANDATE',
      estado: 'COMPLETE',
      motivos: [motivo('techo', 'por ahora no hay inversión declarada: SOEC observará sin gastar', 'cuando quieras invertir, fija un máximo')],
    };
  }
  // Elegir «un máximo por día/mes» y no poner la cifra deja el formulario a medias, no un techo declarado.
  if (d.presupuesto.montoMinor === null || d.presupuesto.montoMinor <= 0) {
    return {
      dominio: 'FINANCIAL_MANDATE',
      estado: 'INCOMPLETE',
      motivos: [motivo('techo', 'elegiste un máximo pero falta la cifra', 'escribir cuánto como máximo estarías dispuesto a invertir')],
    };
  }
  // Y un número sin moneda no es dinero: se dice, no se supone.
  if (!monedaValida(d.presupuesto.moneda)) {
    return {
      dominio: 'FINANCIAL_MANDATE',
      estado: 'INCOMPLETE',
      motivos: [motivo('moneda', 'no sabemos en qué moneda está ese máximo', 'confirmar la moneda de tu negocio en los datos de la empresa')],
    };
  }
  return { dominio: 'FINANCIAL_MANDATE', estado: 'COMPLETE', motivos: [] };
}

function gobiernoDominio(d: DatosDeReadiness): DominioEvaluado {
  const g = d.gobierno;
  const motivos: MotivoReadiness[] = [];
  if (g === null) {
    return { dominio: 'GOVERNANCE', estado: 'INCOMPLETE', motivos: [motivo('gobierno', 'falta la postura de gobierno del negocio', 'se crea al dar de alta la empresa')] };
  }
  if (!g.campaignExecution) {
    motivos.push(motivo('campaignExecution', 'SOEC no tiene permiso para ejecutar campañas', 'se habilita aparte, cuando decidas empezar a invertir'));
  }
  if (!g.externalMutations) {
    motivos.push(motivo('externalMutations', 'SOEC no puede modificar nada en tus cuentas', 'es la postura recomendada al empezar'));
  }
  // El gobierno está RESUELTO cuando existe y es explícito: lo que falte para ejecutar se dice en los niveles.
  return { dominio: 'GOVERNANCE', estado: 'COMPLETE', motivos };
}

/** Evalúa los diez dominios. Orden estable para que la interfaz y las pruebas vean siempre lo mismo. */
export function evaluarDominios(d: DatosDeReadiness): readonly DominioEvaluado[] {
  return [
    perfilDominio(d), ofertaDominio(d), geografiaDominio(d), objetivoDominio(d), conversionesDominio(d),
    restriccionesDominio(d), evaluacionDominio(d), conexionesDominio(d), presupuestoDominio(d), gobiernoDominio(d),
  ];
}

const completo = (ds: readonly DominioEvaluado[], dominio: DominioReadiness): boolean =>
  ds.find((x) => x.dominio === dominio)?.estado === 'COMPLETE';

/**
 * Los cinco niveles. Cada uno añade exigencias al anterior, y el salto a EJECUCIÓN exige cosas que NINGÚN
 * formulario puede dar: permiso de gobierno y una autorización financiera humana.
 */
export function evaluarNiveles(d: DatosDeReadiness, dominios: readonly DominioEvaluado[]): readonly NivelEvaluado[] {
  const bloq = (cond: boolean, texto: string): readonly string[] => (cond ? [] : [texto]);

  const negocio = [
    ...bloq(completo(dominios, 'BUSINESS_PROFILE'), 'falta saber a qué se dedica la empresa'),
    ...bloq(completo(dominios, 'OFFER'), 'falta saber qué vende o qué servicios presta'),
    ...bloq(completo(dominios, 'GEOGRAPHY'), 'falta saber dónde atiende'),
    ...bloq(completo(dominios, 'OBJECTIVE'), 'falta saber qué quiere conseguir'),
  ];
  const businessReady = negocio.length === 0;

  const capacidades = new Set(d.capacidades.filter((c) => c.habilitada).map((c) => c.capacidad));
  const medicion = [
    ...bloq(businessReady, 'primero hay que completar los datos del negocio'),
    ...bloq(completo(dominios, 'CONVERSIONS'), 'falta saber qué hace un cliente interesado'),
    ...bloq(completo(dominios, 'CONNECTIONS'), 'falta conectar al menos una fuente de datos'),
    ...bloq(capacidades.has('MEDICION_REAL') || capacidades.has('INGESTA_GROWTH'), 'falta habilitar la lectura de datos reales'),
  ];
  const measurementReady = medicion.length === 0;

  const planificacion = [
    ...bloq(measurementReady, 'primero hay que poder medir'),
    ...bloq(completo(dominios, 'EVALUATION'), 'falta definir con qué indicador y qué meta se evalúa'),
    ...bloq(completo(dominios, 'RESTRICTIONS'), 'falta revisar los límites de lo que se puede afirmar'),
  ];
  const planningReady = planificacion.length === 0;

  const hayConexionDeAnuncios = d.conexiones.some((c) => (c.provider === 'GOOGLE_ADS' || c.provider === 'META_ADS') && c.estado === 'CONNECTED');
  // TECHO REAL: modalidad de inversión + cifra positiva + moneda. Sin los tres, no hay máximo que respetar.
  const hayTecho = d.presupuesto !== null
    && (d.presupuesto.modalidad === 'DAILY' || d.presupuesto.modalidad === 'MONTHLY')
    && d.presupuesto.montoMinor !== null && d.presupuesto.montoMinor > 0
    && monedaValida(d.presupuesto.moneda);
  const ejecucion = [
    ...bloq(planningReady, 'primero hay que poder planificar'),
    ...bloq(hayConexionDeAnuncios, 'falta conectar la cuenta de publicidad'),
    ...bloq(hayTecho, 'falta declarar un máximo de inversión'),
    ...bloq(d.gobierno?.campaignExecution === true, 'falta habilitar la ejecución de campañas (decisión de gobierno)'),
    ...bloq(d.modoOperativo === 'SUPERVISED_REAL' || d.modoOperativo === 'AUTONOMOUS_REAL', 'el modo actual es solo observar'),
    // La autorización financiera NO la produce el onboarding: la crea una persona en un acto aparte.
    ...bloq(d.mandatoVigente === true, 'falta una autorización de presupuesto firmada por una persona'),
  ];
  const executionReady = ejecucion.length === 0;

  const autonomia = [
    ...bloq(executionReady, 'primero hay que poder ejecutar campañas'),
    ...bloq(d.gobierno?.autonomousSpend === true, 'falta habilitar el gasto autónomo (decisión de gobierno)'),
    ...bloq(d.modoOperativo === 'AUTONOMOUS_REAL', 'el modo automático todavía no está disponible en esta versión'),
  ];

  return [
    { nivel: 'BUSINESS_READY', listo: businessReady, bloqueos: negocio },
    { nivel: 'MEASUREMENT_READY', listo: measurementReady, bloqueos: medicion },
    { nivel: 'CAMPAIGN_PLANNING_READY', listo: planningReady, bloqueos: planificacion },
    { nivel: 'CAMPAIGN_EXECUTION_READY', listo: executionReady, bloqueos: ejecucion },
    { nivel: 'AUTONOMY_READY', listo: autonomia.length === 0, bloqueos: autonomia },
  ];
}

export function evaluarReadiness(d: DatosDeReadiness): BusinessReadiness {
  const dominios = evaluarDominios(d);
  const niveles = evaluarNiveles(d, dominios);
  const resumen: ResumenReadiness = dominios.some((x) => x.estado === 'ACTION_REQUIRED')
    ? 'REQUIERE_TU_ACCION'
    : dominios.some((x) => x.estado === 'INCOMPLETE')
      ? 'FALTA_INFORMACION'
      : 'LISTO';
  return { organizationId: d.perfil.organizationId, dominios, niveles, resumen };
}
