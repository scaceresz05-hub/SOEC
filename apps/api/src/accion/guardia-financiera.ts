/**
 * apps/api · GUARDIA FINANCIERA — proteger el mandato, no optimizar la campaña.
 *
 * ESTO NO ES UNA FUNCIÓN DE AUTONOMÍA. Apagar `AUTONOMIA_ADS` apaga que SOEC decida por su cuenta; no puede
 * apagar que SOEC frene cuando el dinero autorizado se acaba. Por eso la guardia vive aquí, junto al mandato,
 * y no en el módulo de optimización: quien mira si queda dinero no puede ser el mismo que decide si conviene
 * gastarlo, ni depender de que alguien haya encendido un permiso.
 *
 * ── LA VERDAD INCÓMODA SOBRE EL TOPE TOTAL ──
 *
 * Google no ofrece un tope total DURO para campañas de búsqueda con presupuesto diario. Ofrece dos cosas, y
 * ninguna es la que hace falta:
 *   · presupuesto diario, que además es un PROMEDIO (puede gastar hasta el doble en un día);
 *   · presupuesto total de campaña, que no tiene límite diario estricto.
 * Elegir una en silencio sería incumplir la otra mitad de lo que autorizó la persona.
 *
 * Y aunque se vigile desde fuera, el gasto se conoce con RETRASO: las métricas de la plataforma no son
 * instantáneas. Entre que se cruza el tope y que SOEC lo ve y pausa, puede haberse gastado algo más. Eso no
 * se puede prometer que no pase. Lo que sí se puede es acotarlo, decirlo antes y dejar el margen calculado.
 *
 * Por eso esta guardia:
 *   1. declara SIN ADORNOS que no hay garantía matemática del tope total (`garantiaDura === false`);
 *   2. acota el peor caso con una aritmética que cualquiera puede comprobar;
 *   3. propone un umbral de frenado ANTES del tope, para que el peor caso quepa dentro de lo autorizado.
 */

export type VeredictoGuardia = 'CONTINUAR' | 'FRENAR_AHORA' | 'AGOTADO';

export interface EstadoFinancieroObservado {
  /** Gasto que SOEC ha podido observar, en unidades menores. Siempre es una foto con retraso. */
  readonly gastoObservadoMinor: number;
  /** Antigüedad de esa foto, en horas. Es la medida honesta de cuánto puede haberse gastado sin verse. */
  readonly antiguedadHoras: number;
}

export interface LimitesDelMandato {
  readonly totalMinor: number;
  readonly diarioMinor: number;
}

export interface VeredictoFinanciero {
  readonly veredicto: VeredictoGuardia;
  /** Gasto máximo que PODRÍA haber ocurrido ya, contando lo que aún no se ve. */
  readonly gastoPosibleMinor: number;
  /** Cuánto queda, en el peor caso. Nunca negativo. */
  readonly margenMinor: number;
  /** Umbral a partir del cual se frena, calculado para que el peor caso quepa en el total. */
  readonly umbralDeFrenadoMinor: number;
  /** `false` siempre: no existe garantía dura del total con la plataforma actual. Se declara, no se esconde. */
  readonly garantiaDura: false;
  readonly explicacion: string;
}

/**
 * Cuánto puede gastar Google en un día, como máximo, con un presupuesto diario declarado: el DOBLE. Es la
 * regla documentada del presupuesto diario medio, y es la razón de que a Google se le declare la mitad del
 * tope humano.
 */
export const FACTOR_DIARIO_GOOGLE = 2;

/** Presupuesto que se le declara a Google para que su máximo diario no supere el tope humano. */
export function presupuestoMedioParaGoogle(topeDuroDiarioMinor: number): number {
  return Math.floor(topeDuroDiarioMinor / FACTOR_DIARIO_GOOGLE);
}

/**
 * GASTO CIEGO: lo que la plataforma podría haber gastado desde la última foto que SOEC pudo ver. Se calcula
 * con el máximo diario de Google —no con el promedio— porque acotar el peor caso con el caso medio no es
 * acotar nada.
 */
export function gastoCiegoMaximoMinor(limites: LimitesDelMandato, antiguedadHoras: number): number {
  const horas = Math.max(0, antiguedadHoras);
  const maximoPorHora = (limites.diarioMinor * FACTOR_DIARIO_GOOGLE) / 24;
  return Math.ceil(maximoPorHora * horas);
}

/**
 * Evalúa si se puede seguir gastando. Determinista y sin red: es una regla de protección, no una decisión
 * comercial, y tiene que poder comprobarse sin depender de nadie.
 */
export function evaluarGuardiaFinanciera(limites: LimitesDelMandato, observado: EstadoFinancieroObservado): VeredictoFinanciero {
  const ciego = gastoCiegoMaximoMinor(limites, observado.antiguedadHoras);
  const gastoPosible = observado.gastoObservadoMinor + ciego;
  const margen = Math.max(0, limites.totalMinor - gastoPosible);

  /**
   * Se frena cuando lo que PODRÍA gastarse antes de la próxima comprobación ya no cabe. El umbral no es una
   * proporción arbitraria: es el total menos el peor caso de un ciclo de observación.
   */
  const umbral = Math.max(0, limites.totalMinor - ciego);

  if (observado.gastoObservadoMinor >= limites.totalMinor) {
    return {
      veredicto: 'AGOTADO',
      gastoPosibleMinor: gastoPosible,
      margenMinor: 0,
      umbralDeFrenadoMinor: umbral,
      garantiaDura: false,
      explicacion: `el gasto observado (${observado.gastoObservadoMinor}) ya alcanza el total autorizado (${limites.totalMinor}): se detiene`,
    };
  }
  if (gastoPosible >= limites.totalMinor) {
    return {
      veredicto: 'FRENAR_AHORA',
      gastoPosibleMinor: gastoPosible,
      margenMinor: margen,
      umbralDeFrenadoMinor: umbral,
      garantiaDura: false,
      explicacion: `con lo observado (${observado.gastoObservadoMinor}) más lo que pudo gastarse sin verse en ${observado.antiguedadHoras} h (hasta ${ciego}), se alcanzaría el total autorizado: se frena antes de comprobarlo`,
    };
  }
  return {
    veredicto: 'CONTINUAR',
    gastoPosibleMinor: gastoPosible,
    margenMinor: margen,
    umbralDeFrenadoMinor: umbral,
    garantiaDura: false,
    explicacion: `en el peor caso se habrían gastado ${gastoPosible} de ${limites.totalMinor}; quedan ${margen} de margen`,
  };
}

/**
 * Lo que se le puede prometer a una persona sobre su tope total, en su idioma y sin exagerar. Se usa para
 * que la pantalla diga exactamente esto y no «tu presupuesto está garantizado».
 */
export function promesaSobreElTotal(limites: LimitesDelMandato, antiguedadHorasEsperada: number): string {
  const ciego = gastoCiegoMaximoMinor(limites, antiguedadHorasEsperada);
  return `SOEC detiene la campaña cuando el gasto se acerca a tu máximo. La plataforma informa del gasto con retraso, así que en el peor caso podría gastarse hasta ${ciego} por encima de lo que SOEC ve en ese momento; por eso se frena antes. No se puede prometer el importe exacto al peso: se puede prometer que nunca se sigue gastando a sabiendas.`;
}
