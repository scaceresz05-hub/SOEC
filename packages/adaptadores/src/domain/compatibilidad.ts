/**
 * @soec/adaptadores · dominio · COMPATIBILIDAD DE VERSIONES (M4-C-B). Antes de ejecutar, el contrato
 * solicitado, el adaptador, la evidencia y la capacidad deben coincidir. Si no → `INCOMPATIBLE`: no se
 * ejecuta ni se degrada en silencio. Función pura y determinista.
 */
import type { CompatibilidadAdaptador } from './operativo-tipos';

export interface SolicitudCompatibilidad {
  readonly contratoId: string;
  readonly contratoVersion: string;
  readonly evidenciaSchemaVersion: string;
}

export type VeredictoCompatibilidad = { readonly compatible: true } | { readonly compatible: false; readonly motivo: string };

export function verificarCompatibilidad(solicitado: SolicitudCompatibilidad, adaptador: CompatibilidadAdaptador): VeredictoCompatibilidad {
  if (solicitado.contratoId !== adaptador.contratoId) return { compatible: false, motivo: `contrato ${solicitado.contratoId} ≠ ${adaptador.contratoId}` };
  if (!adaptador.versionesContratoSoportadas.includes(solicitado.contratoVersion)) return { compatible: false, motivo: `versión de contrato ${solicitado.contratoVersion} no soportada` };
  if (solicitado.evidenciaSchemaVersion !== adaptador.evidenciaSchemaVersion) return { compatible: false, motivo: `esquema de evidencia ${solicitado.evidenciaSchemaVersion} ≠ ${adaptador.evidenciaSchemaVersion}` };
  return { compatible: true };
}
