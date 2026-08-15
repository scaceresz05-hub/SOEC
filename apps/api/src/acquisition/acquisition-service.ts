/**
 * apps/api · Servicio de lectura del Acquisition Engine — proyecciones tenant-scoped y honestas.
 *
 * Compone el dominio `@soec/adquisicion` con el registro real de negocios de la plataforma. NO abre
 * red, NO conecta Meta, NO fabrica ceros: un canal sin conexión reporta `NOT_CONFIGURED` (no `0`), y
 * las métricas sin denominador válido quedan `UNKNOWN`. El objetivo se deriva del `ModeloDeNegocio`
 * (config), no de `if org`. La organización llega ya resuelta por el contexto autenticado.
 */

import {
  planificarAdquisicion,
  naturalezaDeCanal,
  esCanalPagado,
  cpl,
  cac,
  roas,
  mer,
  CANALES_ADQUISICION,
  type CanalAdquisicion,
  type EstadoCanal,
  type ObjetivoComercial,
  type ResultadoAdquisicion,
  type IndicadorAdquisicion,
} from '@soec/adquisicion';
import { desconocido, type DesconocidoOValor } from '@soec/comercio';
import { buscarNegocio, buscarProfile, buscarFuentes } from '../plataforma';
import { buscarCuentaMeta, estadoCuentaMeta } from '../plataforma/meta-canal';
import { razonarAdquisicionShadow, type VeredictoDirectorAdquisicion } from '../adquisicion/director-multicanal';
import type { CuentaExternaRef, ModeloDeNegocio } from '../plataforma/tipos';

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

export interface OutcomeVista {
  readonly outcome: ResultadoAdquisicion;
  readonly disponibilidad: 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';
  readonly n: number | null; // null = desconocido, nunca 0 inventado
}

/** Outcomes comerciales del negocio. Sin instrumentación viva, la disponibilidad es honesta. */
export function outcomesDe(org: string): readonly OutcomeVista[] {
  const modelo = buscarNegocio(org)?.modeloDeNegocio ?? 'SERVICIOS';
  return resultadosComercialesDeModelo(modelo).map((outcome) => ({
    outcome,
    disponibilidad: 'NOT_AVAILABLE' as const, // el conteo vivo se cablea en el onboarding/medición real
    n: null,
  }));
}

export interface EconomiaVista {
  readonly indicadores: readonly IndicadorAdquisicion[];
}

/** Economía honesta: sin denominadores válidos hoy, todo queda UNKNOWN (no se fabrica CAC/ROAS). */
export function economiaDe(_org: string): EconomiaVista {
  const u: DesconocidoOValor = desconocido('NO_INSTRUMENTADO');
  const entradas = { gasto: u, leads: u, leadsCalificados: u, clientes: u, ingresos: u, ingresosTotales: u };
  return { indicadores: [cpl(entradas), cac(entradas), roas(entradas), mer(entradas)] };
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
  readonly outcomes: readonly OutcomeVista[];
  readonly blockers: readonly string[];
}

export function resumenDe(org: string): ResumenAdquisicion {
  const est = estrategiaDe(org);
  const canales = canalesDe(org);
  const conectados = canales.filter((c) => c.readCapability).length;
  const blockers = est.razones.slice();
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
    outcomes: outcomesDe(org),
    blockers,
  };
}
