/**
 * @soec/estrategia-creativa · dominio · CONEXIÓN del cerebro comercial con el pipeline existente.
 *
 * Deriva, de forma determinista y evaluable, los INSUMOS que los paquetes existentes ya saben
 * consumir, a partir del conocimiento comercial (`@soec/crm-comercial`) y las hipótesis comerciales:
 *   - Segmentos (contrato de `@soec/programas`) desde los clientes ideales (ICP).
 *   - Hipótesis de programa (contrato de `@soec/programas`) desde las hipótesis comerciales.
 *   - Objetivo/`ContenidoObjetivo` (contrato de `@soec/marketing`) desde empresa/producto/ICP + los
 *     parámetros operativos (presupuesto, horizonte, indicador) que aporta la dirección humana.
 * Reemplaza los fixtures del ciclo por conocimiento real. No inventa: si falta información, ABSTIENE.
 */
import type { ConocimientoComercialState, EntidadComercial, HipotesisState } from '@soec/crm-comercial';
import { evaluarHipotesis } from '@soec/crm-comercial';
import type { Segmento, Hipotesis as HipotesisPrograma } from '@soec/programas';
import type { ContenidoObjetivo, Prioridad } from '@soec/marketing';
import { type BriefComercial, type EstrategiaCreativa, type DerivacionCreativa, derivarCreativa } from './estrategia-creativa';

/** Parámetros operativos de campaña que aporta la dirección (no derivables del conocimiento). */
export interface ParametrosCampania {
  readonly objetivoComercial: string;
  readonly objetivoMarketing: string;
  readonly indicador: string;
  readonly lineaBase: number;
  readonly valorEsperado: number;
  readonly horizonteDias: number;
  readonly prioridad: Prioridad;
  readonly restricciones: readonly string[];
  readonly presupuestoTotal: number;
  readonly frecuenciaDias: number;
  readonly territorio: string;
  readonly idioma: string;
  readonly moneda: string;
  readonly canales: readonly string[];
}

/** Paquete de conexión: todo lo que el pipeline necesita, derivado del cerebro comercial. */
export interface PaqueteConexion {
  readonly brief: BriefComercial;
  readonly estrategia: EstrategiaCreativa;
  readonly segmentos: readonly Segmento[];
  readonly hipotesis: readonly HipotesisPrograma[];
  readonly objetivo: ContenidoObjetivo;
}

export type ResultadoConexion =
  | { readonly tipo: 'PROPUESTA'; readonly paquete: PaqueteConexion }
  | { readonly tipo: 'ABSTENCION'; readonly faltantes: readonly string[] };

function valor(ent: EntidadComercial | null | undefined, clave: string): string | null {
  const v = ent?.campos[clave]?.valor;
  return v && v.trim() ? v.trim() : null;
}
function icpsDe(state: ConocimientoComercialState): EntidadComercial[] {
  return Object.values(state.entidades).filter((e) => e.tipo === 'CLIENTE_IDEAL');
}
function lista(v: string | null): string[] {
  return v ? [v] : [];
}

/** Segmentos del programa desde los clientes ideales (ICP). */
export function derivarSegmentos(state: ConocimientoComercialState): Segmento[] {
  return icpsDe(state).map((icp, i) => ({
    id: icp.id,
    nombre: icp.nombre,
    descripcion: valor(icp, 'comportamientoDigital') ?? valor(icp, 'objetivos') ?? icp.nombre,
    problemas: [...lista(valor(icp, 'problemas')), ...lista(valor(icp, 'dolores'))],
    necesidades: [...lista(valor(icp, 'objetivos')), ...lista(valor(icp, 'motivaciones'))],
    criterios: [...lista(valor(icp, 'capacidadEconomica')), ...lista(valor(icp, 'objeciones'))],
    prioridad: i + 1,
  }));
}

const MAPA_ESTADO: Record<HipotesisState['estado'], HipotesisPrograma['estado']> = {
  ABIERTA: 'ABIERTA',
  EN_PRUEBA: 'EN_PRUEBA',
  CONFIRMADA: 'RETENIDA',
  REFUTADA: 'DESCARTADA',
  INCONCLUSA: 'RETENIDA',
};

/** Hipótesis de programa desde las hipótesis comerciales (evidencia/confianza/estado gobernados). */
export function derivarHipotesisPrograma(hips: readonly HipotesisState[], segmentoId: string, brief: BriefComercial): HipotesisPrograma[] {
  return hips
    .filter((h) => h.existe)
    .map((h) => {
      const ev = evaluarHipotesis(h);
      return {
        id: h.hipotesisId,
        segmentoId,
        problema: h.contexto || brief.problemaCliente,
        propuesta: h.enunciado,
        mensaje: brief.mensajePrincipal,
        canalSimulado: 'organico',
        accionEsperada: 'conversion',
        evidencia: h.evidencias.map((e) => e.descripcion),
        informacionFaltante: [...ev.faltantes],
        confianza: ev.confianza ?? 'BAJA',
        estado: MAPA_ESTADO[h.estado],
        criterioContinuacion: 'revisar con evidencia suficiente antes de escalar',
      };
    });
}

/** Objetivo/ContenidoObjetivo desde el conocimiento + parámetros de dirección. */
export function derivarObjetivo(state: ConocimientoComercialState, brief: BriefComercial, params: ParametrosCampania): ContenidoObjetivo {
  const mercado = Object.values(state.entidades).find((e) => e.tipo === 'MERCADO')?.nombre ?? 'general';
  return {
    empresa: brief.empresa,
    marca: brief.empresa,
    producto: brief.producto,
    propuestaValor: brief.propuestaValor,
    mercado,
    territorio: params.territorio,
    idioma: params.idioma,
    moneda: params.moneda,
    audiencia: brief.audiencia,
    segmento: brief.audiencia,
    canales: params.canales,
    objetivoComercial: params.objetivoComercial,
    objetivoMarketing: params.objetivoMarketing,
    indicador: params.indicador,
    lineaBase: params.lineaBase,
    valorEsperado: params.valorEsperado,
    horizonteDias: params.horizonteDias,
    prioridad: params.prioridad,
    restricciones: params.restricciones,
    presupuestoTotal: params.presupuestoTotal,
    frecuenciaDias: params.frecuenciaDias,
  };
}

/** Compone el paquete de conexión completo. ABSTIENE si el conocimiento no es evaluable. */
export function derivarConexion(state: ConocimientoComercialState, hips: readonly HipotesisState[], params: ParametrosCampania): ResultadoConexion {
  const creativa: DerivacionCreativa = derivarCreativa(state);
  if (creativa.tipo === 'ABSTENCION') return { tipo: 'ABSTENCION', faltantes: creativa.faltantes };
  const segmentos = derivarSegmentos(state);
  const segmentoId = segmentos[0]?.id ?? 'segmento-principal';
  const hipotesis = derivarHipotesisPrograma(hips, segmentoId, creativa.brief);
  const objetivo = derivarObjetivo(state, creativa.brief, params);
  return { tipo: 'PROPUESTA', paquete: { brief: creativa.brief, estrategia: creativa.estrategia, segmentos, hipotesis, objetivo } };
}
