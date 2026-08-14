/**
 * apps/api · PLATAFORMA MULTIEMPRESA · Tipos del registro de negocios.
 *
 * Abstracción genérica, sin ninguna empresa dentro:
 *
 *   organization → business → profile → sources → objectives → policies → external accounts → director context
 *
 * SmileFlow deja de ser el centro conceptual: pasa a ser UNA configuración registrada
 * (`plataforma/negocios/org-smileflow.ts`). Cualquier organización futura se incorpora añadiendo
 * su propia configuración, sin tocar el núcleo ni esta abstracción.
 *
 * PROHIBIDO en este módulo: valores de secretos. Sólo REFERENCIAS opacas (`credentialRef`).
 */
import type { CriterioObjetivo, PoliticaOptimizacion } from '@soec/medicion';
import type { LimitesAutonomia } from '../autonomia-ads/limites-smileflow';

/** Modelo de negocio: gobierna qué significa "convertir" y con qué vocabulario razona el Director. */
export type ModeloDeNegocio = 'SAAS_FUNNEL' | 'ECOMMERCE_DISTRIBUCION' | 'SERVICIOS';

/**
 * Estado de incorporación. Una organización recién creada NO es "operativa": lo dice explícitamente.
 * `CERO ≠ NO CONECTADO`: estos estados existen para poder decir la verdad en la UI.
 */
export type EstadoNegocio =
  'CREATED' | 'CONFIGURING' | 'SOURCES_PENDING' | 'OBSERVING' | 'EVALUABLE';

/** Experiencias REALES que exigen binding explícito organización↔experiencia. */
export type ExperienciaReal =
  'medicion-real' | 'director-real' | 'autonomia-ads' | 'piloto-decision';

/** Referencia a una cuenta externa. Nunca contiene el secreto: sólo su referencia opaca. */
export interface CuentaExternaRef {
  readonly proveedor: 'google-ads' | 'ga4' | 'merchant-center' | 'linkedin' | 'growth-api';
  /** Identificador de la cuenta EN el proveedor (customer_id, property_id, merchant_id…). */
  readonly externalAccountId: string | null;
  /** Cuenta administradora/login, si el proveedor la usa. */
  readonly loginAccountId: string | null;
  /** Referencia OPACA al secreto (`env:NOMBRE`, `vault:…`). JAMÁS el valor. */
  readonly credentialRef: string | null;
  readonly estado: 'CONNECTED_READ_ONLY' | 'NOT_CONNECTED' | 'PENDING';
}

/** Recurso concreto de Google Ads que una organización gobierna (campaña observada). */
export interface RecursoGoogleAds {
  readonly customerId: string;
  readonly loginCustomerId: string;
  readonly campaignId: string;
  /** Referencia interna de SOEC a la campaña (no la del proveedor). */
  readonly campaniaRef: string;
  readonly actividadId: string;
  readonly canal: string;
  readonly nombreCampania: string;
}

/** Contexto de negocio con el que razona el Director. No es un segundo motor: es su configuración. */
export interface DirectorContext {
  readonly descripcion: string;
  /** Evento/hecho que cuenta como conversión primaria para ESTA organización. */
  readonly conversionPrimaria: string;
  readonly conversionesSecundarias: readonly string[];
  readonly vocabulario: readonly string[];
}

/**
 * Perfil de evaluación de negocio: TODO lo que antes estaba cableado como constantes de SmileFlow
 * dentro del camino genérico (objetivo, criterio, política, límites, recursos externos).
 */
export interface BusinessEvaluationProfile {
  readonly organizationId: string;
  readonly modeloDeNegocio: ModeloDeNegocio;
  readonly objetivoId: string;
  readonly criterio: CriterioObjetivo;
  readonly policy: PoliticaOptimizacion;
  /** `null` = SOEC observa el gasto pero NO es la autoridad del presupuesto. */
  readonly gastoAutorizado: number | null;
  readonly limitesAutonomia: LimitesAutonomia;
  readonly externalResourceRefs: { readonly googleAds: RecursoGoogleAds | null };
  readonly cuentasExternas: readonly CuentaExternaRef[];
  readonly directorContext: DirectorContext;
}

export type TipoFuente =
  | 'WEBSITE'
  | 'ECOMMERCE'
  | 'ADS'
  | 'ANALYTICS'
  | 'MERCHANT'
  | 'SALES'
  | 'CATALOG'
  | 'CRM'
  | 'PAYMENTS'
  | 'SHIPPING'
  | 'GROWTH';

/**
 * Estado REAL de una fuente. `NOT_CONNECTED` y `PENDING` existen para poder decir la verdad:
 * una fuente sin conectar NO es una fuente con cero datos. `CERO ≠ NO CONECTADO`.
 */
export type EstadoFuente = 'CONNECTED_READ_ONLY' | 'NOT_CONNECTED' | 'PENDING' | 'NOT_APPLICABLE';

/** Una fuente de datos SIEMPRE pertenece a una organización. No existen fuentes globales. */
export interface FuenteRegistrada {
  readonly sourceId: string;
  readonly organizationId: string;
  readonly provider: string;
  readonly tipo: TipoFuente;
  readonly externalAccountId: string | null;
  readonly credentialRef: string | null;
  readonly estado: EstadoFuente;
  readonly soloLectura: true;
  /** Qué falta para conectarla. Vacío sólo cuando ya está conectada o no aplica. */
  readonly faltantes: readonly string[];
}

/** Configuración de la experiencia legacy "decisión del primer piloto" para una organización. */
export interface ConfiguracionDecisionPiloto {
  /** Identificador del negocio DENTRO del dominio `@soec/piloto`. No es una clave de tenant. */
  readonly businessKey: string;
  readonly expedienteId: string;
  readonly nombreComercial: string;
}

/** Entrada del registro de negocios. Sin secretos: sólo identidad y configuración no sensible. */
export interface NegocioRegistrado {
  readonly organizationId: string;
  readonly businessKey: string;
  readonly legalName: string;
  readonly displayName: string;
  /** Identificación tributaria. `null` mientras el propietario no la aporte: JAMÁS se inventa. */
  readonly rut: string | null;
  readonly modeloDeNegocio: ModeloDeNegocio;
  readonly mercado: string;
  readonly estado: EstadoNegocio;
  /** Rubros/categorías DECLARADOS por el propietario. No es el catálogo: eso se descubre. */
  readonly categoriasDeclaradas: readonly string[];
  readonly legacyAliases: readonly string[];
  readonly experienciasHabilitadas: readonly ExperienciaReal[];
  readonly decisionPiloto: ConfiguracionDecisionPiloto | null;
  /** Datos que SOEC no puede deducir y debe aportar una persona. Visibles en la UI. */
  readonly datosHumanosPendientes: readonly string[];
}

/** Configuración completa de una organización dentro de la plataforma. */
export interface ConfiguracionOrganizacion {
  readonly negocio: NegocioRegistrado;
  readonly perfil: BusinessEvaluationProfile | null;
  readonly fuentes: readonly FuenteRegistrada[];
}
