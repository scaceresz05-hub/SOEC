/**
 * @soec/adaptadores · dominio · DESCRIPTOR DE ADAPTADOR (M4-C-C, F-CBH-1). Autoridad INMUTABLE de las
 * capacidades declaradas de un adaptador. `soportaReal` (y demás capacidades) se obtienen de AQUÍ —del
 * descriptor persistido—, nunca de la instancia mutable. Huella canónica determinista (FNV-1a sobre
 * serialización con claves ordenadas): reordenar propiedades NO cambia la huella; cambiar una capacidad SÍ.
 * No contiene proveedor comercial, secretRef, valor secreto, SDK ni payload de proveedor.
 */
import { congelarProfundo } from './inmutable';
import { fnv1a } from './hash';

export interface CapacidadesDeclaradas {
  readonly soportaSimulado: boolean;
  readonly soportaReal: boolean;
  readonly soportaHealthCheck: boolean;
  readonly soportaCancelacion: boolean;
  readonly soportaTimeout: boolean;
}

export interface DescriptorAdaptador {
  readonly adaptadorId: string;
  readonly capacidadId: string;
  readonly contratoId: string;
  readonly contratoVersion: string;
  readonly implementacionVersion: string;
  readonly evidenciaSchemaVersion: string;
  readonly capacidades: CapacidadesDeclaradas;
  readonly descriptorVersion: number;
  readonly huella: string;
}

/** Contenido del descriptor SIN metadatos de versión/huella; base para la huella canónica. */
export type ContenidoDescriptor = Omit<DescriptorAdaptador, 'descriptorVersion' | 'huella'>;

/** Serialización canónica: claves ordenadas recursivamente (independiente del orden de propiedades). */
function canonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(',')}}`;
}

export function huellaDescriptor(contenido: ContenidoDescriptor): string {
  return fnv1a(canonico(contenido));
}

/** Construye un descriptor inmutable (profundamente congelado) con su huella canónica. */
export function crearDescriptor(contenido: ContenidoDescriptor, descriptorVersion: number): DescriptorAdaptador {
  return congelarProfundo({ ...contenido, descriptorVersion, huella: huellaDescriptor(contenido) });
}

/** `soportaReal` AUTORITATIVO: proviene del descriptor persistido, jamás de la instancia. */
export function descriptorSoportaReal(descriptor: DescriptorAdaptador | null): boolean {
  return descriptor?.capacidades.soportaReal === true;
}
