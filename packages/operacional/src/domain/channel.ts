/**
 * Puerto de canal (ADR-0009 D-5): los canales ingresan por adaptadores versionados
 * y reemplazables; el núcleo no se acopla a ningún proveedor. En F2-AUT-01 solo
 * existe un adaptador SIMULADO/sandbox. Un efecto externo real es causal de parada.
 */
import type { AccionPropuesta, Efecto } from './action';

export interface CanalAdapter {
  readonly nombre: string;
  readonly version: string;
  soporta(canal: string): boolean;
  /** Ejecuta el efecto (simulado). Idempotente por idempotencyKey. */
  publicar(accion: AccionPropuesta, idempotencyKey: string, signal?: AbortSignal): Promise<Efecto>;
  /** Revierte donde sea posible (simulado). */
  revertir(externalId: string): Promise<Efecto>;
}
