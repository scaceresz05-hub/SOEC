/**
 * @soec/adaptadores · aplicación · SMOKE REAL OPT-IN (M4-C-B, contrato BLOQUEADO). Define la forma de una
 * futura ejecución de smoke contra un proveedor REAL, pero NO implementa red ni ejecución. En M4-C-B:
 * deshabilitado por defecto, requiere confirmación humana explícita, `verify` nunca lo ejecuta y ninguna
 * variable de entorno por sí sola lo activa. Aquí sólo se valida que el contrato nazca bloqueado.
 */
export interface ConfiguracionSmokeReal {
  readonly habilitado: boolean;
  readonly confirmacionHumana: string;
  readonly organizationId: string;
  readonly adaptadorId: string;
  readonly capacidadId: string;
}

export const SMOKE_REAL_BLOQUEADO: ConfiguracionSmokeReal = {
  habilitado: false,
  confirmacionHumana: '',
  organizationId: '',
  adaptadorId: '',
  capacidadId: '',
};

export type VeredictoSmokeReal = { readonly permitido: false; readonly motivo: string };

/**
 * Evalúa si el smoke REAL podría ejecutarse. En M4-C-B SIEMPRE devuelve `permitido:false` (no hay red ni
 * proveedor). Exige `habilitado` + `confirmacionHumana` + identidad completa como pre-requisitos futuros;
 * su ausencia es un rechazo. NUNCA ejecuta nada real.
 */
export function evaluarSmokeReal(config: ConfiguracionSmokeReal): VeredictoSmokeReal {
  if (!config.habilitado) return { permitido: false, motivo: 'smoke real deshabilitado (default)' };
  if (!config.confirmacionHumana?.trim()) return { permitido: false, motivo: 'falta confirmación humana explícita' };
  if (!config.organizationId?.trim() || !config.adaptadorId?.trim() || !config.capacidadId?.trim()) {
    return { permitido: false, motivo: 'identidad incompleta' };
  }
  // Incluso con todo presente, M4-C-B no conecta proveedores reales: bloqueado por diseño.
  return { permitido: false, motivo: 'smoke real no disponible en M4-C-B (sin proveedor/red)' };
}
