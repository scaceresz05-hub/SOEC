/**
 * apps/api · Servicio de lectura del Acquisition Engine — proyecciones tenant-scoped y honestas.
 *
 * Compone el dominio `@soec/adquisicion` con el registro real de negocios de la plataforma. NO abre
 * red, NO conecta Meta, NO fabrica ceros: un canal sin conexión reporta `NOT_CONFIGURED` (no `0`), y
 * las métricas sin denominador válido quedan `UNKNOWN`. El objetivo se deriva del `ModeloDeNegocio`
 * (config), no de `if org`. La organización llega ya resuelta por el contexto autenticado.
 */

import type { EventStore, RequestContext } from '@soec/contracts';
import {
  planificarAdquisicion,
  naturalezaDeCanal,
  CANALES_ADQUISICION,
  type CanalAdquisicion,
  type EstadoCanal,
  type ObjetivoComercial,
  type ResultadoAdquisicion,
} from '@soec/adquisicion';
import { buscarNegocio, buscarProfile, buscarFuentes } from '../plataforma';
import { buscarCuentaMeta, estadoCuentaMeta } from '../plataforma/meta-canal';
import { razonarAdquisicionShadow, type VeredictoDirectorAdquisicion } from '../adquisicion/director-multicanal';
import type { CuentaExternaRef, ModeloDeNegocio } from '../plataforma/tipos';
import { leerVentasCyp, normalizarVentas } from './cyp-outcomes';
import { leerGrowthSmileflow, leerSpendSmileflow } from './smileflow-outcomes';
import {
  derivarCPL,
  derivarCPQL,
  derivarCAC,
  derivarROAS,
  derivarMER,
  VENTANA_DESCONOCIDA,
  type IndicadorVivo,
  type Ventana,
} from './economics';

/** Objetivo comercial por modelo de negocio (config-driven, sin ramas por identidad de org). */
function objetivoDeModelo(modelo: ModeloDeNegocio): ObjetivoComercial {
  switch (modelo) {
    case 'ECOMMERCE_DISTRIBUCION':
      return 'GENERATE_SALES';
    case 'SAAS_FUNNEL':
      return 'GENERATE_LEADS';
    case 'SERVICIOS':
      return 'GENERATE_LEADS';
  }
}

/** Resultado comercial principal por modelo de negocio. */
function resultadosComercialesDeModelo(modelo: ModeloDeNegocio): readonly ResultadoAdquisicion[] {
  switch (modelo) {
    case 'ECOMMERCE_DISTRIBUCION':
      return ['PURCHASE', 'CUSTOMER'];
    case 'SAAS_FUNNEL':
      return ['LEAD', 'DEMO', 'CUSTOMER'];
    case 'SERVICIOS':
      return ['LEAD', 'CUSTOMER'];
  }
}

function cuentasExternasDe(org: string): readonly CuentaExternaRef[] {
  return buscarProfile(org)?.cuentasExternas ?? [];
}

function googleConectado(org: string): boolean {
  const perfil = buscarProfile(org);
  if (perfil?.externalResourceRefs.googleAds) return true;
  return cuentasExternasDe(org).some((c) => c.proveedor === 'google-ads' && c.estado === 'CONNECTED_READ_ONLY');
}

function websiteConectado(org: string): boolean {
  return buscarFuentes(org).some(
    (f) => (f.tipo === 'WEBSITE' || f.tipo === 'ECOMMERCE') && f.estado === 'CONNECTED_READ_ONLY',
  );
}

/** Estado honesto de un canal para una organización. «No conectado» nunca es «cero». */
export function estadoCanalDe(org: string, canal: CanalAdquisicion): EstadoCanal {
  switch (canal) {
    case 'GOOGLE_SEARCH':
      return googleConectado(org) ? 'CONNECTED_READ_ONLY' : 'NOT_CONFIGURED';
    case 'META_FACEBOOK':
    case 'META_INSTAGRAM': {
      const est = estadoCuentaMeta(buscarCuentaMeta(cuentasExternasDe(org)));
      return est === 'CONNECTED_READ_ONLY' ? 'CONNECTED_READ_ONLY' : est === 'CREDENTIALS_REQUIRED' ? 'CREDENTIALS_REQUIRED' : 'NOT_CONFIGURED';
    }
    case 'WEBSITE':
      return websiteConectado(org) ? 'CONNECTED_READ_ONLY' : 'NOT_CONFIGURED';
    case 'ORGANIC_FACEBOOK':
    case 'ORGANIC_INSTAGRAM':
    case 'EMAIL':
    case 'WHATSAPP':
      return 'NOT_CONFIGURED';
  }
}

export interface CanalVista {
  readonly canal: CanalAdquisicion;
  readonly provider: string;
  readonly status: EstadoCanal;
  readonly naturaleza: 'PAID' | 'ORGANIC';
  readonly readCapability: boolean;
  readonly writeCapability: boolean; // siempre false en este bloque
  readonly accountBinding: 'BOUND' | 'NOT_CONFIGURED';
}

const PROVEEDOR_DE_CANAL: Record<CanalAdquisicion, string> = {
  GOOGLE_SEARCH: 'google',
  META_FACEBOOK: 'meta',
  META_INSTAGRAM: 'meta',
  ORGANIC_FACEBOOK: 'meta',
  ORGANIC_INSTAGRAM: 'meta',
  WEBSITE: 'website',
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
};

export function canalesDe(org: string): readonly CanalVista[] {
  return CANALES_ADQUISICION.map((canal) => {
    const status = estadoCanalDe(org, canal);
    const conLectura = status === 'CONNECTED_READ_ONLY';
    return {
      canal,
      provider: PROVEEDOR_DE_CANAL[canal],
      status,
      naturaleza: naturalezaDeCanal(canal),
      readCapability: conLectura,
      writeCapability: false,
      accountBinding: conLectura ? 'BOUND' : 'NOT_CONFIGURED',
    };
  });
}

/** Proxy honesto de evaluabilidad de medición: hay perfil de evaluación configurado. */
function medicionEvaluableDe(org: string): boolean {
  return buscarProfile(org) !== null;
}

export function estrategiaDe(org: string): VeredictoDirectorAdquisicion & { objetivoLabel: string } {
  const negocio = buscarNegocio(org);
  const modelo = negocio?.modeloDeNegocio ?? 'SERVICIOS';
  const objetivo = objetivoDeModelo(modelo);
  const canales = canalesDe(org).map((c) => ({ canal: c.canal, estado: c.status }));
  const v = razonarAdquisicionShadow({
    organizationId: org,
    objetivo,
    medicionEvaluable: medicionEvaluableDe(org),
    canales,
    tieneBrandPolicy: false,
    tieneStopLoss: false,
    tieneMandatoPresupuesto: false,
  });
  return { ...v, objetivoLabel: objetivo };
}

export interface OutcomeVivo {
  readonly outcome: ResultadoAdquisicion;
  readonly status: 'CONNECTED_WITH_DATA' | 'CONNECTED_NO_DATA' | 'NOT_AVAILABLE';
  readonly value: number | null; // conteo real; null = desconocido, nunca 0 inventado
  readonly source: string;
  readonly window: Ventana;
  readonly testExcluded: number;
}

export interface AtribucionVista {
  readonly estado: 'DIRECT' | 'OBSERVED' | 'ATTRIBUTED' | 'PROBABLE' | 'UNKNOWN';
  readonly humano: string;
  readonly detalle: string;
}

export interface OutcomesVivos {
  readonly outcomes: readonly OutcomeVivo[];
  readonly economia: readonly IndicadorVivo[];
  readonly atribucion: AtribucionVista;
  readonly revenue: { readonly value: number | null; readonly unknown: boolean; readonly currency: string | null } | null;
}

/**
 * Lee los outcomes/economía/atribución REALES desde el SSOT según el modelo de negocio. Sin store,
 * o sin fuentes comerciales, devuelve NOT_AVAILABLE (jamás ceros inventados).
 */
export async function outcomesVivosDe(
  store: EventStore | undefined,
  ctx: RequestContext | null,
  org: string,
): Promise<OutcomesVivos> {
  const modelo = buscarNegocio(org)?.modeloDeNegocio ?? 'SERVICIOS';
  if (store === undefined || ctx === null) {
    return { outcomes: [], economia: [], atribucion: { estado: 'UNKNOWN', humano: 'Sin acceso a datos en este contexto.', detalle: '' }, revenue: null };
  }

  if (modelo === 'ECOMMERCE_DISTRIBUCION') {
    const ventas = normalizarVentas(await leerVentasCyp(store, ctx, org));
    const outcomes: OutcomeVivo[] = [
      { outcome: 'PURCHASE', status: ventas.status, value: ventas.purchases, source: 'woocommerce', window: ventas.ventana, testExcluded: 0 },
    ];
    const economia: IndicadorVivo[] = [
      derivarROAS(null, null, ventas.ventana), // sin ingreso atribuido (atribución UNKNOWN)
      derivarMER(ventas.revenue, null, ventas.ventana), // gasto de marketing no conectado
      derivarCAC(null, false, ventas.ventana), // sin fuente de clientes demostrable
    ];
    return {
      outcomes,
      economia,
      atribucion: { estado: 'UNKNOWN', humano: 'Todavía no sabemos qué canal originó estas compras.', detalle: 'WooCommerce no registra UTM/click-id; GA4 pendiente. Los pedidos históricos permanecen sin atribuir.' },
      revenue: { value: ventas.revenue, unknown: ventas.revenueUnknown, currency: ventas.currency },
    };
  }

  if (modelo === 'SAAS_FUNNEL') {
    const growth = await leerGrowthSmileflow(store, ctx);
    const spend = await leerSpendSmileflow(store, ctx, org);
    const ventanaLeads: Ventana = { inicio: null, fin: null, timezone: 'UTC', freshness: null };
    const outcomes: OutcomeVivo[] = [
      { outcome: 'LEAD', status: growth.status, value: growth.leadCreated, source: 'smileflow-growth', window: ventanaLeads, testExcluded: growth.excludedTest },
      { outcome: 'DEMO', status: growth.status, value: growth.demoRequested, source: 'smileflow-growth', window: ventanaLeads, testExcluded: growth.excludedTest },
      { outcome: 'CUSTOMER', status: 'NOT_AVAILABLE', value: null, source: '(sin fuente downstream)', window: VENTANA_DESCONOCIDA, testExcluded: 0 },
    ];
    const economia: IndicadorVivo[] = [
      derivarCPL(spend.spend, growth.leadCreated, spend.ventana, ventanaLeads),
      derivarCPQL(spend.spend, false, spend.ventana),
      derivarCAC(spend.spend, false, spend.ventana),
      derivarROAS(null, spend.spend, spend.ventana),
    ];
    return {
      outcomes,
      economia,
      atribucion: { estado: 'UNKNOWN', humano: 'Los leads no traen señal de campaña demostrable en esta ventana.', detalle: 'utm/gclid ausentes o atribución demos→ads PENDIENTE. Los eventos TEST/DIAG quedan excluidos.' },
      revenue: null,
    };
  }

  return { outcomes: [], economia: [], atribucion: { estado: 'UNKNOWN', humano: 'Sin fuentes comerciales conectadas.', detalle: '' }, revenue: null };
}

export interface ResumenAdquisicion {
  readonly organizationId: string;
  readonly objetivo: ObjetivoComercial;
  readonly foundation: VeredictoDirectorAdquisicion['veredicto'];
  readonly canalesDisponibles: number;
  readonly canalesConectados: number;
  readonly medicionEvaluable: boolean;
  readonly estrategiaState: VeredictoDirectorAdquisicion['veredicto'];
  readonly decisionesPendientes: readonly string[];
  readonly hipotesisContenido: number;
  readonly hipotesisCampania: number;
  readonly outcomes: readonly OutcomeVivo[];
  readonly blockers: readonly string[];
}

export async function resumenDe(store: EventStore | undefined, ctx: RequestContext | null, org: string): Promise<ResumenAdquisicion> {
  const est = estrategiaDe(org);
  const canales = canalesDe(org);
  const conectados = canales.filter((c) => c.readCapability).length;
  const vivos = await outcomesVivosDe(store, ctx, org);
  return {
    organizationId: org,
    objetivo: est.objetivo,
    foundation: est.veredicto,
    canalesDisponibles: canales.length,
    canalesConectados: conectados,
    medicionEvaluable: medicionEvaluableDe(org),
    estrategiaState: est.veredicto,
    decisionesPendientes: est.veredicto === 'APPROVAL_REQUIRED' ? ['Requiere aprobación humana'] : [],
    hipotesisContenido: 0,
    hipotesisCampania: 0,
    outcomes: vivos.outcomes,
    blockers: est.razones.slice(),
  };
}
