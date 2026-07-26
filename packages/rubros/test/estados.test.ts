/**
 * Estados de madurez y confianza (criterio 4): conjuntos cerrados; toda entrada los
 * respeta; los objetivos elegibles excluyen DRAFT por defecto y también bajo
 * INCLUIR_PRELIMINAR (el backlog nunca se propone).
 */
import { describe, it, expect } from 'vitest';
import { ESTADOS_MADUREZ, CONFIANZAS, crearBibliotecaClinicaDental } from '../src/index';
import { todasLasEntradas } from '../src/domain/tipos';
import { conocimientoClinicaDental } from '../src/rubros/clinica-dental';

describe('@soec/rubros · estados y confianza', () => {
  it('los conjuntos son cerrados y con el orden esperado', () => {
    expect(ESTADOS_MADUREZ).toEqual(['DRAFT', 'PRELIMINARY', 'RATIFIED', 'DEPRECATED']);
    expect(CONFIANZAS).toEqual(['LOW', 'MEDIUM', 'HIGH']);
  });

  it('toda entrada declara un estado y una confianza dentro del conjunto cerrado', () => {
    for (const e of todasLasEntradas(conocimientoClinicaDental)) {
      expect(ESTADOS_MADUREZ).toContain(e.estado);
      expect(CONFIANZAS).toContain(e.confianza);
    }
  });

  it('los objetivos elegibles excluyen DRAFT (backlog) por defecto y con preliminares', () => {
    const port = crearBibliotecaClinicaDental();
    expect(port.objetivosElegibles().map((o) => o.id)).toContain('OBJ-CD-01');
    expect(port.objetivosElegibles().map((o) => o.id)).not.toContain('OBJ-CD-06');
    expect(port.objetivosElegibles('INCLUIR_PRELIMINAR').map((o) => o.id)).not.toContain(
      'OBJ-CD-06',
    );
  });
});
