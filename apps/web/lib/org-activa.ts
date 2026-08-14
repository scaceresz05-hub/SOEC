/**
 * Organización ACTIVA del panel (cliente).
 *
 * Antes, la superficie REAL (`/resultados`, observaciones, decisión de piloto) asumía implícitamente
 * SmileFlow: el backend fijaba la organización en código. Con el endurecimiento multiempresa esa
 * suposición desaparece: si no hay organización elegida, NO se piden datos y la UI lo dice.
 *
 * No hay valor por defecto. Nunca se cae en SmileFlow.
 */

const CLAVE = 'soec.org-activa';

/** Organización elegida: `?org=` manda; si no, la última elegida en este navegador. `null` si no hay. */
export function orgActiva(): string | null {
  if (typeof window === 'undefined') return null;
  const enUrl = new URLSearchParams(window.location.search).get('org');
  if (enUrl && enUrl.trim()) {
    try {
      window.localStorage.setItem(CLAVE, enUrl.trim());
    } catch {
      /* almacenamiento no disponible: la URL sigue mandando en esta vista */
    }
    return enUrl.trim();
  }
  try {
    const guardada = window.localStorage.getItem(CLAVE);
    return guardada && guardada.trim() ? guardada.trim() : null;
  } catch {
    return null;
  }
}

/** Fija el negocio activo de este navegador. Acto explícito del usuario; nunca automático. */
export function fijarOrgActiva(org: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CLAVE, org);
  } catch {
    /* almacenamiento no disponible: la selección vale sólo para esta vista */
  }
}

/**
 * Cabeceras de organización para el proxy. `x-organization-slug` es la que valida el gateway contra
 * la membresía; `x-organization-id` es la que consumen las rutas verticales.
 */
export function cabecerasOrg(org: string): Record<string, string> {
  return { 'x-organization-slug': org, 'x-organization-id': org };
}

/** Traduce el error del backend a un estado honesto de la UI (nunca "cero"). */
export function estadoNoConfigurado(codigo: string | undefined): string | null {
  switch (codigo) {
    case 'ORGANIZATION_NOT_CONFIGURED':
      return 'Este negocio todavía no está configurado en SOEC.';
    case 'BUSINESS_PROFILE_NOT_CONFIGURED':
      return 'Este negocio no tiene todavía objetivos ni criterios de evaluación configurados.';
    case 'NO_DATA_SOURCE_CONFIGURED':
      return 'Este negocio no tiene ninguna fuente de datos conectada.';
    case 'EXPERIENCE_BINDING_DENIED':
      return 'Esta vista no está habilitada para el negocio seleccionado.';
    case 'INVALID_ORGANIZATION_IDENTIFIER':
      return 'El identificador de negocio no es válido.';
    default:
      return null;
  }
}
