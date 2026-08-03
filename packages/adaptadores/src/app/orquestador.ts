/**
 * @soec/adaptadores · aplicación · ORQUESTADOR OPERATIVO (M4-C-B, endurecido en M4-C-B-H). Compone la cadena
 * de gobernanza y delega la EJECUCIÓN en el sandbox autoritativo (M4-C-A-H). El llamador sólo expresa una
 * INTENCIÓN de modo (`modoSolicitado`); NUNCA la autoriza (F-CB-1): el modo REAL se DERIVA de fuentes
 * autoritativas (`RegistroAdaptador.modo/estado/secretRef` + `adaptador.soportaReal()`), y el estado de
 * frontera es una PROYECCIÓN del registro (el llamador no puede fabricarla más permisiva). El resultado del
 * health check se valida como ENTRADA HOSTIL: inválido → fail-closed `NO_DISPONIBLE` (F-CB-2). No duplica
 * `esConsumible` (M4-A), `esReferenciaSecreto` (M4-B) ni la autoridad de identidad/evidencia del sandbox.
 * Orden de gates: ciclo de vida → autoridad REAL → compatibilidad → salud → breaker → concurrencia → retry
 * → sandbox → evidencia operativa. Todo rechazo temprano ocurre ANTES de concurrencia/retry/breaker/sandbox.
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
import { EVIDENCIA_OPERATIVA_VERSION, type EvidenciaOperativa, type GateRechazo } from '../domain/observabilidad';

export interface OpcionesOrquestacion {
  readonly observadoEn: string;
  /** INTENCIÓN de modo. El llamador nunca autoriza REAL; la autoridad la derivan los gates. */
  readonly modoSolicitado?: ModoAdaptador;
  readonly politicaBreaker: PoliticaCircuitBreaker;
  readonly politicaRetry?: PoliticaRetry;
  readonly limite?: LimiteConcurrencia;
  readonly limitador?: LimitadorConcurrencia;
  readonly compatSolicitada?: SolicitudCompatibilidad;
  readonly healthCheck?: HealthCheckAdaptador;
  readonly signal?: AbortSignal;
}

export interface ResultadoOrquestacion {
  readonly resultado: ResultadoAdaptador | null;
  readonly evidenciaSandbox: EvidenciaEjecucion | null;
  readonly evidenciaOperativa: EvidenciaOperativa;
  readonly breaker: EstadoCircuitBreaker;
}

export class OrquestadorAdaptadores {
  constructor(private readonly sandbox: Sandbox = new Sandbox()) {}

  async orquestar(
    adaptador: AdaptadorExterno,
    ctx: RequestContext,
    solicitud: SolicitudAdaptador,
    capacidad: CapacidadState,
    registro: RegistroAdaptador,
    opciones: OpcionesOrquestacion,
  ): Promise<ResultadoOrquestacion> {
    const modoSolicitado: ModoAdaptador = opciones.modoSolicitado ?? 'SIMULADO';
    const soporta = descriptorSoportaReal(registro.descriptor); // autoridad: descriptor, no la instancia
    const org = String(ctx.organizationId);

    const rechazo = (codigo: ClaseErrorAdaptador, gate: GateRechazo, modoAutorizado: ModoAdaptador, breaker: EstadoCircuitBreaker, limiteAlcanzado = false): ResultadoOrquestacion => ({
      resultado: null,
      evidenciaSandbox: null,
      evidenciaOperativa: this.evidencia(registro, modoSolicitado, modoAutorizado, soporta, gate, codigo, 0, breaker.estado, false, limiteAlcanzado, opciones.observadoEn),
      breaker,
    });

    // 1) ciclo de vida (existe/terminal/revocado/expirado/pausado/AUTORIZADO).
    if (!puedeConsumirOperativo(registro, opciones.observadoEn).ok) return rechazo('NO_AUTORIZADO', 'CICLO_VIDA', 'SIMULADO', registro.circuitBreaker);

    // 2) AUTORIDAD DEL MODO REAL (F-CB-1): derivada del registro + DESCRIPTOR, nunca del llamador ni la instancia.
    const autoridad = autoridadModoReal(registro, modoSolicitado);
    if (!autoridad.ok) return rechazo('NO_AUTORIZADO', 'MODO_REAL', 'SIMULADO', registro.circuitBreaker);
    const modoEjecutado = autoridad.modoEjecutado;

    // 2.5) INTEGRIDAD instancia ↔ descriptor (F-CBH-1): la instancia no puede ampliar lo declarado.
    const integridad = validarInstanciaContraDescriptor(registro, adaptador);
    if (!integridad.ok) return rechazo('INVALIDO', 'INTEGRIDAD', modoEjecutado, registro.circuitBreaker);

    // 3) compatibilidad.
    if (opciones.compatSolicitada && registro.compatibilidad) {
      if (!verificarCompatibilidad(opciones.compatSolicitada, registro.compatibilidad).compatible) return rechazo('INVALIDO', 'COMPATIBILIDAD', modoEjecutado, registro.circuitBreaker);
    }

    // 4) salud (fail-CLOSED, F-CB-2): el resultado del health check es entrada hostil.
    let salud = registro.salud;
    if (opciones.healthCheck) {
      let h;
      try {
        h = await opciones.healthCheck.comprobar({ ctx, adaptadorId: registro.adaptadorId, capacidadId: registro.capacidadId, observadoEn: opciones.observadoEn });
      } catch {
        return rechazo('NO_DISPONIBLE', 'SALUD', modoEjecutado, registro.circuitBreaker); // health lanzó → sin fuga
      }
      if (!healthValido(h)) return rechazo('NO_DISPONIBLE', 'SALUD', modoEjecutado, registro.circuitBreaker); // inválido → DESCONOCIDA/bloqueo
      if (h.estado === 'NO_CONFIABLE') salud = 'NO_CONFIABLE';
      else if (h.estado === 'DEGRADADA' && salud !== 'NO_CONFIABLE') salud = 'DEGRADADA';
    }
    if (!efectoSalud(salud, modoEjecutado).permite) return rechazo('NO_DISPONIBLE', 'SALUD', modoEjecutado, registro.circuitBreaker);

    // 5) circuit breaker.
    const evalBreaker = evaluarBreaker(registro.circuitBreaker, opciones.politicaBreaker, opciones.observadoEn);
    if (!evalBreaker.permitido) return rechazo('NO_DISPONIBLE', 'BREAKER', modoEjecutado, evalBreaker.estado);
    let breaker = evalBreaker.estado;

    // 6) concurrencia (liberación garantizada).
    const limitador = opciones.limitador ?? new LimitadorConcurrencia();
    const liberar = opciones.limite ? limitador.adquirir(org, registro.adaptadorId, registro.capacidadId, opciones.limite) : () => {};
    if (!liberar) return rechazo('LIMITE', 'CONCURRENCIA', modoEjecutado, breaker, true);

    try {
      // 7) ejecución con retry gobernado (sin sleep real: determinismo). La frontera se DERIVA del registro.
      const estadoFrontera = derivarEstadoFrontera(registro);
      const politica = opciones.politicaRetry ?? RETRY_DESHABILITADO;
      const correr = () => this.sandbox.ejecutar(adaptador, ctx, solicitud, capacidad, opciones.observadoEn, { signal: opciones.signal, modoDeseado: modoEjecutado, estadoAdaptador: estadoFrontera });
      let intento = 1;
      let res = await correr();
      while (res.resultado.estado === 'ERROR' && res.resultado.error) {
        const d = decidirRetry(politica, intento, res.resultado.error.clase);
        if (!d.reintentar) break;
        intento += 1;
        res = await correr();
      }

      const exito = res.resultado.estado === 'OK';
      breaker = registrarResultadoBreaker(breaker, opciones.politicaBreaker, exito, opciones.observadoEn);
      const codigo = exito ? null : (res.resultado.error?.clase ?? 'DESCONOCIDO');
      return {
        resultado: res.resultado,
        evidenciaSandbox: res.evidencia,
        evidenciaOperativa: this.evidencia(registro, modoSolicitado, modoEjecutado, soporta, null, codigo, intento, breaker.estado, intento > 1, false, opciones.observadoEn),
        breaker,
      };
    } finally {
      liberar();
    }
  }

  private evidencia(
    registro: RegistroAdaptador,
    modoSolicitado: ModoAdaptador,
    modoAutorizado: ModoAdaptador,
    soporta: boolean,
    gateRechazo: GateRechazo,
    codigoError: ClaseErrorAdaptador | null,
    intento: number,
    breaker: EstadoCircuitBreaker['estado'],
    retryAplicado: boolean,
    limiteAlcanzado: boolean,
    observadoEn: string,
  ): EvidenciaOperativa {
    return blindar({
      evidenciaVersion: EVIDENCIA_OPERATIVA_VERSION,
      organizationId: registro.organizationId,
      adaptadorIdLogico: registro.adaptadorId,
      capacidadId: registro.capacidadId,
      contratoId: registro.contratoId,
      contratoVersion: registro.contratoVersion,
      implementacionVersion: registro.implementacionVersion,
      estado: registro.estado,
      salud: registro.salud,
      modoSolicitado,
      modoAutorizado,
      soportaReal: soporta,
      gateRechazo,
      intento,
      duracion: 0,
      naturalezaDuracion: 'SIMULADA' as const,
      codigoError,
      breaker,
      retryAplicado,
      limiteAlcanzado,
      actorConfiguro: registro.creadoPor,
      actorAutorizo: registro.actualizadoPor,
      observadoEn,
    });
  }
}
