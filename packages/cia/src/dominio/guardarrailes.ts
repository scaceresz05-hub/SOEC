/**
 * @soec/cia · dominio · GUARDARRAÍLES de preparación cerrada.
 *
 * CIA vive en preparación cerrada: construye la capacidad de ACTUAR, sin habilitarla. El modo REAL permanece
 * bloqueado hasta que se abran las cuatro puertas (validación externa suficiente · Directiva M4-D ratificada ·
 * decisiones D-1…D-7 · aprobación expresa del primer piloto). Aquí NO hay SDKs, red, OAuth, credenciales,
 * gasto, publicación ni envío: todo efecto es SIMULADO y determinista.
 */
import { CiaError, ModoRealBloqueadoError } from './errors';

/** El único interruptor global: mientras sea false, ninguna acción real puede ocurrir. */
export const AUTONOMOUS_REAL = false as const;

/** Modo operativo de todo el Centro de Integraciones en esta etapa. */
export const MODO_CIA = 'PREPARACION_CERRADA' as const;

export type ModoEjecucion = 'SIMULADO' | 'REAL';

/**
 * Puerta de modo: cualquier intento de ejecutar en REAL se rechaza mientras `AUTONOMOUS_REAL` sea false.
 * Es la garantía de que la infraestructura puede existir sin que nada actúe sobre el mundo.
 */
export function assertSimulado(modo: ModoEjecucion): void {
  if (modo === 'REAL' || AUTONOMOUS_REAL) {
    throw new ModoRealBloqueadoError(
      'Modo REAL bloqueado (preparación cerrada). El efecto real exige las cuatro puertas: validación externa, M4-D ratificada, D-1…D-7 y aprobación del piloto.',
    );
  }
}

/**
 * Frontera de neutralidad: verifica que una vista destinada al USUARIO no filtre ninguna referencia de
 * proveedor. El usuario autoriza capacidades (resultados), nunca herramientas; el proveedor concreto vive
 * detrás de la frontera y sólo aparece en la auditoría. Lanza si detecta fuga.
 */
export function verificarSinFugaDeProveedor(vistaUsuario: unknown, proveedoresRef: readonly string[]): void {
  const serial = JSON.stringify(vistaUsuario ?? {});
  for (const ref of proveedoresRef) {
    if (ref && serial.includes(ref)) {
      throw new CiaFugaProveedorError(`La vista de usuario filtró una referencia de proveedor ("${ref}"). El usuario nunca debe ver la herramienta.`);
    }
  }
}

export class CiaFugaProveedorError extends CiaError {}
