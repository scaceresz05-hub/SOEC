/**
 * @soec/cia · dominio · PUENTE a la Plataforma de Capacidades Externas (PCE, M4-A).
 *
 * CIA no reimplementa la consumibilidad ni la degradación: la AUTORIDAD es la PCE (`esConsumible`,
 * `PoliticaDegradacion`). Este puente aporta (a) un proveedor de `CapacidadState` para una capacidad PCE
 * en modo SIMULADA y (b) la traducción de la política de degradación a **lenguaje de producto**, sin exponer
 * enums ni proveedores. En preparación cerrada la capacidad nace SIMULADA y consumible; el modo REAL exige el
 * ciclo de vida gobernado de la PCE (acto humano) y las cuatro puertas del CIA.
 */
import type { CapacidadState, PoliticaDegradacion } from '@soec/plataforma-capacidades';

/** Fuente de la `CapacidadState` de la PCE para un tipo de capacidad. La autoridad es la PCE, no CIA. */
export interface ProveedorCapacidadPCE {
  capacidadState(org: string, capacidadTipoPCE: string): CapacidadState;
}

/** Proveedor por defecto: una capacidad PCE registrada en modo SIMULADA y consumible (EN_USO, salud sana). */
export class ProveedorCapacidadSimulado implements ProveedorCapacidadPCE {
  capacidadState(org: string, capacidadTipoPCE: string): CapacidadState {
    return {
      organizationId: org,
      capacidadId: capacidadTipoPCE,
      tipo: capacidadTipoPCE,
      version: 1,
      existe: true,
      estado: 'EN_USO',
      modo: 'SIMULADA',
      salud: 'SALUDABLE',
      politicaDegradacion: 'SIMULAR',
      proveedorRef: null,
      secretRef: null,
      alternativaCapacidadId: null,
      cacheRef: null,
      configVersion: 1,
      reemplazadaPor: null,
      terminada: false,
    };
  }
}

/** Traduce la política de degradación de la PCE a lenguaje de producto (sin enums, sin proveedores). */
export function degradacionAProducto(p: PoliticaDegradacion | null): string {
  switch (p) {
    case 'ABSTENER': return 'No actué porque faltaban condiciones seguras.';
    case 'SIMULAR': return 'Probé una versión simulada de la acción.';
    case 'ALTERNATIVA': return 'Probé una alternativa simulada.';
    case 'CACHE': return 'Utilicé evidencia previa en lugar de actuar de nuevo.';
    case 'DETENER': return 'Detuve la acción para proteger tu presupuesto.';
    default: return 'No pude actuar con seguridad, así que me abstuve.';
  }
}
