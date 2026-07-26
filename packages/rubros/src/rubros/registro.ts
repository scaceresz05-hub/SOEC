/**
 * @soec/rubros · registro de rubros disponibles.
 *
 * Frontera de acceso: el conocimiento se entrega SIEMPRE como `RubroKnowledgePort`
 * mediante fábricas con nombre; la estructura cruda de la biblioteca no se expone
 * (criterio 3), de modo que ningún consumidor pueda saltarse el puerto.
 */
import type { RubroKnowledge } from '../domain/tipos';
import type { RubroKnowledgePort } from '../domain/port';
import { crearBiblioteca } from '../domain/port';
import { conocimientoClinicaDental } from './clinica-dental';

export type RubroId = 'clinica-dental';

export const RUBROS_DISPONIBLES: readonly RubroId[] = ['clinica-dental'];

const CATALOGO: Readonly<Record<string, RubroKnowledge>> = {
  'clinica-dental': conocimientoClinicaDental,
};

export class RubroDesconocidoError extends Error {
  readonly rubroId: string;
  constructor(rubroId: string) {
    super(`Rubro desconocido: ${rubroId}`);
    this.name = 'RubroDesconocidoError';
    this.rubroId = rubroId;
  }
}

/** Fábrica del rubro «Clínica Dental». Devuelve solo el puerto de consulta. */
export function crearBibliotecaClinicaDental(): RubroKnowledgePort {
  return crearBiblioteca(conocimientoClinicaDental);
}

/** Obtiene la biblioteca de un rubro por su id, como puerto de consulta. */
export function obtenerBiblioteca(rubroId: RubroId): RubroKnowledgePort {
  const data = CATALOGO[rubroId];
  if (!data) throw new RubroDesconocidoError(rubroId);
  return crearBiblioteca(data);
}
