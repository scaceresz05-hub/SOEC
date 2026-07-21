/**
 * Motor de autorización (ADR-0009 D-3) — permitir/denegar con motivo, auditable.
 * Ninguna acción operativa procede sin política vigente que la autorice.
 */
import type { AccionPropuesta, Decision } from './action';
import { type PolicyState, versionVigente } from './policy';

function deniega(motivo: Decision['motivo'], detalle: string, policyVersion: number | null, riesgo: Decision['riesgo']): Decision {
  return { permitida: false, motivo, detalle, policyVersion, riesgo };
}

/** Nivel mínimo de autonomía que auto-ejecuta acciones cubiertas por política. */
const NIVEL_MINIMO_EJECUCION = 3;

export function evaluarAutorizacion(
  state: PolicyState,
  accion: AccionPropuesta,
  presupuestoConsumido: number,
): Decision {
  const v = versionVigente(state);
  if (!state.existe) return deniega('sin_politica', 'no existe una política para esta empresa', null, null);
  if (!v) return deniega('politica_no_vigente', `la política no está vigente (estado: ${state.estado})`, state.vigente, null);

  const riesgo = v.riesgoPorAccion[accion.tipo] ?? 'medio';

  if (v.accionesProhibidas.includes(accion.tipo)) {
    return deniega('accion_prohibida', `el tipo de acción '${accion.tipo}' está prohibido por la política`, v.version, riesgo);
  }
  if (!v.canalesAutorizados.includes(accion.canal)) {
    return deniega('canal_no_autorizado', `el canal '${accion.canal}' no está autorizado`, v.version, riesgo);
  }
  const afirmacion = v.afirmacionesProhibidas.find((a) => a && accion.contenido.toLowerCase().includes(a.toLowerCase()));
  if (afirmacion) {
    return deniega('afirmacion_prohibida', `el contenido incluye una afirmación prohibida: "${afirmacion}"`, v.version, riesgo);
  }
  if (riesgo === 'alto' || v.accionesRequierenAprobacion.includes(accion.tipo)) {
    return deniega('requiere_aprobacion', `la acción requiere aprobación humana explícita (riesgo ${riesgo})`, v.version, riesgo);
  }
  if (v.nivelAutonomia < NIVEL_MINIMO_EJECUCION) {
    return deniega('nivel_autonomia_insuficiente', `el nivel de autonomía ${v.nivelAutonomia} no autoriza ejecución (mínimo ${NIVEL_MINIMO_EJECUCION})`, v.version, riesgo);
  }
  if (presupuestoConsumido + accion.costo > v.presupuestoTotal) {
    return deniega(
      'presupuesto_excedido',
      `la acción (costo ${accion.costo}) excede el presupuesto: consumido ${presupuestoConsumido} de ${v.presupuestoTotal}`,
      v.version,
      riesgo,
    );
  }
  return { permitida: true, motivo: null, detalle: 'autorizada por la política vigente', policyVersion: v.version, riesgo };
}
