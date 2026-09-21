/**
 * apps/api · GOBIERNO · superficie única de consulta para modos, kill switch y pausa de seguridad.
 *
 * Todo punto del sistema que vaya a mutar algo fuera de SOEC pasa por aquí. No hay una segunda definición
 * de «puedo escribir» en ningún otro módulo.
 */
import { buscarNegocio } from '../plataforma';
import { estadoKillSwitch, mutacionesExternasHabilitadas } from './kill-switch';
import { evaluarMutacionExterna, modoDeOrganizacion, type ClaseMutacion, type ContextoMutacion, type VeredictoMutacion } from './modos';

export * from './modos';
export * from './kill-switch';

/**
 * ¿Declaró la organización la pausa automática de seguridad? Fail-closed: una organización sin política
 * declarada, o no registrada, NO recibe pausas automáticas.
 */
export function pausaSeguridadHabilitada(org: string): boolean {
  try {
    return buscarNegocio(org)?.politicaSeguridad?.pausaAutomatica === true;
  } catch {
    return false;
  }
}

/**
 * Veredicto sobre una PAUSA DE SEGURIDAD de la organización, resolviendo por dentro el kill switch del
 * despliegue y la política declarada. Es lo que consulta el monitor de stop-loss antes de tocar Google.
 */
export function evaluarPausaSeguridad(org: string, env: NodeJS.ProcessEnv): VeredictoMutacion {
  return evaluarMutacionExterna('SAFETY_PAUSE', {
    modo: 'OBSERVE', // irrelevante para SAFETY_PAUSE: la gobierna la política de la organización
    mutacionesExternasHabilitadas: mutacionesExternasHabilitadas(env),
    pausaSeguridadHabilitada: pausaSeguridadHabilitada(org),
  });
}

/** Contexto de gobierno de una organización, tal como lo expone el read model de salud. */
export function estadoGobierno(org: string, operationalMode: string | null | undefined, env: NodeJS.ProcessEnv): {
  readonly modo: ReturnType<typeof modoDeOrganizacion>;
  readonly mutacionesExternasHabilitadas: boolean;
  readonly killSwitchDeclarado: string | null;
  readonly pausaSeguridadHabilitada: boolean;
} {
  const ks = estadoKillSwitch(env);
  return {
    modo: modoDeOrganizacion(operationalMode),
    mutacionesExternasHabilitadas: ks.mutacionesExternasHabilitadas,
    killSwitchDeclarado: ks.valorDeclarado,
    pausaSeguridadHabilitada: pausaSeguridadHabilitada(org),
  };
}

export type { ClaseMutacion, ContextoMutacion, VeredictoMutacion };
