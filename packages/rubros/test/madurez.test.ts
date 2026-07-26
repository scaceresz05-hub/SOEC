/**
 * Política de madurez (criterio 2): la elegibilidad por defecto es SOLO_RATIFICADO;
 * PRELIMINARY solo aparece bajo solicitud explícita; DRAFT y DEPRECATED NUNCA aparecen.
 */
import { describe, it, expect } from 'vitest';
import type { RubroKnowledge } from '../src/domain/tipos';
import { crearBiblioteca } from '../src/domain/port';
import type { EstadoMadurez, Objetivo } from '../src/index';

const A = {
  origen: 't',
  motivo: 't',
  incorporado: '2026-07-22',
  apareceEn: 'v1',
  cambio: 'inicial',
} as const;

function o(id: string, estado: EstadoMadurez): Objetivo {
  return { ...A, tipo: 'objetivo', id, objetivo: id, metrica: 'm', confianza: 'MEDIUM', estado };
}

const data: RubroKnowledge = {
  rubroId: 'x',
  version: '1',
  objetivos: [o('R', 'RATIFIED'), o('P', 'PRELIMINARY'), o('D', 'DRAFT'), o('X', 'DEPRECATED')],
  estrategias: [],
  metricas: [],
  embudos: [],
  restriccionesGenerales: [],
  supuestos: [],
  regulatorio: [],
  producto: [],
  senales: [],
  mapeos: [],
};

describe('@soec/rubros · política de madurez', () => {
  const port = crearBiblioteca(data);

  it('por defecto (SOLO_RATIFICADO) solo devuelve RATIFIED', () => {
    expect(port.objetivosElegibles().map((x) => x.id)).toEqual(['R']);
  });

  it('INCLUIR_PRELIMINAR añade PRELIMINARY, pero nunca DRAFT ni DEPRECATED', () => {
    const ids = port.objetivosElegibles('INCLUIR_PRELIMINAR').map((x) => x.id);
    expect(ids).toEqual(['R', 'P']);
    expect(ids).not.toContain('D');
    expect(ids).not.toContain('X');
  });

  it('DRAFT y DEPRECATED no aparecen bajo ninguna política', () => {
    for (const politica of ['SOLO_RATIFICADO', 'INCLUIR_PRELIMINAR'] as const) {
      const ids = port.objetivosElegibles(politica).map((x) => x.id);
      expect(ids).not.toContain('D');
      expect(ids).not.toContain('X');
    }
  });
});
