/**
 * @soec/adaptadores · aplicación · ORQUESTADOR OPERATIVO (M4-C-B/-H, resiliencia temporal en M4-C-C).
 * Compone la cadena de gobernanza y delega la EJECUCIÓN en el sandbox autoritativo (M4-C-A-H).
 *
 *  - Intención vs autoridad (F-CB-1): el llamador sólo pide `modoSolicitado`; REAL se DERIVA del registro +
 *    DESCRIPTOR persistido (`autoridadModoReal`); la frontera es proyección del registro.
 *  - Integridad instancia↔descriptor (F-CBH-1): una instancia incoherente → INVALIDO/INTEGRIDAD.
 *  - Salud fail-closed (F-CB-2): resultado de health inválido/excepción → NO_DISPONIBLE, sin fuga.
 *  - Reevaluación entre reintentos (F-CB-3): con backoff temporal, ANTES de cada nuevo intento se reevalúa
 *    la cadena de gates con el registro e instante vigentes; ninguna detención reutiliza el veredicto previo.
 *  - Single-probe SEMIABIERTO (F-CB-4): si el breaker está SEMIABIERTO se exige un LEASE único por
 *    org+adaptador; un segundo intento concurrente → NO_DISPONIBLE.
 * Orden: ciclo de vida → modo REAL → integridad → compatibilidad → salud → breaker → (lease) → concurrencia
 * → [sandbox → reevaluación]* → evidencia operativa v3. Todo recurso se libera en `finally`.
 * Determinista y neutral: sin red/SDK; el instante se inyecta; el backoff usa `ProgramadorEspera` inyectable.
 */
import type { RequestContext } from '@soec/contracts';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import type { AdaptadorExterno, ResultadoAdaptador, SolicitudAdaptador } from '../port/adaptador-externo';
import type { ModoAdaptador } from '../domain/estado-adaptador';
import type { EvidenciaEjecucion } from '../domain/evidencia';
import { Sandbox } from './sandbox';
import { blindar } from '../domain/inmutable';
import type { ClaseErrorAdaptador } from '../domain/errores-normalizados';
import { type RegistroAdaptador, puedeConsumirOperativo } from '../domain/registro-adaptador';
import { autoridadModoReal, derivarEstadoFrontera } from '../domain/autoridad-real';
import { descriptorSoportaReal } from '../domain/descriptor';
import { validarInstanciaContraDescriptor } from '../domain/integridad';
import { type EstadoCircuitBreaker, type LimiteConcurrencia, type PoliticaCircuitBreaker, type PoliticaRetry } from '../domain/operativo-tipos';
import { evaluarBreaker, registrarResultadoBreaker } from '../domain/circuit-breaker';
import { RETRY_DESHABILITADO, decidirRetry } from '../domain/retry';
import { LimitadorConcurrencia } from '../domain/concurrencia';
import { verificarCompatibilidad, type SolicitudCompatibilidad } from '../domain/compatibilidad';
import { type HealthCheckAdaptador, efectoSalud, healthValido } from '../domain/health';
import { type SaludRegistro } from '../domain/registro-adaptador';
import { CoordinadorSemiabierto } from '../domain/lease-semiabierto';
import { type ProgramadorEspera, ProgramadorEsperaInmediato, isoSumarMs } from './programador-espera';
import { EVIDENCIA_OPERATIVA_VERSION, type EvidenciaOperativa, type GateRechazo } from '../domain/observabilidad';

const LEASE_TTL_MS = 30_000;

export interface OpcionesOrquestacion {
  readonly observadoEn: string;
  readonly modoSolicitado?: ModoAdaptador;
  readonly politicaBreaker: PoliticaCircuitBreaker;
  readonly politicaRetry?: PoliticaRetry;
  readonly limite?: LimiteConcurrencia;
  readonly limitador?: LimitadorConcurrencia;
  readonly compatSolicitada?: SolicitudCompatibilidad;
  readonly healthCheck?: HealthCheckAdaptador;
  readonly signal?: AbortSignal;
  /** Coordinación de la prueba SEMIABIERTO (F-CB-4). Por defecto una nueva por invocación. */
  readonly coordinadorSemiabierto?: CoordinadorSemiabierto;
  /** Backoff entre reintentos (F-CB-3). Por defecto inmediato (determinista). */
  readonly programadorEspera?: ProgramadorEspera;
  /** Relee el registro para reevaluar gates entre reintentos. Por defecto reusa el snapshot. */
  readonly recargarRegistro?: () => Promise<RegistroAdaptador>;
  /** Instante de cada intento (1-based). Por defecto `observadoEn` constante. */
  readonly relojIntento?: (intento: number) => string;
}

export interface ResultadoOrquestacion {
  readonly resultado: ResultadoAdaptador | null;
  readonly evidenciaSandbox: EvidenciaEjecucion | null;
  readonly evidenciaOperativa: EvidenciaOperativa;
  readonly breaker: EstadoCircuitBreaker;
}

interface Preparacion {
  ok: boolean;
  gate: GateRechazo;
  codigo: ClaseErrorAdaptador | null;
  modoEjecutado: ModoAdaptador;
  breaker: EstadoCircuitBreaker;
}

export class OrquestadorAdaptadores {
  constructor(private readonly sandbox: Sandbox = new Sandbox()) {}

  /** Cadena de gates PREVIA a la ejecución (reutilizada en cada intento con el registro/instante vigentes). */
  private async evaluarGates(
    adaptador: AdaptadorExterno,
    ctx: RequestContext,
    registro: RegistroAdaptador,
    modoSolicitado: ModoAdaptador,
    instante: string,
    opciones: OpcionesOrquestacion,
  ): Promise<Preparacion> {
    const noOk = (gate: GateRechazo, codigo: ClaseErrorAdaptador, breaker: EstadoCircuitBreaker): Preparacion => ({ ok: false, gate, codigo, modoEjecutado: 'SIMULADO', breaker });

    if (opciones.signal?.aborted) return noOk('CANCELACION', 'CANCELADO', registro.circuitBreaker);
    if (!puedeConsumirOperativo(registro, instante).ok) return noOk('CICLO_VIDA', 'NO_AUTORIZADO', registro.circuitBreaker);
    const autoridad = autoridadModoReal(registro, modoSolicitado);
    if (!autoridad.ok) return noOk('MODO_REAL', 'NO_AUTORIZADO', registro.circuitBreaker);
    if (!validarInstanciaContraDescriptor(registro, adaptador).ok) return noOk('INTEGRIDAD', 'INVALIDO', registro.circuitBreaker);
    if (opciones.compatSolicitada && registro.compatibilidad && !verificarCompatibilidad(opciones.compatSolicitada, registro.compatibilidad).compatible) {
      return noOk('COMPATIBILIDAD', 'INVALIDO', registro.circuitBreaker);
    }
    let salud: SaludRegistro = registro.salud;
    if (opciones.healthCheck) {
      let h;
      try {
        h = await opciones.healthCheck.comprobar({ ctx, adaptadorId: registro.adaptadorId, capacidadId: registro.capacidadId, observadoEn: instante });
      } catch {
        return noOk('SALUD', 'NO_DISPONIBLE', registro.circuitBreaker);
      }
      if (!healthValido(h)) return noOk('SALUD', 'NO_DISPONIBLE', registro.circuitBreaker);
      if (h.estado === 'NO_CONFIABLE') salud = 'NO_CONFIABLE';
      else if (h.estado === 'DEGRADADA' && salud !== 'NO_CONFIABLE') salud = 'DEGRADADA';
    }
    if (!efectoSalud(salud, autoridad.modoEjecutado).permite) return noOk('SALUD', 'NO_DISPONIBLE', registro.circuitBreaker);
    const eb = evaluarBreaker(registro.circuitBreaker, opciones.politicaBreaker, instante);
    if (!eb.permitido) return noOk('BREAKER', 'NO_DISPONIBLE', eb.estado);
    return { ok: true, gate: null, codigo: null, modoEjecutado: autoridad.modoEjecutado, breaker: eb.estado };
  }

  async orquestar(
    adaptador: AdaptadorExterno,
    ctx: RequestContext,
    solicitud: SolicitudAdaptador,
    capacidad: CapacidadState,
    registroInicial: RegistroAdaptador,
    opciones: OpcionesOrquestacion,
  ): Promise<ResultadoOrquestacion> {
    const modoSolicitado: ModoAdaptador = opciones.modoSolicitado ?? 'SIMULADO';
    const org = String(ctx.organizationId);
    const politica = opciones.politicaRetry ?? RETRY_DESHABILITADO;
    const programador = opciones.programadorEspera ?? new ProgramadorEsperaInmediato();
    const relojIntento = opciones.relojIntento ?? (() => opciones.observadoEn);
    const breakerAntes = registroInicial.circuitBreaker.estado;

    let registro = registroInicial;
    let backoffTotal = 0;

    // Gates iniciales (intento 1).
    const prep = await this.evaluarGates(adaptador, ctx, registro, modoSolicitado, relojIntento(1), opciones);
    if (!prep.ok) {
      return this.salida(registro, modoSolicitado, prep.modoEjecutado, prep.gate, prep.gate, prep.codigo, 0, politica.maxIntentos, 0, breakerAntes, prep.breaker.estado, false, false, null, null, opciones.observadoEn);
    }

    // Lease SEMIABIERTO (F-CB-4): sólo si el breaker quedó SEMIABIERTO.
    const coord = opciones.coordinadorSemiabierto ?? new CoordinadorSemiabierto();
    let lease = null as null | ReturnType<CoordinadorSemiabierto['intentarAdquirir']>;
    const usaLease = prep.breaker.estado === 'SEMIABIERTO';
    if (usaLease) {
      const inst = relojIntento(1);
      const r = coord.intentarAdquirir(org, registro.adaptadorId, ctx.correlationId, inst, isoSumarMs(inst, LEASE_TTL_MS));
      if (!r.ok) {
        return this.salida(registro, modoSolicitado, prep.modoEjecutado, 'SEMIABIERTO', 'SEMIABIERTO', 'NO_DISPONIBLE', 0, politica.maxIntentos, 0, breakerAntes, prep.breaker.estado, false, true, null, null, opciones.observadoEn);
      }
      lease = r;
    }

    // Concurrencia (F-CB-4/orden): si no hay lease, no se toma cupo; si no hay cupo, se libera el lease.
    const limitador = opciones.limitador ?? new LimitadorConcurrencia();
    const liberarCupo = opciones.limite ? limitador.adquirir(org, registro.adaptadorId, registro.capacidadId, opciones.limite) : () => {};
    if (!liberarCupo) {
      if (lease?.ok) coord.liberar(lease.lease);
      return this.salida(registro, modoSolicitado, prep.modoEjecutado, 'CONCURRENCIA', 'CONCURRENCIA', 'LIMITE', 0, politica.maxIntentos, 0, breakerAntes, prep.breaker.estado, false, usaLease, true, null, opciones.observadoEn);
    }

    let breaker = prep.breaker;
    let gateReevaluado: GateRechazo = null;
    try {
      let intento = 1;
      const correr = (inst: string) => this.sandbox.ejecutar(adaptador, ctx, solicitud, capacidad, inst, { signal: opciones.signal, modoDeseado: prep.modoEjecutado, estadoAdaptador: derivarEstadoFrontera(registro) });
      let res = await correr(relojIntento(intento));

      while (res.resultado.estado === 'ERROR' && res.resultado.error) {
        const d = decidirRetry(politica, intento, res.resultado.error.clase);
        if (!d.reintentar) break;
        // Backoff temporal (F-CB-3).
        await programador.esperar(d.esperaMs, opciones.signal);
        backoffTotal += d.esperaMs;
        intento += 1;
        const inst = relojIntento(intento);
        // Reevaluación de gates con registro/instante vigentes.
        if (opciones.recargarRegistro) registro = await opciones.recargarRegistro();
        const rep = await this.evaluarGates(adaptador, ctx, registro, modoSolicitado, inst, opciones);
        if (!rep.ok) {
          gateReevaluado = rep.gate;
          breaker = rep.breaker;
          return this.salida(registro, modoSolicitado, prep.modoEjecutado, null, gateReevaluado, rep.codigo, intento, politica.maxIntentos, backoffTotal, breakerAntes, breaker.estado, true, usaLease, false, null, inst);
        }
        res = await correr(inst);
      }

      const exito = res.resultado.estado === 'OK';
      breaker = registrarResultadoBreaker(breaker, opciones.politicaBreaker, exito, relojIntento(intento));
      const codigo = exito ? null : (res.resultado.error?.clase ?? 'DESCONOCIDO');
      return {
        resultado: res.resultado,
        evidenciaSandbox: res.evidencia,
        evidenciaOperativa: this.evidencia(registro, modoSolicitado, prep.modoEjecutado, null, null, codigo, intento, politica.maxIntentos, backoffTotal, breakerAntes, breaker.estado, intento > 1, usaLease, false, opciones.observadoEn),
        breaker,
      };
    } finally {
      liberarCupo();
      if (lease?.ok) coord.liberar(lease.lease);
    }
  }

  private salida(
    registro: RegistroAdaptador, modoSolicitado: ModoAdaptador, modoAutorizado: ModoAdaptador, gateRechazo: GateRechazo, gateReevaluado: GateRechazo,
    codigoError: ClaseErrorAdaptador | null, intento: number, maxIntentos: number, backoffAplicadoMs: number, breakerAntes: EstadoCircuitBreaker['estado'], breakerDespues: EstadoCircuitBreaker['estado'],
    retryAplicado: boolean, leaseSemiabierto: boolean, limiteAlcanzado: boolean | null, _r: null, observadoEn: string,
  ): ResultadoOrquestacion {
    return {
      resultado: null,
      evidenciaSandbox: null,
      evidenciaOperativa: this.evidencia(registro, modoSolicitado, modoAutorizado, gateRechazo, gateReevaluado, codigoError, intento, maxIntentos, backoffAplicadoMs, breakerAntes, breakerDespues, retryAplicado, leaseSemiabierto, limiteAlcanzado === true, observadoEn),
      breaker: registro.circuitBreaker,
    };
  }

  private evidencia(
    registro: RegistroAdaptador, modoSolicitado: ModoAdaptador, modoAutorizado: ModoAdaptador, gateRechazo: GateRechazo, gateReevaluado: GateRechazo,
    codigoError: ClaseErrorAdaptador | null, intento: number, maxIntentos: number, backoffAplicadoMs: number, breakerAntes: EstadoCircuitBreaker['estado'], breakerDespues: EstadoCircuitBreaker['estado'],
    retryAplicado: boolean, leaseSemiabierto: boolean, limiteAlcanzado: boolean, observadoEn: string,
  ): EvidenciaOperativa {
    return blindar({
      evidenciaVersion: EVIDENCIA_OPERATIVA_VERSION,
      organizationId: registro.organizationId,
      adaptadorIdLogico: registro.adaptadorId,
      capacidadId: registro.capacidadId,
      contratoId: registro.contratoId,
      contratoVersion: registro.contratoVersion,
      implementacionVersion: registro.implementacionVersion,
      descriptorVersion: registro.descriptor?.descriptorVersion ?? null,
      descriptorHuella: registro.descriptor?.huella ?? null,
      estado: registro.estado,
      salud: registro.salud,
      modoSolicitado,
      modoAutorizado,
      soportaReal: descriptorSoportaReal(registro.descriptor),
      gateRechazo,
      gateReevaluado,
      intento,
      maxIntentos,
      backoffAplicadoMs,
      duracion: 0,
      naturalezaDuracion: 'SIMULADA' as const,
      codigoError,
      breaker: breakerDespues,
      breakerEstadoAntes: breakerAntes,
      breakerEstadoDespues: breakerDespues,
      leaseSemiabierto,
      retryAplicado,
      limiteAlcanzado,
      actorConfiguro: registro.creadoPor,
      actorAutorizo: registro.actualizadoPor,
      observadoEn,
    });
  }
}
