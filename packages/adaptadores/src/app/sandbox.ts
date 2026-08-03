/**
 * @soec/adaptadores · aplicación · SANDBOX AUTORITATIVO (M4-C-A-H, Art. 3/4/6/8/11/12).
 *
 * El sandbox es la ÚNICA autoridad sobre identidad, tenant, modo, naturaleza, instante y evidencia. El
 * adaptador sólo aporta salida funcional no autoritativa. El sandbox:
 *  - deriva identidad de datos CONFIABLES (RequestContext, CapacidadState, SolicitudAdaptador, estado de
 *    frontera, adaptador registrado, instante inyectado) y valida su coherencia tenant/capacidad (C-1/C-2);
 *  - calcula la consumibilidad con `esConsumible` de M4-A (autoridad única) y traduce la degradación a una
 *    directiva explícita (C-4); valida `secretRef` con la barrera canónica de M4-B (C-6);
 *  - respeta cancelación ANTES y DESPUÉS de la espera; una respuesta tardía se descarta (C-3);
 *  - opcionalmente aplica timeout wall-clock opt-in (C-7);
 *  - valida la coherencia estructural de la salida del adaptador (C-1) y devuelve resultado + evidencia
 *    CLONADOS y CONGELADOS (C-5).
 * Núcleo determinista y neutral: sin red, entorno, reloj ni aleatoriedad (el instante se inyecta; el único
 * timer vive en la capa opt-in `carreraConTimeout`, deshabilitada por defecto).
 */
import type { RequestContext } from '@soec/contracts';
import { type CapacidadState, esConsumible, esReferenciaSecreto } from '@soec/plataforma-capacidades';
import type {
  AdaptadorExterno,
  EstadoSalud,
  Naturaleza,
  ResultadoAdaptador,
  SalidaAdaptador,
  SolicitudAdaptador,
} from '../port/adaptador-externo';
import { type EstadoAdaptador, type ModoAdaptador, puedeEjecutarReal } from '../domain/estado-adaptador';
import { type DirectivaDegradacion, POLITICA_VERSION, resolverDegradacion } from '../domain/degradacion';
import { EVIDENCIA_VERSION, type EvidenciaEjecucion } from '../domain/evidencia';
import { type ErrorNormalizado, errorNormalizado, normalizarError } from '../domain/errores-normalizados';
import { blindar } from '../domain/inmutable';
import { type PoliticaTimeout, type Programador, carreraConTimeout } from './timeout';

export interface OpcionesSandbox {
  readonly signal?: AbortSignal;
  readonly modoDeseado?: ModoAdaptador;
  readonly estadoAdaptador?: EstadoAdaptador;
  readonly timeout?: PoliticaTimeout;
  /** Inyectable para pruebas deterministas del timeout. */
  readonly programador?: Programador;
}

export interface ResultadoSandbox {
  readonly resultado: ResultadoAdaptador;
  readonly evidencia: EvidenciaEjecucion;
}

interface Identidad {
  organizationId: string;
  requestId: string;
  solicitudId: string;
  capacidadId: string;
  capacidadVersion: number;
  adaptador: string;
  version: string;
  modoSolicitado: ModoAdaptador;
}

export class Sandbox {
  async ejecutar(
    adaptador: AdaptadorExterno,
    ctx: RequestContext,
    solicitud: SolicitudAdaptador,
    capacidad: CapacidadState,
    observadoEn: string,
    opciones: OpcionesSandbox = {},
  ): Promise<ResultadoSandbox> {
    const id: Identidad = {
      organizationId: String(ctx.organizationId),
      requestId: ctx.correlationId,
      solicitudId: solicitud.solicitudId,
      capacidadId: solicitud.capacidadId,
      capacidadVersion: capacidad.configVersion,
      adaptador: adaptador.nombre,
      version: adaptador.version,
      modoSolicitado: opciones.modoDeseado ?? 'SIMULADO',
    };

    // C-2: la autoridad organizacional/capacidad viene del contexto y del estado de capacidad, jamás del
    // adaptador. Si el CapacidadState no corresponde al tenant o a la capacidad solicitada → rechazo.
    if (capacidad.organizationId !== id.organizationId || capacidad.capacidadId !== id.capacidadId) {
      return this.rechazo(id, 'SIMULADO', null, 'NO_DISPONIBLE', errorNormalizado('NO_AUTORIZADO', 'capacidad no corresponde al tenant/solicitud'), observadoEn);
    }

    // C-3 (pre): señal ya abortada → CANCELADO sin invocar al adaptador.
    if (opciones.signal?.aborted) {
      const clase = opciones.signal.reason === 'timeout' ? 'TIMEOUT' : 'CANCELADO';
      return this.rechazo(id, 'SIMULADO', null, 'NO_DISPONIBLE', errorNormalizado(clase, clase === 'TIMEOUT' ? 'se agotó el plazo' : 'ejecución cancelada'), observadoEn);
    }

    // Resolución de modo + degradación gobernada.
    const decision = this.decidirModo(id, capacidad, opciones.estadoAdaptador);
    if (!decision.ejecutar) {
      return this.rechazo(id, decision.modoEjecutado, decision.directiva, 'NO_DISPONIBLE', decision.error!, observadoEn);
    }

    // Salud (para evidencia), fail-safe.
    let salud: EstadoSalud = 'NO_DISPONIBLE';
    try {
      salud = (await adaptador.salud(ctx, opciones.signal)).estado;
    } catch {
      salud = 'NO_DISPONIBLE';
    }

    // Entrada BLINDADA (clon congelado): el adaptador no puede mutar la solicitud del sandbox (C-5).
    const solicitudSegura = blindar(solicitud);

    // Ejecución con cancelación/timeout opt-in y normalización total (C-3/C-7).
    const politica: PoliticaTimeout = opciones.timeout ?? { habilitado: false, timeoutMs: 0 };
    const carrera = await carreraConTimeout<SalidaAdaptador>(
      (signal) => adaptador.ejecutar(ctx, solicitudSegura, signal),
      politica,
      opciones.signal,
      opciones.programador,
    );

    // C-3 (post): si la señal se abortó durante la espera, se descarta cualquier respuesta.
    if (opciones.signal?.aborted && carrera.tipo === 'OK') {
      return this.rechazo(id, decision.modoEjecutado, decision.directiva, salud, errorNormalizado('CANCELADO', 'ejecución cancelada'), observadoEn);
    }

    let salida: SalidaAdaptador;
    if (carrera.tipo === 'OK') {
      const coherencia = this.validarSalida(carrera.valor);
      if (coherencia) return this.rechazo(id, decision.modoEjecutado, decision.directiva, salud, coherencia, observadoEn);
      salida = carrera.valor;
    } else if (carrera.tipo === 'TIMEOUT') {
      salida = { estado: 'ERROR', salida: null, error: errorNormalizado('TIMEOUT', 'se agotó el plazo') };
    } else if (carrera.tipo === 'CANCELADO') {
      salida = { estado: 'ERROR', salida: null, error: errorNormalizado('CANCELADO', 'ejecución cancelada') };
    } else {
      salida = { estado: 'ERROR', salida: null, error: normalizarError(carrera.error) };
    }

    return this.materializar(id, decision.modoEjecutado, decision.directiva, salud, salida, observadoEn);
  }

  /** Decide el modo ejecutado aplicando el gate REAL, la consumibilidad (M4-A) y la degradación. */
  private decidirModo(
    id: Identidad,
    capacidad: CapacidadState,
    estado: EstadoAdaptador | undefined,
  ): { ejecutar: boolean; modoEjecutado: ModoAdaptador; directiva: DirectivaDegradacion | null; error: ErrorNormalizado | null } {
    if (id.modoSolicitado === 'SIMULADO') {
      return { ejecutar: true, modoEjecutado: 'SIMULADO', directiva: null, error: null };
    }
    // REAL: soberanía humana (estado de frontera) + credencial por referencia canónica.
    const gate = estado ? puedeEjecutarReal(estado) : { ok: false, motivo: 'sin estado de frontera' };
    if (!gate.ok) return { ejecutar: false, modoEjecutado: 'SIMULADO', directiva: null, error: errorNormalizado('NO_AUTORIZADO', gate.motivo) };
    if (estado?.secretRef && !esReferenciaSecreto(estado.secretRef)) {
      return { ejecutar: false, modoEjecutado: 'SIMULADO', directiva: null, error: errorNormalizado('INVALIDO', 'secretRef no es una referencia opaca válida') };
    }
    // Consumibilidad: autoridad única M4-A.
    const veredicto = esConsumible(capacidad);
    if (veredicto.consumible && !veredicto.degradada) {
      return { ejecutar: true, modoEjecutado: 'REAL', directiva: null, error: null };
    }
    // No plenamente consumible → degradación gobernada (nunca se ignora).
    const res = resolverDegradacion(veredicto.degradacion);
    return { ejecutar: res.ejecutar, modoEjecutado: res.modoEjecutado, directiva: res.directiva, error: res.error };
  }

  /** Coherencia estructural de la salida del adaptador (C-1). Devuelve un error si es incoherente. */
  private validarSalida(s: SalidaAdaptador): ErrorNormalizado | null {
    if (s.estado === 'OK' && (s.salida === null || s.error !== null)) return errorNormalizado('INVALIDO', 'salida OK incoherente');
    if (s.estado === 'ERROR' && s.error === null) return errorNormalizado('INVALIDO', 'salida ERROR sin error');
    return null;
  }

  private materializar(
    id: Identidad,
    modoEjecutado: ModoAdaptador,
    directiva: DirectivaDegradacion | null,
    salud: EstadoSalud,
    salida: SalidaAdaptador,
    observadoEn: string,
  ): ResultadoSandbox {
    const naturaleza: Naturaleza = modoEjecutado === 'REAL' ? 'REAL' : 'SIMULADA';
    const resultado: ResultadoAdaptador = {
      estado: salida.estado,
      salida: salida.estado === 'OK' ? salida.salida : null,
      error: salida.error,
      organizationId: id.organizationId,
      requestId: id.requestId,
      solicitudId: id.solicitudId,
      capacidadId: id.capacidadId,
      adaptador: id.adaptador,
      version: id.version,
      modoSolicitado: id.modoSolicitado,
      modoEjecutado,
      naturaleza,
      observadoEn,
    };
    const evidencia: EvidenciaEjecucion = {
      evidenciaVersion: EVIDENCIA_VERSION,
      organizationId: id.organizationId,
      requestId: id.requestId,
      solicitudId: id.solicitudId,
      capacidadId: id.capacidadId,
      capacidadVersion: id.capacidadVersion,
      adaptadorIdLogico: id.adaptador,
      adaptadorVersion: id.version,
      modoSolicitado: id.modoSolicitado,
      modoEjecutado,
      naturaleza,
      observadoEn,
      politicaVersion: POLITICA_VERSION,
      degradacion: directiva,
      salud,
      resultado,
      error: salida.error,
    };
    return { resultado: blindar(resultado), evidencia: blindar(evidencia) };
  }

  private rechazo(
    id: Identidad,
    modoEjecutado: ModoAdaptador,
    directiva: DirectivaDegradacion | null,
    salud: EstadoSalud,
    error: ErrorNormalizado,
    observadoEn: string,
  ): ResultadoSandbox {
    return this.materializar(id, modoEjecutado, directiva, salud, { estado: 'ERROR', salida: null, error }, observadoEn);
  }
}
