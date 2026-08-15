/**
 * apps/api · Economía viva del Acquisition Engine — derivaciones honestas con ventana.
 *
 * Cada indicador es VALUE / UNKNOWN / NOT_APPLICABLE / INSUFFICIENT_DATA / NO_CONVERSIONS. Nunca NaN,
 * nunca Infinity, nunca un 0 falso. No se divide entre ventanas incompatibles: si el gasto y los
 * resultados no comparten ventana, el indicador es INSUFFICIENT_DATA. Con leads=0 el CPL es
 * NO_CONVERSIONS (indefinido), jamás $0.
 */

export type DisponibilidadIndicador = 'VALUE' | 'UNKNOWN' | 'NOT_APPLICABLE' | 'INSUFFICIENT_DATA' | 'NO_CONVERSIONS';

export interface Ventana {
  readonly inicio: string | null;
  readonly fin: string | null;
  readonly timezone: string;
  readonly freshness: string | null;
}

export const VENTANA_DESCONOCIDA: Ventana = { inicio: null, fin: null, timezone: 'UTC', freshness: null };

export interface IndicadorVivo {
  readonly nombre: 'CPL' | 'CPQL' | 'CAC' | 'ROAS' | 'MER';
  readonly valor: number | null;
  readonly disponibilidad: DisponibilidadIndicador;
  readonly formula: string;
  readonly caveat: string | null;
  readonly ventana: Ventana;
}

function ind(
  nombre: IndicadorVivo['nombre'],
  formula: string,
  disponibilidad: DisponibilidadIndicador,
  valor: number | null,
  ventana: Ventana,
  caveat: string | null = null,
): IndicadorVivo {
  return { nombre, valor, disponibilidad, formula, caveat, ventana };
}

/** ¿Dos ventanas son compatibles para dividir una sobre otra? (misma zona y solapamiento declarado). */
export function ventanasCompatibles(a: Ventana, b: Ventana): boolean {
  // En este bloque ambas fuentes son acumuladas «all-time»; se consideran compatibles sólo si ninguna
  // declara un rango acotado distinto. Si una tiene rango y la otra no, NO se asumen compatibles.
  const aAcotada = a.inicio !== null || a.fin !== null;
  const bAcotada = b.inicio !== null || b.fin !== null;
  if (aAcotada !== bAcotada) return false;
  return a.timezone === b.timezone || a.timezone === 'UTC' || b.timezone === 'UTC';
}

/**
 * CPL = gasto / leads comerciales. Sólo VALUE si ambos conocidos, misma ventana y leads>0. leads=0 ⇒
 * NO_CONVERSIONS. Como los leads no están atribuidos al gasto de Ads (atribución PENDIENTE), el valor
 * lleva un caveat de mezcla («blended»): es costo por lead comercial del período, no por lead atribuido.
 */
export function derivarCPL(
  gasto: number | null,
  leadsComercial: number | null,
  ventanaGasto: Ventana,
  ventanaLeads: Ventana,
): IndicadorVivo {
  const v = ventanaLeads;
  if (gasto === null || leadsComercial === null) return ind('CPL', 'gasto / leads', 'INSUFFICIENT_DATA', null, v);
  if (!ventanasCompatibles(ventanaGasto, ventanaLeads)) return ind('CPL', 'gasto / leads', 'INSUFFICIENT_DATA', null, v, 'VENTANAS_INCOMPATIBLES');
  if (leadsComercial === 0) return ind('CPL', 'gasto / leads', 'NO_CONVERSIONS', null, v);
  return ind('CPL', 'gasto / leads', 'VALUE', gasto / leadsComercial, v, 'BLENDED_ALL_TIME_NO_ADS_ATTRIBUTION');
}

/** CPQL = gasto / leads calificados. Sin fuente de calificación demostrable ⇒ NOT_APPLICABLE. */
export function derivarCPQL(gasto: number | null, calificadosDisponibles: boolean, ventana: Ventana): IndicadorVivo {
  if (!calificadosDisponibles) return ind('CPQL', 'gasto / leadsCalificados', 'NOT_APPLICABLE', null, ventana, 'SIN_FUENTE_DE_CALIFICACION');
  return ind('CPQL', 'gasto / leadsCalificados', 'INSUFFICIENT_DATA', null, ventana);
}

/** CAC = gasto / clientes. Sin fuente de clientes demostrable ⇒ NOT_APPLICABLE (no se infiere cliente). */
export function derivarCAC(gasto: number | null, clientesDisponibles: boolean, ventana: Ventana): IndicadorVivo {
  if (!clientesDisponibles) return ind('CAC', 'gasto / clientes', 'NOT_APPLICABLE', null, ventana, 'SIN_FUENTE_DE_CLIENTES');
  return ind('CAC', 'gasto / clientes', 'INSUFFICIENT_DATA', null, ventana);
}

/** ROAS = ingresoAtribuido / gasto. Sin ingreso ATRIBUIDO (atribución UNKNOWN) ⇒ NOT_APPLICABLE. */
export function derivarROAS(ingresoAtribuido: number | null, gasto: number | null, ventana: Ventana): IndicadorVivo {
  if (ingresoAtribuido === null) return ind('ROAS', 'ingresoAtribuido / gasto', 'NOT_APPLICABLE', null, ventana, 'SIN_INGRESO_ATRIBUIDO');
  if (gasto === null || gasto <= 0) return ind('ROAS', 'ingresoAtribuido / gasto', 'INSUFFICIENT_DATA', null, ventana);
  return ind('ROAS', 'ingresoAtribuido / gasto', 'VALUE', ingresoAtribuido / gasto, ventana);
}

/** MER = ingresoTotal / gastoMarketingTotal. Sin gasto de marketing conectado ⇒ NOT_APPLICABLE. */
export function derivarMER(ingresoTotal: number | null, gastoMarketing: number | null, ventana: Ventana): IndicadorVivo {
  if (gastoMarketing === null) return ind('MER', 'ingresoTotal / gastoMarketing', 'NOT_APPLICABLE', null, ventana, 'GASTO_MARKETING_NO_CONECTADO');
  if (ingresoTotal === null) return ind('MER', 'ingresoTotal / gastoMarketing', 'INSUFFICIENT_DATA', null, ventana);
  if (gastoMarketing <= 0) return ind('MER', 'ingresoTotal / gastoMarketing', 'INSUFFICIENT_DATA', null, ventana);
  return ind('MER', 'ingresoTotal / gastoMarketing', 'VALUE', ingresoTotal / gastoMarketing, ventana);
}
