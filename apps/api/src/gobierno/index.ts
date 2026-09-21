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

/**
 * Evaluador de la pausa de seguridad con la BASE como fuente: `business_governance` manda, y el registro
 * histórico queda como respaldo mientras dure la migración. Async porque leer la postura es una consulta,
 * no una constante de código: una empresa puede cambiarla sin reiniciar el proceso.
 */
export function crearEvaluadorPausaSeguridad(
  leerGobierno: (org: string) => Promise<{ readonly automaticSafetyPause: boolean } | null>,
  env: NodeJS.ProcessEnv,
): (org: string) => Promise<VeredictoMutacion> {
  return async (org: string) => {
    let habilitada: boolean;
    try {
      const g = await leerGobierno(org);
      habilitada = g !== null ? g.automaticSafetyPause : pausaSeguridadHabilitada(org);
    } catch {
      habilitada = pausaSeguridadHabilitada(org); // la base caída no puede desproteger a quien ya estaba protegido
    }
    return evaluarMutacionExterna('SAFETY_PAUSE', {
      modo: 'OBSERVE',
      mutacionesExternasHabilitadas: mutacionesExternasHabilitadas(env),
      pausaSeguridadHabilitada: habilitada,
    });
  };
}

export type { ClaseMutacion, ContextoMutacion, VeredictoMutacion };
