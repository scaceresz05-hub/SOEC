/**
 * Fixture de prueba: un rubro mínimo DISTINTO de «Clínica Dental», usado solo para
 * demostrar que el motor es agnóstico del rubro (se carga por la misma frontera, sin
 * condiciones por slug). No es un rubro de producto y vive exclusivamente en test/.
 */
import type { RubroKnowledge } from '../../src/domain/tipos';

const DEF = {
  origen: 'fixture de prueba',
  incorporado: '2026-07-22',
  apareceEn: 'v0.1',
  cambio: 'creación inicial',
  motivo: 'fixture de agnosticismo',
} as const;

export const rubroMinimo: RubroKnowledge = {
  rubroId: 'rubro-demo',
  version: '0.1.0',
  objetivos: [
    {
      ...DEF,
      tipo: 'objetivo',
      id: 'OBJ-DEMO-01',
      objetivo: 'Objetivo demo',
      metrica: 'unidades/mes',
      estado: 'RATIFIED',
      confianza: 'MEDIUM',
    },
  ],
  estrategias: [
    {
      ...DEF,
      tipo: 'estrategia',
      id: 'EST-DEMO-01',
      estrategia: 'Estrategia demo',
      atiende: ['OBJ-DEMO-01'],
      activadores: [],
      estado: 'RATIFIED',
      confianza: 'MEDIUM',
    },
  ],
  metricas: [
    {
      ...DEF,
      tipo: 'metrica',
      id: 'MET-DEMO-01',
      metrica: 'unidades/mes',
      estado: 'RATIFIED',
      confianza: 'MEDIUM',
    },
  ],
  embudos: [
    {
      ...DEF,
      tipo: 'embudo',
      id: 'EMB-DEMO-01',
      etapas: ['a', 'b'],
      estado: 'RATIFIED',
      confianza: 'LOW',
    },
  ],
  restriccionesGenerales: [
    {
      ...DEF,
      tipo: 'restriccion_general',
      id: 'RES-DEMO-01',
      restriccion: 'Restricción demo',
      estado: 'RATIFIED',
      confianza: 'MEDIUM',
    },
  ],
  supuestos: [
    {
      ...DEF,
      tipo: 'supuesto',
      id: 'SUP-DEMO-01',
      supuesto: 'Supuesto demo',
      estado: 'RATIFIED',
      confianza: 'LOW',
    },
  ],
  regulatorio: [
    {
      ...DEF,
      tipo: 'regulatorio',
      id: 'REG-DEMO-01',
      regla: 'Regla demo preliminar',
      rigor: 'DURA',
      estado: 'PRELIMINARY',
      verificacion: 'PENDING_LEGAL_REVIEW',
      observa: [],
      efecto: 'ADVIERTE',
      confianza: 'LOW',
    },
  ],
  producto: [
    {
      ...DEF,
      tipo: 'producto',
      id: 'PRD-DEMO-01',
      clave: 'preguntas_diagnosticas',
      preguntas: ['¿Pregunta demo?'],
      estado: 'RATIFIED',
      confianza: 'MEDIUM',
    },
  ],
  senales: [],
  mapeos: [],
};
