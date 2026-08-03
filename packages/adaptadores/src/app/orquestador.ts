/**
 * @soec/adaptadores · aplicación · ORQUESTADOR OPERATIVO (M4-C-B). Compone la cadena de gobernanza y delega
 * la EJECUCIÓN en el sandbox autoritativo (M4-C-A-H). Orden: estado/expiración/revocación (operativo) →
 * compatibilidad → salud (fail-safe) → circuit breaker → concurrencia → retry gobernado → SANDBOX →
 * evidencia operativa. No duplica `esConsumible` (M4-A, lo aplica el sandbox), `esReferenciaSecreto` (M4-B,
 * lo aplica el sandbox) ni la autoridad de identidad/tenant/evidencia (el sandbox). Determinista y neutral:
 * sin red/SDK/reloj (el instante se inyecta; la duración se declara SIMULADA en este bloque).
 */
import type { RequestContext } from '@soec/contracts';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import type { AdaptadorExterno, ResultadoAdaptador, SolicitudAdaptador } from '../port/adaptador-externo';
import type { EstadoAdaptador, ModoAdaptador } from '../domain/estado-adaptador';
import type { EvidenciaEjecucion } from '../domain/evidencia';
import { Sandbox } from './sandbox';
import { blindar } from '../domain/inmutable';
import { type ClaseErrorAdaptador, errorNormalizado } from '../domain/errores-normalizados';
import { type RegistroAdaptador, puedeConsumirOperativo } from '../domain/registro-adaptador';
import { type EstadoCircuitBreaker, type LimiteConcurrencia, type PoliticaCircuitBreaker, type PoliticaRetry } from '../domain/operativo-tipos';
import { evaluarBreaker, registrarResultadoBreaker } from '../domain/circuit-breaker';
import { RETRY_DESHABILITADO, decidirRetry } from '../domain/retry';
import { LimitadorConcurrencia } from '../domain/concurrencia';
import { verificarCompatibilidad, type SolicitudCompatibilidad } from '../domain/compatibilidad';
import { type HealthCheckAdaptador, efectoSalud } from '../domain/health';
import { EVIDENCIA_OPERATIVA_VERSION, type EvidenciaOperativa } from '../domain/observabilidad';

export interface OpcionesOrquestacion {
  readonly observadoEn: string;
  readonly modoDeseado?: ModoAdaptador;
  readonly estadoFrontera?: EstadoAdaptador;
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
    const modo: ModoAdaptador = opciones.modoDeseado ?? 'SIMULADO';
    const org = String(ctx.organizationId);

    const rechazo = (codigo: ClaseErrorAdaptador, intento: number, breaker: EstadoCircuitBreaker, limiteAlcanzado = false): ResultadoOrquestacion => ({
      resultado: null,
      evidenciaSandbox: null,
      evidenciaOperativa: this.evidencia(registro, codigo, intento, breaker.estado, false, limiteAlcanzado, opciones.observadoEn),
      breaker,
    });

    // 1) estado operativo (incluye revocación/expiración/pausa).
    const opGate = puedeConsumirOperativo(registro, opciones.observadoEn);
    if (!opGate.ok) return rechazo('NO_AUTORIZADO', 0, registro.circuitBreaker);

    // 2) compatibilidad.
    if (opciones.compatSolicitada && registro.compatibilidad) {
      const compat = verificarCompatibilidad(opciones.compatSolicitada, registro.compatibilidad);
      if (!compat.compatible) return rechazo('INVALIDO', 0, registro.circuitBreaker);
    }

    // 3) salud (fail-safe). Health check sintético puede endurecer la salud del registro.
    let salud = registro.salud;
    if (opciones.healthCheck) {
      const h = await opciones.healthCheck.comprobar({ ctx, adaptadorId: registro.adaptadorId, capacidadId: registro.capacidadId, observadoEn: opciones.observadoEn });
      if (h.estado === 'NO_CONFIABLE') salud = 'NO_CONFIABLE';
      else if (h.estado === 'DEGRADADA' && salud !== 'NO_CONFIABLE') salud = 'DEGRADADA';
    }
    if (!efectoSalud(salud, modo).permite) return rechazo('NO_DISPONIBLE', 0, registro.circuitBreaker);

    // 4) circuit breaker.
    const evalBreaker = evaluarBreaker(registro.circuitBreaker, opciones.politicaBreaker, opciones.observadoEn);
    if (!evalBreaker.permitido) return rechazo('NO_DISPONIBLE', 0, evalBreaker.estado);
    let breaker = evalBreaker.estado;

    // 5) concurrencia (liberación garantizada).
    const limitador = opciones.limitador ?? new LimitadorConcurrencia();
    const liberar = opciones.limite ? limitador.adquirir(org, registro.adaptadorId, registro.capacidadId, opciones.limite) : () => {};
    if (!liberar) return rechazo('LIMITE', 0, breaker, true);

    try {
      // 6) ejecución con retry gobernado (sin sleep real: determinismo).
      const politica = opciones.politicaRetry ?? RETRY_DESHABILITADO;
      let intento = 1;
      let res = await this.sandbox.ejecutar(adaptador, ctx, solicitud, capacidad, opciones.observadoEn, {
        signal: opciones.signal,
        modoDeseado: modo,
        estadoAdaptador: opciones.estadoFrontera,
      });
      while (res.resultado.estado === 'ERROR' && res.resultado.error) {
        const d = decidirRetry(politica, intento, res.resultado.error.clase);
        if (!d.reintentar) break;
        intento += 1;
        res = await this.sandbox.ejecutar(adaptador, ctx, solicitud, capacidad, opciones.observadoEn, {
          signal: opciones.signal,
          modoDeseado: modo,
          estadoAdaptador: opciones.estadoFrontera,
        });
      }

      const exito = res.resultado.estado === 'OK';
      breaker = registrarResultadoBreaker(breaker, opciones.politicaBreaker, exito, opciones.observadoEn);
      const codigo = exito ? null : (res.resultado.error?.clase ?? 'DESCONOCIDO');
      return {
        resultado: res.resultado,
        evidenciaSandbox: res.evidencia,
        evidenciaOperativa: this.evidencia(registro, codigo, intento, breaker.estado, intento > 1, false, opciones.observadoEn),
        breaker,
      };
    } finally {
      liberar();
    }
  }

  private evidencia(
    registro: RegistroAdaptador,
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
