/**
 * @soec/motor-operacion · aplicación · Adaptador de ejecución sobre el SANDBOX AUTORITATIVO de M4.
 *
 * Implementa `PuertoEjecucionSimulada` REUTILIZANDO la infraestructura de `@soec/adaptadores` en modo
 * EXCLUSIVAMENTE SIMULADO: `OrquestadorAdaptadores` + sandbox autoritativo + descriptor/registro operativo
 * + health fail-closed + circuit breaker + concurrencia + cancelación + evidencia operativa. El adaptador
 * de frontera es el `AdaptadorFake` (determinista, sin red/SDK/credencial real; sólo salida no autoritativa).
 * `modoSolicitado='SIMULADO'` ⇒ el sandbox fija modo/naturaleza SIMULADO; REAL queda bloqueado.
 *
 * Así M7 NO mantiene un segundo motor operacional: reutiliza el de M4. El escenario (éxito/fallo temporal/
 * permanente/rechazo) se configura por capacidad para las pruebas; por defecto EXITO.
 */
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import {
  AdaptadorFake,
  CIRCUIT_BREAKER_CERRADO,
  OrquestadorAdaptadores,
  type RegistroAdaptador,
  type SolicitudAdaptador,
  errorNormalizado,
} from '@soec/adaptadores';
import type { EscenarioSimulado, PeticionEjecucion, PuertoEjecucionSimulada, ResultadoEjecucion } from '../contratos';
import type { ResultadoIntento } from '../dominio/evidencia';

const POLITICA_BREAKER = { maxFallosConsecutivos: 3, ventanaMs: 60000, tiempoReaperturaMs: 30000, version: '1' };
const OPERACION = 'ejecutar';

/** Escenario → (error normalizado a forzar en el fake | null=éxito, resultado M7, reintentable). */
const CONFIG: Readonly<Record<EscenarioSimulado, { clase: 'TIMEOUT' | 'INVALIDO' | 'NO_AUTORIZADO' | null; resultado: ResultadoIntento; reintentable: boolean }>> = {
  EXITO: { clase: null, resultado: 'EJECUTADA_SIMULADA', reintentable: false },
  FALLO_TEMPORAL: { clase: 'TIMEOUT', resultado: 'FALLIDA_TEMPORAL', reintentable: true },
  FALLO_PERMANENTE: { clase: 'INVALIDO', resultado: 'FALLIDA_PERMANENTE', reintentable: false },
  RECHAZO: { clase: 'NO_AUTORIZADO', resultado: 'RECHAZADA', reintentable: false },
};

export class AdaptadorSandboxM4 implements PuertoEjecucionSimulada {
  private readonly orq = new OrquestadorAdaptadores();
  constructor(private readonly porCapacidad: Readonly<Record<string, EscenarioSimulado>> = {}) {}

  private ctxDe(org: string): RequestContext {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('m7-operador'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'm7' };
  }

  private capacidad(org: string, capacidadId: string): CapacidadState {
    return { organizationId: org, capacidadId, tipo: 'op', version: 1, existe: true, estado: 'EN_USO', modo: 'SIMULADA', salud: 'SALUDABLE', politicaDegradacion: 'SIMULAR', proveedorRef: null, secretRef: 'env:OP', alternativaCapacidadId: null, cacheRef: null, configVersion: 1, reemplazadaPor: null, terminada: false };
  }

  private registro(org: string, capacidadId: string): RegistroAdaptador {
    return { organizationId: org, adaptadorId: 'op-fake', capacidadId, contratoId: capacidadId, contratoVersion: '1.0.0', implementacionVersion: '0.0.0', estado: 'AUTORIZADO', modo: 'SIMULADO', secretRef: 'env:OP', salud: 'SALUDABLE', compatibilidad: null, limites: null, circuitBreaker: CIRCUIT_BREAKER_CERRADO, expiraEn: null, revocadoMotivo: null, reemplazadoPor: null, descriptor: null, nivelActivacion: 'SIMULADO', creadoPor: 'm7', actualizadoPor: 'm7', existe: true, terminada: false, version: 1 };
  }

  async ejecutar(p: PeticionEjecucion): Promise<ResultadoEjecucion> {
    const cfg = CONFIG[this.porCapacidad[p.capacidad] ?? 'EXITO'];
    const fake = new AdaptadorFake({
      capacidad: p.capacidad,
      respuestas: { [OPERACION]: { ok: 'true', canal: p.canalLogico } },
      ...(cfg.clase ? { errorForzado: errorNormalizado(cfg.clase, 'ejecución simulada de operación') } : {}),
    });
    const solicitud: SolicitudAdaptador = { solicitudId: p.claveEfecto, capacidadId: p.capacidad, peticion: { operacion: OPERACION, parametros: {} } };
    const r = await this.orq.orquestar(
      fake, this.ctxDe(p.organizacionId), solicitud, this.capacidad(p.organizacionId, p.capacidad), this.registro(p.organizacionId, p.capacidad),
      { observadoEn: p.observadoEn, politicaBreaker: POLITICA_BREAKER, modoSolicitado: 'SIMULADO' },
    );
    // El sandbox es la autoridad: naturaleza SIMULADA garantizada por modoSolicitado='SIMULADO'.
    if (r.resultado?.estado === 'OK') return { resultado: 'EJECUTADA_SIMULADA', codigoError: null, reintentable: false, naturaleza: 'SIMULADA' };
    // Propaga la CLASE de error normalizada para que el reintento canónico (`decidirRetry`) decida sobre ella.
    return { resultado: cfg.resultado, codigoError: r.evidenciaOperativa.codigoError ?? cfg.clase ?? 'ERROR', reintentable: cfg.reintentable, naturaleza: 'SIMULADA', claseError: cfg.clase };
  }
}
