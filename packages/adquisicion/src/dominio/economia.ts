/**
 * AcquisitionEconomics — la economía de la adquisición, con denominadores honestos.
 *
 * El Director NO debe concluir "Meta funciona" por un CTR alto. Este módulo deriva CPL/CPQL/CAC/
 * ROAS/MER SÓLO cuando los denominadores son válidos y las entradas son conocidas. Reutiliza el
 * primitivo `DesconocidoOValor` de `@soec/comercio` para las magnitudes de entrada (gasto, leads,
 * ingresos): un valor DESCONOCIDO nunca se trata como 0, y un indicador con denominador ≤ 0 devuelve
 * `null`, jamás un número inventado. DESCONOCIDO permanece DESCONOCIDO.
 */

import type { DesconocidoOValor } from '@soec/comercio';

export interface EntradasEconomia {
  readonly gasto: DesconocidoOValor;
  readonly leads: DesconocidoOValor;
  readonly leadsCalificados: DesconocidoOValor;
  readonly clientes: DesconocidoOValor;
  readonly ingresos: DesconocidoOValor;
  /** Ingreso total del negocio (para MER), no sólo el atribuido. */
  readonly ingresosTotales: DesconocidoOValor;
}

export type MotivoIndicador = 'OK' | 'ENTRADA_DESCONOCIDA' | 'DENOMINADOR_INVALIDO';

export interface IndicadorAdquisicion {
  readonly nombre: 'CPL' | 'CPQL' | 'CAC' | 'ROAS' | 'MER';
  readonly valor: number | null;
  readonly formula: string;
  readonly motivo: MotivoIndicador;
}

function razonar(
  nombre: IndicadorAdquisicion['nombre'],
  formula: string,
  numerador: DesconocidoOValor,
  denominador: DesconocidoOValor,
): IndicadorAdquisicion {
  if (!numerador.conocido || !denominador.conocido) {
    return { nombre, valor: null, formula, motivo: 'ENTRADA_DESCONOCIDA' };
  }
  if (denominador.valor <= 0) {
    return { nombre, valor: null, formula, motivo: 'DENOMINADOR_INVALIDO' };
  }
  return { nombre, valor: numerador.valor / denominador.valor, formula, motivo: 'OK' };
}

/** Costo por lead = gasto / leads. */
export function cpl(e: EntradasEconomia): IndicadorAdquisicion {
  return razonar('CPL', 'gasto / leads', e.gasto, e.leads);
}

/** Costo por lead calificado = gasto / leadsCalificados. */
export function cpql(e: EntradasEconomia): IndicadorAdquisicion {
  return razonar('CPQL', 'gasto / leadsCalificados', e.gasto, e.leadsCalificados);
}

/** Costo de adquisición de cliente = gasto / clientes. */
export function cac(e: EntradasEconomia): IndicadorAdquisicion {
  return razonar('CAC', 'gasto / clientes', e.gasto, e.clientes);
}

/** Retorno sobre inversión publicitaria = ingresosAtribuidos / gasto. */
export function roas(e: EntradasEconomia): IndicadorAdquisicion {
  return razonar('ROAS', 'ingresosAtribuidos / gasto', e.ingresos, e.gasto);
}

/** Media Efficiency Ratio = ingresoTotalDelNegocio / gasto. */
export function mer(e: EntradasEconomia): IndicadorAdquisicion {
  return razonar('MER', 'ingresosTotales / gasto', e.ingresosTotales, e.gasto);
}

export function economiaCompleta(e: EntradasEconomia): readonly IndicadorAdquisicion[] {
  return [cpl(e), cpql(e), cac(e), roas(e), mer(e)];
}
