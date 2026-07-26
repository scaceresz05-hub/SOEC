/**
 * Agnosticismo del rubro: un `RubroKnowledgePort` distinto (otras señales/mapeos) se
 * procesa por el MISMO motor, sin condicionales por slug ni conocimiento embebido.
 */
import { describe, it, expect } from 'vitest';
import type { Estrategia, Mapeo, Objetivo, RubroKnowledgePort, Senal } from '@soec/rubros';
import { proponerEstrategia } from '../src/index';
import { comp, candidatosDe } from './helpers';
import type { HechoComprendido } from '@soec/diagnostico';

const A = {
  origen: 't',
  motivo: 't',
  incorporado: '2026-07-22',
  apareceEn: 'v1',
  cambio: 'i',
} as const;

const senal: Senal = {
  ...A,
  tipo: 'senal',
  id: 'SIG-X-01',
  nombre: 'SENAL_X',
  preguntaId: '¿X?',
  condicionActivacion: { operador: 'IGUAL_A', valor: true },
  estado: 'RATIFIED',
  confianza: 'HIGH',
};
const objetivo: Objetivo = {
  ...A,
  tipo: 'objetivo',
  id: 'OBJ-X-01',
  objetivo: 'Objetivo X',
  metrica: 'u/mes',
  estado: 'RATIFIED',
  confianza: 'HIGH',
};
const estrategia: Estrategia = {
  ...A,
  tipo: 'estrategia',
  id: 'EST-X-01',
  estrategia: 'Estrategia X',
  atiende: ['OBJ-X-01'],
  activadores: [],
  estado: 'RATIFIED',
  confianza: 'MEDIUM',
};
const mapeo: Mapeo = {
  ...A,
  tipo: 'mapeo',
  id: 'MAP-X-01',
  senalId: 'SIG-X-01',
  objetivoId: 'OBJ-X-01',
  estrategiaId: 'EST-X-01',
  porque: 'x',
  estado: 'RATIFIED',
  confianza: 'HIGH',
};

function portFalso(): RubroKnowledgePort {
  return {
    rubroId: () => 'otro-rubro',
    version: () => ({
      biblioteca: '9.9.9',
      huellaCompleta: 'f'.repeat(64),
      huellaCorta: 'f'.repeat(12),
    }),
    objetivosElegibles: () => [objetivo],
    estrategiasDe: (id) => (id === 'OBJ-X-01' ? [estrategia] : []),
    metricas: () => [],
    embudos: () => [],
    supuestos: () => [],
    restriccionesGenerales: () => [],
    restriccionesRegulatorias: () => [],
    preguntasDiagnosticas: () => ['¿X?'],
    senales: () => [senal],
    mapeos: () => [mapeo],
  };
}

const hechoX: HechoComprendido = {
  preguntaId: '¿X?',
  afirmacionId: 'af-x',
  evidenciaIds: ['ev-x'],
  enunciado: 'sí',
  valor: true,
};

describe('@soec/estrategia · agnóstico del rubro', () => {
  it('deriva candidatos del rubro alternativo por señal/mapeo, misma frontera', () => {
    const r = proponerEstrategia(comp({ hechos: [hechoX] }), portFalso());
    expect(candidatosDe(r).map((c) => c.objetivoId)).toEqual(['OBJ-X-01']);
    expect(candidatosDe(r)[0]!.procedencia.entradasRubro).toContain('MAP-X-01');
  });
});
