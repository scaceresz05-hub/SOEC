/**
 * @soec/motor-operacion · aplicación · adaptador de ejecución DETERMINISTA y SIMULADO.
 *
 * Implementa `PuertoEjecucionSimulada` sin canal/proveedor/gasto real (patrón de `@soec/ejecucion-simulada`).
 * El escenario se decide por configuración inyectada (por capacidad); por defecto EXITO. La idempotencia de
 * efectos NO vive aquí (la gobierna el servicio por `claveEfecto`): este adaptador solo emula el resultado.
 * `naturaleza` es SIEMPRE 'SIMULADA'. El sandbox productivo de M4 se enchufaría en su lugar tras ratificación.
 */
import type { EscenarioSimulado, PeticionEjecucion, PuertoEjecucionSimulada, ResultadoEjecucion } from '../contratos';
import type { ResultadoIntento } from '../dominio/evidencia';

const MAPA: Readonly<Record<EscenarioSimulado, { resultado: ResultadoIntento; codigoError: string | null; reintentable: boolean }>> = {
  EXITO: { resultado: 'EJECUTADA_SIMULADA', codigoError: null, reintentable: false },
  FALLO_TEMPORAL: { resultado: 'FALLIDA_TEMPORAL', codigoError: 'TEMPORAL', reintentable: true },
  FALLO_PERMANENTE: { resultado: 'FALLIDA_PERMANENTE', codigoError: 'PERMANENTE', reintentable: false },
  RECHAZO: { resultado: 'RECHAZADA', codigoError: 'RECHAZO_POLITICA', reintentable: false },
};

export class AdaptadorEjecucionSimulado implements PuertoEjecucionSimulada {
  /** Escenario por capacidad; por defecto EXITO. Determinista (sin azar). */
  constructor(private readonly porCapacidad: Readonly<Record<string, EscenarioSimulado>> = {}) {}

  async ejecutar(peticion: PeticionEjecucion): Promise<ResultadoEjecucion> {
    const esc = this.porCapacidad[peticion.capacidad] ?? 'EXITO';
    const m = MAPA[esc];
    return { resultado: m.resultado, codigoError: m.codigoError, reintentable: m.reintentable, naturaleza: 'SIMULADA' };
  }
}
