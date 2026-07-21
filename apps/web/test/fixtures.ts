import type { ProductoOperacion, ResultadoExperiencia } from '../lib/types';

const detectar: ProductoOperacion = {
  operacion: 'detectar',
  abstenido: false,
  causaAbstencion: null,
  evidencia: ['ev-cob-si', 'ev-cob-no'],
  razones: ['se hallaron 2 configuración(es) con sustento en el ECE'],
  procedencia: 'ECE:ece-pyme-01@v10',
  incertidumbre: 'heredada del ECE',
  faltante: ['evidencia faltante o inconclusa'],
  limitaciones: [],
  detalle: {
    operacion: 'detectar',
    mecanismo: 'determinístico',
    mecanismoVersion: '1.0.0',
    eceCorte: { version: 10, recordedAt: null },
    deteccion: {
      senales: [
        { objeto: 'tensión: contradicción', entradas: ['MED:pyme-servicios-01:a-cobertura'], condiciones: ['evidencia en conflicto'], incertidumbre: 'alta', posibleFalsoPositivo: false, noEvaluable: false },
        { objeto: 'ausencia crítica', entradas: ['MED:pyme-servicios-01:a-satisfaccion'], condiciones: [], incertidumbre: 'alta', posibleFalsoPositivo: true, noEvaluable: true },
      ],
    },
  },
};

const esclarecer: ProductoOperacion = {
  operacion: 'esclarecer',
  abstenido: false,
  causaAbstencion: null,
  evidencia: ['ev-cob-si', 'ev-cob-no'],
  razones: ['el elemento der:contradiccion:MED:pyme-servicios-01:a-cobertura es de tipo contradiccion', 'presenta lados en tensión que no se resuelven'],
  procedencia: 'MED:pyme-servicios-01@v10 afirmación a-cobertura',
  incertidumbre: 'alta',
  faltante: [],
  limitaciones: [],
  detalle: {
    operacion: 'esclarecer',
    mecanismo: 'determinístico',
    mecanismoVersion: '1.0.0',
    esclarecimiento: {
      elementoTipo: 'contradiccion',
      lados: [{ referencia: 'MED:pyme-servicios-01:a-cobertura', tipo: 'afirmacion', contenido: 'reporte comercial vs. cola de espera' }],
      relacionesExplicitas: ['tipo=contradiccion'],
      contradiccionSinResolver: true,
    },
  },
};

export const resultadoLimitado: ResultadoExperiencia = {
  executionId: 'ce-demo-1',
  existe: true,
  estado: 'compuesta',
  empresa: 'Pyme de servicios (instancia sintética)',
  capacidad: { id: 'comprender-el-estado', nombre: 'Comprender el estado (pyme de servicios)', version: 1 },
  construidoEn: '2026-03-01T12:00:00.000Z',
  producto: {
    capabilityId: 'comprender-el-estado',
    version: 1,
    nombre: 'Comprender el estado (pyme de servicios)',
    proposito: 'que la persona comprenda el estado actual',
    operacionesEjecutadas: [
      { stepId: 'd1', operacion: 'detectar', operacionExecutionId: 'ce-demo-1:d1', abstenido: false, causaAbstencion: null, resumen: '2 señal(es)' },
      { stepId: 'e1', operacion: 'esclarecer', operacionExecutionId: 'ce-demo-1:e1', abstenido: false, causaAbstencion: null, resumen: 'esclarece una contradicción sin resolver' },
    ],
    productosIntermedios: ['ce-demo-1:d1', 'ce-demo-1:e1'],
    productoCompuesto: ['detectar [d1]: 2 señal(es)', 'esclarecer [e1]: esclarece una contradicción sin resolver'],
    evidencia: ['ev-cob-si', 'ev-cob-no'],
    procedencia: "capacidad 'Comprender el estado' v1 sobre ECE ece-pyme-01",
    incertidumbre: 'heredada de las operaciones compuestas (no elevada)',
    limitaciones: ['evidencia faltante o inconclusa'],
    faltante: ['evidencia faltante o inconclusa'],
    contradiccionesAbiertas: ['esclarecimiento conserva una contradicción sin resolver', 'detección: tensión: contradicción'],
    cuestionesJuicioHumano: ['cuál representación prevalece corresponde al juicio humano', 'la decisión corresponde a la persona'],
    abstenido: false,
    causaAbstencion: null,
    pasoAfectado: null,
    bindingDecision: false,
  },
  intermedios: [detectar, esclarecer],
};

export const resultadoAbstenido: ResultadoExperiencia = {
  ...resultadoLimitado,
  executionId: 'ce-demo-2',
  estado: 'abstenida',
  producto: {
    ...resultadoLimitado.producto!,
    abstenido: true,
    causaAbstencion: 'operación intermedia abstenida (evidencia_insuficiente)',
    pasoAfectado: 'e1',
    contradiccionesAbiertas: [],
    faltante: ['comprensión con tensiones sobre la que orientar'],
  },
  intermedios: [{ ...detectar, abstenido: true, causaAbstencion: 'evidencia_insuficiente' }],
};
