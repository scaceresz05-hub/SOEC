/**
 * apps/api · V2-B · CAMPAIGN STRATEGY ENGINE. Propone una ESTRUCTURA de campaña determinista (1 campaña →
 * 1 conjunto → N anuncios A/B) y una ASIGNACIÓN de presupuesto. NO es autoridad sobre el dinero: solo
 * propone; el Budget Guard (V2-A) decide. El presupuesto propuesto se limita al restante del mandato.
 */
import { generarContenido, type BriefContenido, type ObjetivoCampana, type PerfilNegocio, type Placement, type PiezaContenido } from './content-engine';

export interface EntradaPlan {
  readonly perfil: PerfilNegocio;
  readonly objetivo: ObjetivoCampana;
  readonly placement: Placement;
  readonly adAccountId: string; // activo autorizado en el mandato (assetId)
  readonly moneda: string;
  readonly presupuestoDeseadoMinor: number; // intención comercial (minor units)
  readonly restanteMandatoMinor: number; // techo disponible del mandato — NUNCA se supera
  readonly servicioFoco?: string;
}

export interface AnuncioPlan {
  readonly variante: string;
  readonly contenido: PiezaContenido;
}

export interface CampaignPlan {
  readonly organizationId: string;
  readonly objetivo: ObjetivoCampana;
  readonly adAccountId: string;
  readonly moneda: string;
  readonly presupuestoTotalMinor: number; // ≤ restanteMandatoMinor y ≤ presupuestoDeseadoMinor
  readonly segmentacion: { readonly descripcion: string; readonly comuna: string | null };
  readonly anuncios: readonly AnuncioPlan[];
  readonly advertencias: readonly string[];
  readonly contenidoConforme: boolean; // todas las piezas pasaron la content-policy
}

const OBJETIVO_META: Record<ObjetivoCampana, string> = {
  RECONOCIMIENTO: 'OUTCOME_AWARENESS',
  CONSIDERACION: 'OUTCOME_ENGAGEMENT',
  MENSAJES: 'OUTCOME_ENGAGEMENT',
  TRAFICO: 'OUTCOME_TRAFFIC',
};

export function metaObjetivo(o: ObjetivoCampana): string {
  return OBJETIVO_META[o];
}

/** Construcción determinista. El presupuesto total = min(deseado, restante), entero, nunca negativo. */
export function construirCampaignPlan(entrada: EntradaPlan): CampaignPlan {
  const advertencias: string[] = [];
  const restante = Math.max(0, Math.trunc(entrada.restanteMandatoMinor));
  const deseado = Math.max(0, Math.trunc(entrada.presupuestoDeseadoMinor));
  const presupuestoTotalMinor = Math.min(deseado, restante);
  if (presupuestoTotalMinor < deseado) advertencias.push('presupuesto propuesto limitado por el restante del mandato');
  if (presupuestoTotalMinor === 0) advertencias.push('sin presupuesto disponible: la campaña quedará bloqueada por el Budget Guard');
  if (entrada.perfil.serviciosDeclarados.length === 0) advertencias.push('el negocio no declaró servicios: el copy será genérico y conservador');

  const brief: BriefContenido = {
    organizationId: entrada.perfil.organizationId,
    objetivo: entrada.objetivo,
    placement: entrada.placement,
    ...(entrada.servicioFoco !== undefined ? { servicioFoco: entrada.servicioFoco } : {}),
  };
  const piezas = generarContenido(entrada.perfil, brief);
  const anuncios: AnuncioPlan[] = piezas.map((p) => ({ variante: p.variante, contenido: p }));
  const contenidoConforme = piezas.every((p) => p.policy.permitido);
  if (!contenidoConforme) advertencias.push('una o más piezas de contenido no pasaron la content-policy y no deben publicarse');

  return {
    organizationId: entrada.perfil.organizationId,
    objetivo: entrada.objetivo,
    adAccountId: entrada.adAccountId,
    moneda: entrada.moneda,
    presupuestoTotalMinor,
    segmentacion: { descripcion: `${entrada.placement} · público amplio${entrada.perfil.comuna ? ' localizado' : ''}`, comuna: entrada.perfil.comuna ?? null },
    anuncios,
    advertencias,
    contenidoConforme,
  };
}
