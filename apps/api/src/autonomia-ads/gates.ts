/**
 * apps/api · CAPA DE COMPOSICIÓN · GATES de la autonomía gobernada. PUROS y deterministas.
 * Cada intención atraviesa una cadena de puertas INDEPENDIENTES. En G1 el interruptor maestro
 * (`autonomousReal`) es SIEMPRE false ⇒ `puedeEjecutarReal` es SIEMPRE false ⇒ sólo hay DRY-RUN.
 */
import type { IntencionDeCambio } from './intencion';
import type { LimitesAutonomia } from './limites-smileflow';

export type NivelAutonomia = 'SOLO_OBSERVAR' | 'RECOMENDAR' | 'EJECUTAR_CON_APROBACION' | 'EJECUTAR_AUTOMATICO';

export interface ContextoGates {
  /** Interruptor maestro REAL (@soec/cia `AUTONOMOUS_REAL`). En G1: false (nada real ocurre). */
  readonly autonomousReal: boolean;
  readonly killSwitchActivo: boolean;
  readonly pausado: boolean; // modo seguro
  readonly nivelAutonomia: NivelAutonomia;
  readonly autorizacionVigente: boolean;
  readonly limiteDisponible: boolean;
  readonly aprobacionHumana: boolean; // para acciones HUMANA_POR_CAMBIO
  readonly cambiosHoy: number;
  readonly cooldownVigente: boolean; // true si la palanca está en cooldown
  /** Confina el efecto al tenant: el customerId autorizado (fijado por composición). */
  readonly customerIdAutorizado: string;
}

export interface Gate {
  readonly nombre: string;
  readonly paso: boolean;
  readonly detalle: string;
}

export interface ResultadoGates {
  readonly gates: readonly Gate[];
  readonly bloqueos: readonly string[];
  /** En G1 SIEMPRE false: el interruptor maestro está apagado. */
  readonly puedeEjecutarReal: boolean;
  readonly modo: 'DRY_RUN';
}

function nivelPermite(nivel: NivelAutonomia, intencion: IntencionDeCambio): boolean {
  if (intencion.autorizacionRequerida === 'NUNCA') return false;
  if (intencion.autorizacionRequerida === 'AUTOMATICA_BAJO_RIESGO') return nivel === 'EJECUTAR_AUTOMATICO';
  // HUMANA_POR_CAMBIO
  return nivel === 'EJECUTAR_CON_APROBACION' || nivel === 'EJECUTAR_AUTOMATICO';
}

export function evaluarGates(intencion: IntencionDeCambio, ctx: ContextoGates, limites: LimitesAutonomia): ResultadoGates {
  const confianzaOk = intencion.autorizacionRequerida === 'AUTOMATICA_BAJO_RIESGO'
    ? intencion.confianza === 'alta'
    : intencion.confianza === 'media' || intencion.confianza === 'alta';

  const gates: Gate[] = [
    // Confinamiento de tenant: la intención sólo puede tocar el customerId autorizado (invariante).
    { nombre: 'CONFINAMIENTO_TENANT', paso: intencion.customerId === ctx.customerIdAutorizado, detalle: `customerId de la intención (${intencion.customerId}) debe ser el autorizado (${ctx.customerIdAutorizado})` },
    // Invariante de seguridad: una acción marcada NUNCA no se habilita en ninguna etapa.
    { nombre: 'INVARIANTE_SEGURIDAD', paso: intencion.autorizacionRequerida !== 'NUNCA' && intencion.habilitacionEtapa !== 'INVARIANTE_SEGURIDAD', detalle: 'la acción no puede ser una prohibición invariante de seguridad' },
    // Habilitación de etapa: sólo las HABILITADA_G1_DRYRUN se ejercitan ahora.
    { nombre: 'HABILITACION_ETAPA', paso: intencion.habilitacionEtapa === 'HABILITADA_G1_DRYRUN', detalle: 'la acción debe estar habilitada en esta etapa (G1 dry-run)' },
    { nombre: 'KILL_SWITCH', paso: !ctx.killSwitchActivo, detalle: 'el kill switch de la organización debe estar inactivo' },
    { nombre: 'MODO_SEGURO', paso: !ctx.pausado, detalle: 'no debe estar activo el modo seguro (PAUSA)' },
    { nombre: 'NIVEL_AUTONOMIA', paso: nivelPermite(ctx.nivelAutonomia, intencion), detalle: `el nivel ${ctx.nivelAutonomia} debe permitir esta clase de acción` },
    { nombre: 'AUTORIZACION_CAPACIDAD', paso: ctx.autorizacionVigente && ctx.limiteDisponible, detalle: 'debe existir autorización de capacidad vigente con límite disponible' },
    { nombre: 'EVIDENCIA_CONFIANZA', paso: intencion.evidencia.suficiente && confianzaOk, detalle: 'evidencia suficiente y confianza mínima (alta si es automática)' },
    { nombre: 'LIMITES_FRECUENCIA_COOLDOWN', paso: ctx.cambiosHoy < limites.maxCambiosPorDia && !ctx.cooldownVigente, detalle: `≤ ${limites.maxCambiosPorDia} cambios/día y sin cooldown activo` },
    { nombre: 'APROBACION_HUMANA', paso: intencion.autorizacionRequerida !== 'HUMANA_POR_CAMBIO' || ctx.aprobacionHumana, detalle: 'las acciones humanas requieren aprobación explícita por cambio' },
    // Interruptor maestro: en G1 está APAGADO ⇒ ninguna ejecución real, sólo dry-run.
    { nombre: 'INTERRUPTOR_MAESTRO_REAL', paso: ctx.autonomousReal, detalle: 'AUTONOMOUS_REAL debe estar abierto para ejecutar de verdad (en G1: cerrado ⇒ dry-run)' },
  ];

  const bloqueos = gates.filter((g) => !g.paso).map((g) => g.nombre);
  // Ejecución REAL sólo si TODAS las puertas pasan (incluido el interruptor maestro). En G1 nunca ocurre.
  const puedeEjecutarReal = gates.every((g) => g.paso);
  return { gates, bloqueos, puedeEjecutarReal, modo: 'DRY_RUN' };
}
