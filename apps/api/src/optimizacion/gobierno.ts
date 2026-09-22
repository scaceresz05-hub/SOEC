/**
 * apps/api · OPTIMIZACIÓN AUTÓNOMA · gobierno de las decisiones (función pura).
 *
 * Entre DECIDIR y EJECUTAR hay una capa que no se puede saltar. Aquí se responde, para cada propuesta:
 *
 *   ¿puede SOEC hacer ESTO, en ESTA empresa, AHORA, por su cuenta — o hace falta que lo apruebe una persona?
 *
 * Y se mantienen separadas dos autorizaciones que no se implican:
 *
 *   POLÍTICA DE AUTONOMÍA → **QUÉ** puede hacer (acciones, topes de cambio, ritmo, horario, activación).
 *   MANDATO FINANCIERO    → **CUÁNTO** puede comprometer.
 *
 * Tener dinero autorizado no autoriza a encender una campaña. Tener permiso para pausar no autoriza a subir el
 * presupuesto. Ninguna de las dos se infiere de la otra, y ninguna se infiere del modo operativo.
 */
import type { Mandato } from '../accion/mandato';
import { restanteMinor } from '../accion/mandato';
import type { PoliticaAutonomia } from './optimizacion-pg';
import type { Propuesta } from './reglas';
import { type ModoCiclo } from './optimizacion-tipos';

export type Veredicto = 'EJECUTAR' | 'PEDIR_APROBACION' | 'BLOQUEAR' | 'SOLO_REGISTRAR';

export interface ResultadoGobierno {
  readonly veredicto: Veredicto;
  readonly motivo: string;
  /** Qué puerta decidió. Sirve para explicar y para auditar, no para depurar. */
  readonly puerta: string;
}

export interface ContextoGobierno {
  readonly modo: ModoCiclo;
  readonly modoOperativo: string | null;
  readonly politica: PoliticaAutonomia;
  readonly mandato: Mandato | null;
  readonly capacidadEscritura: boolean;
  readonly gobiernoExternalMutations: boolean;
  readonly gobiernoCampaignExecution: boolean;
  readonly killSwitchAbierto: boolean;
  /**
   * ¿La META con la que se juzga el resultado ya existe? `false` mientras el negocio dijo «todavía no sé qué
   * número sería bueno» y SOEC no la ha aprendido. Es legítimo operar así —se observa y se aprende—, pero
   * nada que dependa de esa meta puede decidirse solo mientras tanto.
   */
  readonly lineaBaseConfirmada: boolean;
  /** Cambios ya aplicados hoy (cuenta contra el tope diario de la política). */
  readonly cambiosHoy: number;
  /** Horas desde el último cambio de ESTA palanca sobre ESTE objetivo. `null` ⇒ nunca. */
  readonly horasDesdeUltimoCambioDeLaPalanca: number | null;
  /** Hora local del negocio (0–23), para el horario permitido. */
  readonly horaLocal: number;
  readonly ahora: string;
}

/**
 * Acciones cuyo acierto sólo puede juzgarse contra una META. Sin ella no hay forma de saber si subir el gasto
 * o encender la campaña acerca o aleja del resultado, así que no se hacen solas.
 */
const ACCIONES_QUE_EXIGEN_META: ReadonlySet<Propuesta['accion']> = new Set([
  'ADJUST_DAILY_BUDGET', 'ADJUST_MAX_CPC', 'ENABLE_CAMPAIGN',
]);

const bloquear = (motivo: string, puerta: string): ResultadoGobierno => ({ veredicto: 'BLOQUEAR', motivo, puerta });
const aprobar = (motivo: string, puerta: string): ResultadoGobierno => ({ veredicto: 'PEDIR_APROBACION', motivo, puerta });

/**
 * Decide qué hacer con una propuesta. El orden es deliberado: primero lo que apaga todo (interruptor,
 * gobierno, mandato), luego el modo, luego los límites de la política, y sólo al final se permite ejecutar.
 */
export function gobernar(p: Propuesta, c: ContextoGobierno): ResultadoGobierno {
  // 0. SHADOW: se observa, se decide y se registra qué se habría hecho. Nunca se toca nada.
  if (c.modo === 'SHADOW') {
    return { veredicto: 'SOLO_REGISTRAR', motivo: 'modo sombra: SOEC registra qué habría hecho, sin tocar la campaña', puerta: 'MODO_SOMBRA' };
  }

  // 1. INTERRUPTOR DEL DESPLIEGUE.
  if (!c.killSwitchAbierto) return bloquear('las operaciones externas están apagadas en este despliegue', 'KILL_SWITCH');

  // 2. POSTURA DE GOBIERNO DE LA EMPRESA.
  if (!c.gobiernoExternalMutations) return bloquear('tu empresa tiene desactivadas las operaciones en plataformas externas', 'GOBIERNO_EMPRESA');
  if (!c.capacidadEscritura) return bloquear('falta el permiso «crear y modificar campañas» en Conexiones', 'CAPACIDAD_ESCRITURA');

  // 3. LA ACCIÓN TIENE QUE SER DE ESTE MUNDO: lo que no está en la política, no se hace solo.
  const permitida = c.politica.accionesPermitidas.includes(p.accion);

  // 4. MODO OPERATIVO.
  if (c.modoOperativo === 'PILOT' || c.modoOperativo === null) {
    return aprobar('tu empresa está en modo observación: SOEC propone y tú decides', 'MODO_OBSERVE');
  }
  if (c.modoOperativo === 'SUPERVISED_REAL') {
    // Todo lo que muta algo externo espera una persona. Incluida la pausa de seguridad: se propone al instante,
    // pero el camino AUTOMÁTICO de pausa es el del monitor de seguridad, no éste.
    return aprobar('modo supervisado: SOEC propone y tú apruebas antes de que cambie nada', 'MODO_SUPERVISADO');
  }
  if (c.modoOperativo !== 'AUTONOMOUS_REAL') {
    return aprobar(`modo «${c.modoOperativo}» no reconocido: se pide aprobación`, 'MODO_DESCONOCIDO');
  }

  // ── A partir de aquí: AUTONOMOUS_REAL ──

  if (!permitida) {
    return aprobar(`«${p.accion}» no está entre las acciones que autorizaste para el modo automático`, 'ACCION_NO_PERMITIDA');
  }
  if (p.riesgo === 'PROHIBITED') return bloquear('esta acción no está permitida en ninguna circunstancia', 'ACCION_PROHIBIDA');

  // 4.bis LÍNEA BASE. «Todavía no sé qué número sería bueno» es una respuesta válida, y NO significa «cualquier
  // resultado es bueno». Mientras no haya meta, subir presupuesto, subir el techo de CPC o encender una
  // campaña serían apuestas sin criterio: se dejan esperando la línea base, y las decide una persona.
  if (!c.lineaBaseConfirmada && ACCIONES_QUE_EXIGEN_META.has(p.accion)) {
    return aprobar(
      'todavía no hay una meta con la que juzgar el resultado: SOEC está aprendiéndola con tus primeros datos',
      'ESPERANDO_LINEA_BASE',
    );
  }

  // 5. ENCENDER UNA CAMPAÑA exige decirlo explícitamente. No se infiere del presupuesto ni del modo.
  if (p.accion === 'ENABLE_CAMPAIGN' && !c.politica.activacionAutonomaPermitida) {
    return aprobar('encender una campaña sola exige que lo autorices explícitamente; el presupuesto no basta', 'ACTIVACION_NO_AUTORIZADA');
  }

  // 6. DINERO: el mandato manda, y sólo para lo que compromete gasto.
  const comprometeGasto = p.impactoMaximoClp !== null && p.impactoMaximoClp > 0;
  if (comprometeGasto) {
    if (c.mandato === null) return bloquear('falta una autorización de presupuesto firmada por una persona', 'MANDATO_AUSENTE');
    if (c.mandato.killSwitch) return bloquear('la autorización de presupuesto está detenida', 'MANDATO_DETENIDO');
    if (Date.parse(c.mandato.periodEnd) <= Date.parse(c.ahora)) return bloquear('la autorización de presupuesto venció', 'MANDATO_VENCIDO');
    if (c.mandato.status !== 'AUTHORIZED' && c.mandato.status !== 'ACTIVE') return bloquear('la autorización de presupuesto no está vigente', 'MANDATO_NO_VIGENTE');
    if (p.impactoMaximoClp! > restanteMinor(c.mandato)) {
      return bloquear(`el cambio comprometería ${p.impactoMaximoClp} y sólo quedan ${restanteMinor(c.mandato)} autorizados`, 'MANDATO_INSUFICIENTE');
    }
  }

  // 7. RITMO: tope diario, cooldown y horario. Evitan que «automático» signifique «sin freno».
  if (c.politica.maxCambiosPorDia > 0 && c.cambiosHoy >= c.politica.maxCambiosPorDia) {
    return aprobar(`ya se hicieron ${c.cambiosHoy} cambios hoy y tu límite es ${c.politica.maxCambiosPorDia}`, 'TOPE_DIARIO');
  }
  if (c.horasDesdeUltimoCambioDeLaPalanca !== null && c.horasDesdeUltimoCambioDeLaPalanca < c.politica.cooldownHoras) {
    return aprobar(`se tocó esto hace ${Math.round(c.horasDesdeUltimoCambioDeLaPalanca)} h y tu espera mínima es ${c.politica.cooldownHoras} h`, 'COOLDOWN');
  }
  if (c.politica.horasPermitidas !== null && !c.politica.horasPermitidas.includes(c.horaLocal)) {
    return aprobar('fuera del horario que autorizaste para cambios automáticos', 'HORARIO');
  }

  // 8. RIESGO ALTO: incluso en automático, lo que enciende gasto nuevo se propone con su permiso explícito.
  if (p.riesgo === 'HIGH_RISK' && p.accion !== 'ENABLE_CAMPAIGN') {
    return aprobar('es una acción de riesgo alto: se pide confirmación aunque el modo sea automático', 'RIESGO_ALTO');
  }

  return { veredicto: 'EJECUTAR', motivo: 'dentro de los límites que autorizaste para el modo automático', puerta: 'AUTONOMIA' };
}

/** Valida que un cambio de presupuesto respete el tope del mandato. Devuelve el valor ACOTADO. */
export function acotarPorMandato(nuevoDiarioClp: number, mandato: Mandato | null, diasRestantes: number): { valor: number; recortado: boolean } {
  if (mandato === null || diasRestantes <= 0) return { valor: nuevoDiarioClp, recortado: false };
  const topeDiario = Math.floor(restanteMinor(mandato) / diasRestantes);
  return nuevoDiarioClp > topeDiario ? { valor: topeDiario, recortado: true } : { valor: nuevoDiarioClp, recortado: false };
}

/** Requisitos para ENCENDER una campaña. Se comprueban aparte porque activar no es «un cambio más». */
export interface RequisitosActivacion {
  readonly reconciliacionOk: boolean;
  readonly medicionVerificada: boolean;
  readonly mandatoVigente: boolean;
  readonly requisitosEjecucionOk: boolean;
  readonly conexionValida: boolean;
  readonly capacidadEscritura: boolean;
  readonly gobiernoExternalMutations: boolean;
  readonly killSwitchAbierto: boolean;
}

export interface VeredictoActivacion {
  readonly puede: boolean;
  readonly faltan: readonly string[];
}

/**
 * ¿Se dan las condiciones para pasar de PAUSED a ENABLED? Ocho condiciones, todas obligatorias. Encender es la
 * única acción de esta fase que convierte una configuración en gasto real.
 */
export function puedeActivarse(r: RequisitosActivacion): VeredictoActivacion {
  const faltan: string[] = [];
  if (!r.reconciliacionOk) faltan.push('la campaña creada todavía no coincide con lo aprobado');
  if (!r.medicionVerificada) faltan.push('la medición de resultados no está verificada');
  if (!r.mandatoVigente) faltan.push('no hay una autorización de presupuesto vigente');
  if (!r.requisitosEjecucionOk) faltan.push('faltan requisitos de la preparación de la campaña');
  if (!r.conexionValida) faltan.push('la cuenta de publicidad no está conectada');
  if (!r.capacidadEscritura) faltan.push('falta el permiso para modificar campañas');
  if (!r.gobiernoExternalMutations) faltan.push('tu empresa tiene desactivadas las operaciones externas');
  if (!r.killSwitchAbierto) faltan.push('el interruptor de seguridad del despliegue está cerrado');
  return { puede: faltan.length === 0, faltan };
}
