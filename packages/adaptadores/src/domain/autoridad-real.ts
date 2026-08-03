/**
 * @soec/adaptadores · dominio · AUTORIDAD DEL MODO REAL (M4-C-B-H, F-CB-1). El llamador sólo expresa una
 * INTENCIÓN (`modoSolicitado`); jamás autoriza REAL. La autorización se DERIVA de fuentes autoritativas:
 * `RegistroAdaptador` (modo/estado/secretRef) + la declaración honesta del adaptador (`soportaReal`). El
 * `EstadoAdaptador` de frontera es una PROYECCIÓN del registro, no una autoridad que el llamador pueda
 * fabricar más permisiva. Todo REAL no plenamente autorizado se rechaza (`NO_AUTORIZADO`) antes del sandbox.
 */
import type { AdaptadorExterno } from '../port/adaptador-externo';
import type { EstadoAdaptador, ModoAdaptador } from './estado-adaptador';
import type { RegistroAdaptador } from './registro-adaptador';
import { descriptorSoportaReal } from './descriptor';

/**
 * Honestidad DECLARADA por la instancia (ausente → `false`). ⚠ NO es autoridad: la autoridad de `soportaReal`
 * es el descriptor persistido (`descriptorSoportaReal`). Se conserva sólo para validar coherencia/diagnóstico.
 */
export function soportaReal(adaptador: AdaptadorExterno): boolean {
  return typeof adaptador.soportaReal === 'function' ? adaptador.soportaReal() === true : false;
}

/** Proyecta el estado de frontera DESDE el registro (no lo aporta el llamador). */
export function derivarEstadoFrontera(registro: RegistroAdaptador): EstadoAdaptador {
  return {
    activacion: registro.estado === 'AUTORIZADO' ? 'ACTIVADO' : 'DESACTIVADO',
    modo: registro.modo,
    credencial: registro.secretRef ? 'CON_CREDENCIAL' : 'SIN_CREDENCIAL',
    consumo: 'CONSUMIBLE', // sólo se deriva tras pasar la autorización de ciclo de vida
    secretRef: registro.secretRef,
  };
}

export interface AutoridadReal {
  readonly ok: boolean;
  readonly modoEjecutado: ModoAdaptador;
  readonly motivo: string;
}

/**
 * Decide el modo EJECUTADO a partir de la intención y de la AUTORIDAD del registro (modo/estado/secretRef +
 * `descriptor.soportaReal`). REAL sólo si TODO se cumple; en cualquier otro caso con intención REAL → rechazo
 * (no se degrada en silencio a SIMULADO). `soportaReal` proviene del DESCRIPTOR persistido, no de la instancia
 * mutable (F-CBH-1): un monkey-patch de la instancia no habilita REAL.
 */
export function autoridadModoReal(registro: RegistroAdaptador, modoSolicitado: ModoAdaptador): AutoridadReal {
  if (modoSolicitado !== 'REAL') return { ok: true, modoEjecutado: 'SIMULADO', motivo: '' };
  if (registro.estado !== 'AUTORIZADO') return { ok: false, modoEjecutado: 'SIMULADO', motivo: 'registro no AUTORIZADO' };
  if (registro.modo !== 'REAL') return { ok: false, modoEjecutado: 'SIMULADO', motivo: 'registro no está en modo REAL (falta acto humano)' };
  if (!registro.secretRef) return { ok: false, modoEjecutado: 'SIMULADO', motivo: 'sin secretRef operativa' };
  if (!descriptorSoportaReal(registro.descriptor)) return { ok: false, modoEjecutado: 'SIMULADO', motivo: 'el descriptor no declara soportaReal' };
  return { ok: true, modoEjecutado: 'REAL', motivo: '' };
}

/**
 * Valida que un `EstadoAdaptador` externo (si alguna vez se aporta) sea COHERENTE con el registro y el
 * adaptador. No se usa para autorizar (eso lo hace `autoridadModoReal`), sino para rechazar una frontera
 * fabricada más permisiva. Devuelve el motivo de la primera incoherencia, o cadena vacía si es coherente.
 */
export function validarCoherenciaFrontera(registro: RegistroAdaptador, frontera: EstadoAdaptador, adaptador: AdaptadorExterno): { coherente: boolean; motivo: string } {
  const esperado = derivarEstadoFrontera(registro);
  if (frontera.modo !== esperado.modo) return { coherente: false, motivo: 'modo de frontera ≠ registro' };
  if (frontera.activacion !== esperado.activacion) return { coherente: false, motivo: 'activación de frontera ≠ estado del registro' };
  if ((frontera.secretRef ?? null) !== esperado.secretRef) return { coherente: false, motivo: 'secretRef de frontera ≠ registro' };
  if (frontera.modo === 'REAL' && !soportaReal(adaptador)) return { coherente: false, motivo: 'frontera REAL con adaptador que no soporta REAL' };
  return { coherente: true, motivo: '' };
}
