/**
 * @soec/adaptadores · dominio · INTEGRIDAD INSTANCIA ↔ DESCRIPTOR (M4-C-C, F-CBH-1). La instancia entregada
 * al orquestador es ENTRADA NO CONFIABLE. Se valida contra el descriptor persistido (autoridad): identidad,
 * capacidad, versión de implementación y contrato deben coincidir. La instancia NO puede ampliar las
 * capacidades declaradas por el descriptor; un monkey-patch de la instancia no cambia la autoridad, porque
 * `soportaReal` proviene del descriptor, no de la instancia.
 */
import type { AdaptadorExterno } from '../port/adaptador-externo';
import type { DescriptorAdaptador } from './descriptor';
import type { RegistroAdaptador } from './registro-adaptador';

export interface VeredictoIntegridad {
  readonly ok: boolean;
  readonly motivo: string;
}

/**
 * Valida la instancia contra el descriptor persistido del registro. Si no hay descriptor, no hay nada que
 * validar aquí (la autorización REAL lo exige por separado). Con descriptor, exige coherencia estricta.
 */
export function validarInstanciaContraDescriptor(registro: RegistroAdaptador, adaptador: AdaptadorExterno): VeredictoIntegridad {
  const d: DescriptorAdaptador | null = registro.descriptor;
  if (!d) return { ok: true, motivo: '' };
  if (adaptador.nombre !== d.adaptadorId) return { ok: false, motivo: `adaptadorId de instancia (${adaptador.nombre}) ≠ descriptor (${d.adaptadorId})` };
  if (adaptador.capacidad !== d.capacidadId) return { ok: false, motivo: `capacidadId de instancia ≠ descriptor` };
  if (adaptador.version !== d.implementacionVersion) return { ok: false, motivo: `implementacionVersion de instancia (${adaptador.version}) ≠ descriptor (${d.implementacionVersion})` };
  return { ok: true, motivo: '' };
}
