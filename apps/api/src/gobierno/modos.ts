/**
 * apps/api · GOBIERNO · SEMÁNTICA ÚNICA de los modos de ejecución y de las mutaciones externas.
 *
 * Antes de este módulo la semántica estaba repartida (y contradicha) entre `packages/identity` — que
 * documentaba `SUPERVISED_REAL` como «sin mutación externa» — y `authorized-execution-envelope`, donde ese
 * mismo modo habilitaba la creación real de campaña. Aquí queda UNA sola definición, y el resto del sistema
 * la consulta en vez de redefinirla:
 *
 *   OBSERVE           lectura real, análisis y recomendaciones. NINGUNA mutación externa.
 *   SUPERVISED_REAL   datos y decisiones reales; mutación externa SÓLO con autorización explícita vigente
 *                     (envelope aprobado para la acción y el canal pedidos).
 *   AUTONOMOUS_REAL   mutación externa sin aprobación por acción, SÓLO dentro de un mandato ya aprobado.
 *                     El contrato queda definido aquí; su ejecución completa no se habilita en esta fase.
 *
 * Dos reglas atraviesan los tres modos:
 *
 *   · KILL SWITCH — si las mutaciones externas están deshabilitadas, se deniega TODO, incluida la pausa de
 *     seguridad. Es el interruptor que permite afirmar `EXTERNAL_MUTATIONS_ALLOWED = NO` sin matices.
 *   · SAFETY_PAUSE — pausar una campaña por stop-loss reduce exposición financiera, así que no depende del
 *     modo ni de un envelope; depende de que la ORGANIZACIÓN la tenga habilitada explícitamente. Nunca es
 *     implícita: una organización sin política declarada NO recibe pausas automáticas.
 *
 * El modo persistido de la organización (`identity_organizations.operational_mode`) sigue siendo la fuente:
 * `PILOT` es el nombre almacenado de OBSERVE. Un valor desconocido o ausente degrada a OBSERVE (fail-closed).
 */

/** Modo de ejecución, en el vocabulario del gobierno (no el valor almacenado). */
export type ModoEjecucion = 'OBSERVE' | 'SUPERVISED_REAL' | 'AUTONOMOUS_REAL';

/**
 * Clase de mutación externa pedida. `SAFETY_PAUSE` está separada del resto porque es la única acción
 * REDUCTORA de exposición: pausar nunca crea recursos, nunca aumenta gasto y nunca reanuda nada.
 */
export type ClaseMutacion =
  | 'CREACION'      // crear campaña, grupo, anuncio, keyword, negativa
  | 'PRESUPUESTO'   // cambiar presupuesto
  | 'PUJA'          // cambiar puja o techo de CPC
  | 'KEYWORD'       // añadir/quitar/pausar keywords
  | 'ANUNCIO'       // modificar/pausar anuncios, subir creativos
  | 'ESTADO'        // pausar/reanudar manualmente
  | 'SAFETY_PAUSE'; // pausa automática por stop-loss

export interface ContextoMutacion {
  readonly modo: ModoEjecucion;
  /** false ⇒ kill switch activo: ninguna mutación externa, sin excepciones. */
  readonly mutacionesExternasHabilitadas: boolean;
  /** Autorización explícita vigente para ESTA acción (envelope aprobado, plan y canal correctos). */
  readonly autorizacionExplicita?: boolean;
  /** Mandato aprobado y vigente que cubre la acción (requisito de AUTONOMOUS_REAL). */
  readonly mandatoVigente?: boolean;
  /** La organización declaró explícitamente la pausa automática de seguridad. */
  readonly pausaSeguridadHabilitada?: boolean;
}

export type MotivoDenegacion =
  | 'EXTERNAL_MUTATIONS_DISABLED'
  | 'MODE_OBSERVE_NO_MUTATIONS'
  | 'NO_EXPLICIT_AUTHORIZATION'
  | 'NO_ACTIVE_MANDATE'
  | 'SAFETY_PAUSE_NOT_ENABLED';

export type VeredictoMutacion =
  | { readonly permitido: true; readonly motivo: 'SAFETY_PAUSE_ENABLED' | 'EXPLICIT_AUTHORIZATION' | 'ACTIVE_MANDATE' }
  | { readonly permitido: false; readonly motivo: MotivoDenegacion };

/** Traduce el modo ALMACENADO de la organización al vocabulario del gobierno. Fail-closed. */
export function modoDeOrganizacion(operationalMode: string | null | undefined): ModoEjecucion {
  if (operationalMode === 'SUPERVISED_REAL') return 'SUPERVISED_REAL';
  if (operationalMode === 'AUTONOMOUS_REAL') return 'AUTONOMOUS_REAL';
  return 'OBSERVE'; // 'PILOT', desconocido, null o error ⇒ OBSERVE
}

/**
 * ÚNICA puerta de decisión sobre mutaciones externas. Pura: no lee entorno ni base de datos; quien la llama
 * le entrega el contexto ya resuelto. Devuelve un veredicto con motivo, nunca lanza.
 */
export function evaluarMutacionExterna(clase: ClaseMutacion, ctx: ContextoMutacion): VeredictoMutacion {
  // 1) Kill switch: manda sobre todo lo demás, incluida la pausa de seguridad.
  if (!ctx.mutacionesExternasHabilitadas) return { permitido: false, motivo: 'EXTERNAL_MUTATIONS_DISABLED' };

  // 2) Pausa de seguridad: gobernada por política explícita de la organización, no por el modo.
  if (clase === 'SAFETY_PAUSE') {
    return ctx.pausaSeguridadHabilitada === true
      ? { permitido: true, motivo: 'SAFETY_PAUSE_ENABLED' }
      : { permitido: false, motivo: 'SAFETY_PAUSE_NOT_ENABLED' };
  }

  // 3) Resto de mutaciones, por modo.
  if (ctx.modo === 'OBSERVE') return { permitido: false, motivo: 'MODE_OBSERVE_NO_MUTATIONS' };
  if (ctx.modo === 'SUPERVISED_REAL') {
    return ctx.autorizacionExplicita === true
      ? { permitido: true, motivo: 'EXPLICIT_AUTHORIZATION' }
      : { permitido: false, motivo: 'NO_EXPLICIT_AUTHORIZATION' };
  }
  // AUTONOMOUS_REAL: sin mandato vigente no hay autonomía (el contrato existe aunque la ejecución completa
  // todavía no se habilite en esta fase).
  return ctx.mandatoVigente === true
    ? { permitido: true, motivo: 'ACTIVE_MANDATE' }
    : { permitido: false, motivo: 'NO_ACTIVE_MANDATE' };
}
