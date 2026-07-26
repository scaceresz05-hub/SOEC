/**
 * Frontera pública cerrada (criterio 3): el conocimiento se entrega SOLO por fábricas
 * que devuelven `RubroKnowledgePort`. La estructura cruda del rubro y los auxiliares
 * internos NO se exportan desde `src/index.ts`, para que ningún consumidor pueda
 * saltarse el puerto (p. ej. `conocimientoClinicaDental.objetivos[0]`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/index';

const INDEX = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts');

describe('@soec/rubros · frontera pública cerrada', () => {
  it('entrega el conocimiento solo por fábricas que devuelven el puerto', () => {
    expect(typeof api.crearBibliotecaClinicaDental).toBe('function');
    expect(typeof api.obtenerBiblioteca).toBe('function');
    const port = api.crearBibliotecaClinicaDental();
    expect(typeof port.objetivosElegibles).toBe('function');
    expect(typeof port.version).toBe('function');
  });

  it('no exporta la estructura cruda ni auxiliares internos', () => {
    const prohibidos = [
      'conocimientoClinicaDental',
      'crearBiblioteca',
      'todasLasEntradas',
      'validarBiblioteca',
      'canonicalizar',
      'huellaCompleta',
      'huellaCorta',
    ];
    for (const nombre of prohibidos) {
      expect(api, `index exporta el interno ${nombre}`).not.toHaveProperty(nombre);
    }
  });

  it('src/index.ts no menciona el objeto crudo del rubro ni re-exporta en masa', () => {
    const src = readFileSync(INDEX, 'utf8');
    expect(src.includes('conocimientoClinicaDental')).toBe(false);
    expect(/export\s+\*/.test(src)).toBe(false);
  });
});
