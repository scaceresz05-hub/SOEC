/**
 * @soec/adaptadores · M4-D (neutral) · PRESUPUESTO / TOPES (Eje 4). El control opera ANTES de la llamada:
 * dado el consumo ya registrado en la ventana y una estimación del request, se decide si ejecutar o
 * rechazar SIN llamar al proveedor. Ante costo desconocido se usa una estimación CONSERVADORA (cota
 * superior); ante duda, se rechaza (fail-safe a no-gasto). Los MONTOS concretos los decide D-3 y se inyectan
 * como `PoliticaPresupuesto` (dato); aquí no hay ningún valor concreto. Sin red/SDK/reloj/azar.
 */
export interface PoliticaPresupuesto {
  readonly topeUnidades: number; // tope duro por ventana (unidades lógicas, no precio comercial); inyectado (D-3)
  readonly ventanaMs: number;
  readonly version: string;
}

export type NaturalezaEstimacion = 'REAL' | 'ESTIMADA' | 'CONSERVADORA' | 'DESCONOCIDA';

export interface EstimacionUso {
  readonly unidades: number;
  readonly naturaleza: NaturalezaEstimacion;
}

/**
 * Estimación conservadora del uso de un request. Si se conoce un valor exacto, se usa (`REAL`/`ESTIMADA`);
 * si es desconocido, se usa la cota superior conservadora (`CONSERVADORA`). Sin cota superior disponible,
 * la estimación es `DESCONOCIDA` con unidades Infinity → forzará el rechazo (fail-safe a no-gasto).
 */
export function estimarConservador(exacto: number | null, cotaSuperior: number | null): EstimacionUso {
  if (exacto !== null && Number.isFinite(exacto) && exacto >= 0) return { unidades: exacto, naturaleza: 'ESTIMADA' };
  if (cotaSuperior !== null && Number.isFinite(cotaSuperior) && cotaSuperior >= 0) return { unidades: cotaSuperior, naturaleza: 'CONSERVADORA' };
  return { unidades: Number.POSITIVE_INFINITY, naturaleza: 'DESCONOCIDA' };
}

export interface VeredictoPresupuesto {
  readonly permitido: boolean;
  readonly proyectado: number; // consumido + estimado
  readonly motivo: string;
}

/**
 * Decide ANTES de la llamada. Rechaza si `consumidoEnVentana + estimacion.unidades` supera el tope duro, o
 * si la estimación es DESCONOCIDA (fail-safe). No ejecuta nada: sólo autoriza/deniega.
 */
export function evaluarPresupuesto(politica: PoliticaPresupuesto, consumidoEnVentana: number, estimacion: EstimacionUso): VeredictoPresupuesto {
  if (estimacion.naturaleza === 'DESCONOCIDA' || !Number.isFinite(estimacion.unidades)) {
    return { permitido: false, proyectado: Number.POSITIVE_INFINITY, motivo: 'estimación desconocida: rechazo por precaución (fail-safe a no-gasto)' };
  }
  const proyectado = consumidoEnVentana + estimacion.unidades;
  if (proyectado > politica.topeUnidades) {
    return { permitido: false, proyectado, motivo: `tope de presupuesto superado antes de la llamada (${proyectado} > ${politica.topeUnidades})` };
  }
  return { permitido: true, proyectado, motivo: '' };
}
