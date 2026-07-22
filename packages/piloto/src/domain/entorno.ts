/**
 * Entornos y modos de operación (F2-PILOT-01 §8). El estado `real_habilitado` es
 * IMPOSIBLE de alcanzar durante este bloque: se contempla por la arquitectura pero
 * queda bloqueado por guardarraíl. Cada entorno declara qué permite (gasto, visibilidad
 * externa, credenciales, reversibilidad) para que la readiness se evalúe por entorno.
 */
export type Entorno = 'sintetico' | 'emulado' | 'sandbox' | 'real_desactivado' | 'real_preparado' | 'real_habilitado';

export interface CapacidadesEntorno {
  readonly entorno: Entorno;
  readonly permiteEfectoExterno: boolean;
  readonly permiteGastoReal: boolean;
  readonly visibilidadExterna: boolean;
  readonly exigeCredencialReal: boolean;
  readonly reversible: boolean;
  readonly datosRealesPermitidos: boolean;
}

const CAP: Readonly<Record<Entorno, CapacidadesEntorno>> = {
  sintetico: { entorno: 'sintetico', permiteEfectoExterno: false, permiteGastoReal: false, visibilidadExterna: false, exigeCredencialReal: false, reversible: true, datosRealesPermitidos: false },
  emulado: { entorno: 'emulado', permiteEfectoExterno: false, permiteGastoReal: false, visibilidadExterna: false, exigeCredencialReal: false, reversible: true, datosRealesPermitidos: false },
  sandbox: { entorno: 'sandbox', permiteEfectoExterno: false, permiteGastoReal: false, visibilidadExterna: false, exigeCredencialReal: false, reversible: true, datosRealesPermitidos: false },
  real_desactivado: { entorno: 'real_desactivado', permiteEfectoExterno: false, permiteGastoReal: false, visibilidadExterna: false, exigeCredencialReal: true, reversible: false, datosRealesPermitidos: true },
  real_preparado: { entorno: 'real_preparado', permiteEfectoExterno: false, permiteGastoReal: false, visibilidadExterna: false, exigeCredencialReal: true, reversible: false, datosRealesPermitidos: true },
  real_habilitado: { entorno: 'real_habilitado', permiteEfectoExterno: true, permiteGastoReal: true, visibilidadExterna: true, exigeCredencialReal: true, reversible: false, datosRealesPermitidos: true },
};

export function capacidadesEntorno(e: Entorno): CapacidadesEntorno {
  return CAP[e];
}

/** Entornos que pueden operar durante F2-PILOT-01 (el real permanece bloqueado). */
export function entornoOperable(e: Entorno): boolean {
  return e === 'sintetico' || e === 'emulado' || e === 'sandbox';
}

/** El modo real jamás se habilita en este bloque: guardarraíl explícito. */
export function realHabilitable(): boolean {
  return false;
}
