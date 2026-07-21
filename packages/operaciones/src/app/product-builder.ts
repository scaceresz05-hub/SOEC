/**
 * Constructores compartidos de productos intelectuales y abstenciones.
 * Garantizan la anatomía común y `bindingDecision: false` en todo producto.
 */
import type { ContextoMecanismo } from '../domain/mechanism';
import {
  type CausaAbstencion,
  type Deteccion,
  type Esclarecimiento,
  type Orientacion,
  type ProductoBase,
  type ProductoIntelectual,
  type Proyeccion,
  type TipoOperacion,
} from '../domain/product';

interface Especializado {
  esclarecimiento?: Esclarecimiento;
  deteccion?: Deteccion;
  proyeccion?: Proyeccion;
  orientacion?: Orientacion;
}

const VACIO: Record<TipoOperacion, Especializado> = {
  esclarecer: { esclarecimiento: { elementoTipo: '', lados: [], relacionesExplicitas: [], contradiccionSinResolver: false } },
  detectar: { deteccion: { senales: [] } },
  proyectar: { proyeccion: { horizonte: '', estadoObservado: [], supuestos: [], factoresNoObservados: [], escenarios: [] } },
  orientar: { orientacion: { asunto: '', consideraciones: [], cuestionesReservadas: [], noVinculante: true } },
};

export function baseProducto(
  contexto: ContextoMecanismo,
  mecanismo: { nombre: string; version: string },
  campos: Partial<ProductoBase> = {},
): ProductoBase {
  return {
    operacion: contexto.operacion,
    eceId: contexto.eceId,
    eceCorte: contexto.eceCorte,
    proposito: contexto.proposito,
    procedencia: `ECE:${contexto.eceId}@v${contexto.eceCorte.version}`,
    evidencia: [],
    faltante: [],
    limitaciones: [],
    incertidumbre: 'heredada del ECE',
    razones: [],
    cuestionesJuicioHumano: [],
    atribucion: contexto.attribution,
    abstenido: false,
    causaAbstencion: null,
    bindingDecision: false,
    mecanismo: mecanismo.nombre,
    mecanismoVersion: mecanismo.version,
    ...campos,
  };
}

export function construir(
  operacion: TipoOperacion,
  base: ProductoBase,
  esp: Especializado,
): ProductoIntelectual {
  switch (operacion) {
    case 'esclarecer':
      return { ...base, operacion, esclarecimiento: esp.esclarecimiento ?? VACIO.esclarecer.esclarecimiento! };
    case 'detectar':
      return { ...base, operacion, deteccion: esp.deteccion ?? VACIO.detectar.deteccion! };
    case 'proyectar':
      return { ...base, operacion, proyeccion: esp.proyeccion ?? VACIO.proyectar.proyeccion! };
    case 'orientar':
      return { ...base, operacion, orientacion: esp.orientacion ?? VACIO.orientar.orientacion! };
  }
}

/** Construye una abstención comprensible (conserva causa, faltante y limitaciones). */
export function abstener(
  contexto: ContextoMecanismo,
  mecanismo: { nombre: string; version: string },
  causa: CausaAbstencion,
  detalle: { faltante?: string[]; limitaciones?: string[]; razones?: string[] } = {},
): ProductoIntelectual {
  const base = baseProducto(contexto, mecanismo, {
    abstenido: true,
    causaAbstencion: causa,
    faltante: detalle.faltante ?? [],
    limitaciones: detalle.limitaciones ?? [`abstención por ${causa}`],
    razones: detalle.razones ?? [`el mecanismo se abstiene: ${causa}`],
    cuestionesJuicioHumano: ['la persona decide cómo proceder ante la abstención'],
    incertidumbre: 'no determinable',
  });
  return construir(contexto.operacion, base, VACIO[contexto.operacion]);
}
