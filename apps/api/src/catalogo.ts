/**
 * Catálogo GOBERNADO de organizaciones y departamentos de demostración (F2-PILOT-00).
 *
 * Reemplaza la selección por texto libre: el usuario elige de una lista cerrada; los
 * identificadores internos nunca se escriben a mano. Impide typos, espacios, mayúsculas
 * inconsistentes y combinaciones inexistentes. NO es un módulo de administración de
 * organizaciones: es el mínimo gobernado para un piloto reproducible. El único rubro con
 * conocimiento ratificado es `clinica-dental`, por eso todos los departamentos lo usan.
 */
export interface DepartamentoDemo {
  readonly id: string;
  readonly nombre: string;
  readonly rubroId: string;
}
export interface OrganizacionDemo {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion: string;
  readonly departamentos: readonly DepartamentoDemo[];
}

const DEP_MARKETING: DepartamentoDemo = {
  id: 'marketing',
  nombre: 'Marketing',
  rubroId: 'clinica-dental',
};

export const CATALOGO: readonly OrganizacionDemo[] = [
  {
    id: 'clinica-brille',
    nombre: 'Clínica Brille',
    descripcion:
      'Caso A — evidencia suficiente: señales claras y una propuesta con confianza razonable.',
    departamentos: [DEP_MARKETING],
  },
  {
    id: 'clinica-nova',
    nombre: 'Clínica Nova',
    descripcion:
      'Caso B — evidencia incompleta: faltantes, incertidumbre y cobertura parcial o abstención.',
    departamentos: [DEP_MARKETING],
  },
  {
    id: 'clinica-aurora',
    nombre: 'Clínica Aurora',
    descripcion:
      'Caso C — información ambigua o corregida: un valor no normalizable, una corrección y una regeneración.',
    departamentos: [DEP_MARKETING],
  },
];

export function organizacion(orgId: string): OrganizacionDemo | undefined {
  return CATALOGO.find((o) => o.id === orgId);
}

export function departamento(orgId: string, depId: string): DepartamentoDemo | undefined {
  return organizacion(orgId)?.departamentos.find((d) => d.id === depId);
}

/** Error de selección: organización o departamento fuera del catálogo gobernado. */
export class SeleccionInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'SeleccionInvalidaError';
  }
}

/** Valida (org, dep) contra el catálogo y devuelve el rubro habilitado, o lanza. */
export function validarSeleccion(orgId: string, depId: string): DepartamentoDemo {
  const dep = departamento(orgId, depId);
  if (!dep) {
    throw new SeleccionInvalidaError(
      `Combinación organización/departamento no válida: ${orgId} / ${depId}`,
    );
  }
  return dep;
}
