/**
 * Cliente BFF de campaña + autonomía (dry-run/shadow) — /api/backend/acquisition/{action,campaign,autonomy}/*.
 * La sesión va en cookie httpOnly; la organización en cabecera (x-organization-slug). Nunca maneja dinero real:
 * el backend gobierna el mandato (tope humano) y el master switch REAL (por defecto false ⇒ dry-run/shadow).
 */
import { cabecerasOrg } from './org-activa';

async function j<T>(res: Response): Promise<T> {
  const c = (await res.json().catch(() => ({}))) as { ok?: boolean; datos?: T; error?: string; mensaje?: string };
  if (!res.ok || c.ok === false) throw new Error(c.mensaje ?? c.error ?? `error ${res.status}`);
  return c.datos as T;
}
const post = (org: string, ruta: string, body?: unknown) =>
  fetch(`/api/backend/acquisition/${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(org) }, body: JSON.stringify(body ?? {}) });
const get = (org: string, ruta: string) => fetch(`/api/backend/acquisition/${ruta}`, { cache: 'no-store', headers: cabecerasOrg(org) });

export interface Mandato {
  id: string;
  objective: string;
  currency: string;
  authorizedBudgetMinor: number;
  spentMinor: number;
  remainingMinor: number;
  periodStart: string;
  periodEnd: string;
  allowedMetaAssets: string[];
  allowedActionTypes: string[];
  status: string;
  killSwitch: boolean;
  version: number;
}

export interface PiezaContenido {
  variante: string;
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
  hashtags: string[];
  instruccionImagen: string;
  policy: { permitido: boolean; violaciones: { tipo: string; detalle: string }[] };
}
export interface CampaignPlan {
  organizationId: string;
  objetivo: string;
  adAccountId: string;
  moneda: string;
  presupuestoTotalMinor: number;
  segmentacion: { descripcion: string; comuna: string | null };
  anuncios: { variante: string; contenido: PiezaContenido }[];
  advertencias: string[];
  contenidoConforme: boolean;
}
export interface PasoEjecucion {
  orden: number;
  descripcion: string;
  actionType: string;
  costMinor: number;
  estado: string;
  bloqueos: string[];
  externalRef: string | null;
}
export interface EjecucionCampana {
  modo: string;
  pasos: PasoEjecucion[];
  gastoComprometidoMinor: number;
  gastoProyectadoMinor: number;
  metaWriteCallsReales: number;
  ok: boolean;
  resumen: string;
}

export interface PerfilNegocioEntrada {
  nombre: string;
  rubro: string;
  serviciosDeclarados: string[];
  comuna?: string;
}
export interface EntradaCampana {
  perfil: PerfilNegocioEntrada;
  objetivo: string;
  placement: string;
  presupuestoDeseadoMinor: number;
  servicioFoco?: string;
  planId?: string;
}

export interface ShadowRun {
  ranAt: string;
  modo: string;
  metricas: { adRef: string; ctr: number | null; cprMinor: number | null; gastoMinor: number; resultados: number; calidad: string; nota: string }[];
  decisiones: { adRef: string; tipo: string; razon: string }[];
  recomendacionesFinancieras: { tipo: string; justificacion: string; estado: string; autoAplicable: boolean }[];
  acciones: { adRef: string; actionType: string; estado: string; bloqueos: string[]; razon: string }[];
  gastoRealComprometidoMinor: number;
  metaWriteCallsReales: number;
  resumen: string;
}

export const mandatoActual = (org: string) => get(org, 'action/mandate').then((r) => j<Mandato | null>(r));
export const crearMandato = (org: string, b: unknown) => post(org, 'action/mandate', b).then((r) => j<Mandato>(r));
export const gobernarMandato = (org: string, id: string, b: unknown) => post(org, `action/mandate/${id}/gobernar`, b).then((r) => j<Mandato>(r));
export const construirPlan = (org: string, b: EntradaCampana) => post(org, 'campaign/plan', b).then((r) => j<CampaignPlan>(r));
export const simularCampana = (org: string, b: EntradaCampana) => post(org, 'campaign/simulate', b).then((r) => j<{ plan: CampaignPlan; ejecucion: EjecucionCampana }>(r));
export const correrShadow = (org: string, observaciones: unknown[]) => post(org, 'autonomy/shadow-run', { observaciones }).then((r) => j<ShadowRun>(r));
export const ultimosShadow = (org: string, mandatoId: string) => get(org, `autonomy/shadow/${mandatoId}`).then((r) => j<{ runs: ShadowRun[] }>(r));

/** Formatea minor units a CLP legible (asume 0 decimales para CLP). */
export function money(minor: number, currency: string): string {
  const valor = currency === 'CLP' ? minor : minor / 100;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(valor);
}
