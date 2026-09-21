/**
 * apps/api · GOBIERNO · KILL SWITCH de mutaciones externas.
 *
 * Un solo lugar responde a la pregunta «¿puede este despliegue modificar algo fuera de SOEC?». Cuando está
 * activo, NINGUNA campaña, presupuesto, keyword, anuncio, puja ni pausa automática puede ejecutarse: la
 * denegación ocurre en el dominio (`evaluarMutacionExterna`), antes de construir cualquier petición.
 *
 * DEFECTO: habilitadas. Apagarlas es una decisión explícita del operador — `SOEC_EXTERNAL_MUTATIONS=off` —
 * y no se puede volver a encender desde una petición HTTP: el interruptor es del despliegue, no del usuario.
 * Se aceptan `off`, `false`, `no`, `disabled` y `0` para que un valor razonable no quede ignorado en
 * silencio; cualquier otro valor deja las mutaciones habilitadas y se refleja en el read model de salud.
 */
const APAGADOS: ReadonlySet<string> = new Set(['off', 'false', 'no', 'disabled', '0']);

export interface EstadoKillSwitch {
  readonly mutacionesExternasHabilitadas: boolean;
  /** Valor crudo declarado (sin interpretar), para que el operador vea qué está configurado. */
  readonly valorDeclarado: string | null;
}

export function estadoKillSwitch(env: NodeJS.ProcessEnv): EstadoKillSwitch {
  const crudo = env.SOEC_EXTERNAL_MUTATIONS ?? null;
  const apagado = crudo !== null && APAGADOS.has(crudo.trim().toLowerCase());
  return { mutacionesExternasHabilitadas: !apagado, valorDeclarado: crudo };
}

/** Atajo booleano para los puntos de decisión. */
export function mutacionesExternasHabilitadas(env: NodeJS.ProcessEnv): boolean {
  return estadoKillSwitch(env).mutacionesExternasHabilitadas;
}
