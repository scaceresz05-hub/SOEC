import type { ProductoOperacion, ResultadoExperiencia } from './types';

export type ClaveEstado = 'completada' | 'limitada' | 'no-evaluable' | 'abstenida';

export interface EstadoExperiencia {
  clave: ClaveEstado;
  etiqueta: string;
  tono: 'ok' | 'warn' | 'danger' | 'reserved';
}

/** Deriva el estado de experiencia sin usar una calificación única ni semáforo global. */
export function estadoDe(r: ResultadoExperiencia): EstadoExperiencia {
  const p = r.producto;
  if (!p || r.estado === 'inexistente') return { clave: 'abstenida', etiqueta: 'sin análisis', tono: 'warn' };
  if (p.abstenido) return { clave: 'abstenida', etiqueta: 'no fue posible producir un resultado', tono: 'warn' };
  if (r.intermedios.length > 0 && r.intermedios.every((i) => i.abstenido)) {
    return { clave: 'no-evaluable', etiqueta: 'no evaluable con la información disponible', tono: 'warn' };
  }
  if (p.contradiccionesAbiertas.length > 0 || p.faltante.length > 0 || p.limitaciones.length > 0) {
    return { clave: 'limitada', etiqueta: 'comprensión con limitaciones', tono: 'reserved' };
  }
  return { clave: 'completada', etiqueta: 'comprensión disponible', tono: 'ok' };
}

export function operacionHumana(op: string): string {
  if (op === 'detectar') return 'Señales detectadas';
  if (op === 'esclarecer') return 'Aclaración de una tensión';
  return op;
}

export function queEncontro(o: ProductoOperacion): string {
  if (o.abstenido) return `No fue posible: ${o.causaAbstencion ?? 'motivo no especificado'}.`;
  const d = o.detalle;
  if (d.deteccion) {
    const n = d.deteccion.senales.length;
    return n === 0 ? 'No se hallaron señales con sustento.' : `Se hallaron ${n} señal(es) que merecen atención.`;
  }
  if (d.esclarecimiento) {
    return d.esclarecimiento.contradiccionSinResolver
      ? 'Se aclaró una contradicción, mostrando sus lados sin resolverla.'
      : 'Se aclaró la estructura y el soporte del elemento.';
  }
  return 'Resultado producido.';
}
