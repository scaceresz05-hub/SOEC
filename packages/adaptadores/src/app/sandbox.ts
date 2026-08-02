/**
 * @soec/adaptadores · aplicación · SANDBOX LOCAL de ejecución (M4-C-A, Art. 3/6/8/11 de la Directiva PCE).
 *
 * Ejecuta un adaptador bajo control de frontera:
 *  - RECHAZA ejecución REAL si la capacidad no es consumible (delega en `esConsumible` de M4-A) o si el
 *    estado de frontera no habilita REAL (`puedeEjecutarReal`). En M4-C-A todo corre SIMULADO.
 *  - NORMALIZA cualquier error, incluidas excepciones no previstas (fail-safe → DESCONOCIDO); ningún
 *    mensaje transporta secretos.
 *  - Respeta cancelación/timeout por `AbortSignal` (el timer real de wall-clock es capa opt-in de M4-C-B).
 *  - Produce EVIDENCIA REPRODUCIBLE de cada ejecución.
 * Determinista y neutral: sin red, entorno, reloj ni aleatoriedad; el instante se inyecta (`observadoEn`).
 */
import type { RequestContext } from '@soec/contracts';
import { type VeredictoConsumo } from '@soec/plataforma-capacidades';
import type { AdaptadorExterno, PeticionAdaptador, ResultadoAdaptador } from '../port/adaptador-externo';
import { type EstadoAdaptador, type ModoAdaptador, puedeEjecutarReal } from '../domain/estado-adaptador';
import { type EvidenciaEjecucion, claveEvidencia } from '../domain/evidencia';
import { errorNormalizado, normalizarError } from '../domain/errores-normalizados';

export interface OpcionesSandbox {
  readonly signal?: AbortSignal;
  /** Modo deseado de la ejecución. Por defecto SIMULADO. REAL exige estado de frontera + capacidad consumible. */
  readonly modoDeseado?: ModoAdaptador;
  /** Requerido para REAL: veredicto de consumibilidad de la capacidad viva (autoridad M4-A). */
  readonly veredicto?: VeredictoConsumo;
  /** Requerido para REAL: estado de frontera del adaptador. */
  readonly estadoAdaptador?: EstadoAdaptador;
}

export interface ResultadoSandbox {
  readonly resultado: ResultadoAdaptador;
  readonly evidencia: EvidenciaEjecucion;
}

export class Sandbox {
  async ejecutar(
    adaptador: AdaptadorExterno,
    ctx: RequestContext,
    peticion: PeticionAdaptador,
    observadoEn: string,
    opciones: OpcionesSandbox = {},
  ): Promise<ResultadoSandbox> {
    const modo: ModoAdaptador = opciones.modoDeseado ?? 'SIMULADO';
    const base = { modo, adaptador: adaptador.nombre, version: adaptador.version, observadoEn };

    const errorResultado = (r: ResultadoAdaptador): ResultadoSandbox => ({
      resultado: r,
      evidencia: this.evidencia(adaptador, peticion, r, 'NO_DISPONIBLE', observadoEn),
    });

    // Compuerta REAL: soberanía humana + consumibilidad (Art. 3/8). En M4-C-A no debería alcanzarse.
    if (modo === 'REAL') {
      const gate = opciones.estadoAdaptador ? puedeEjecutarReal(opciones.estadoAdaptador) : { ok: false, motivo: 'sin estado de frontera' };
      const consumible = opciones.veredicto?.consumible === true;
      if (!gate.ok || !consumible) {
        const motivo = !gate.ok ? gate.motivo : (opciones.veredicto?.motivo || 'capacidad no consumible');
        return errorResultado({ estado: 'ERROR', salida: null, error: errorNormalizado('NO_AUTORIZADO', motivo), ...base });
      }
    }

    // Salud para la evidencia (fail-safe si la consulta de salud falla).
    let saludEstado: EvidenciaEjecucion['salud'] = 'NO_DISPONIBLE';
    try {
      saludEstado = (await adaptador.salud(ctx, observadoEn, opciones.signal)).estado;
    } catch {
      saludEstado = 'NO_DISPONIBLE';
    }

    // Ejecución con normalización total de errores.
    let resultado: ResultadoAdaptador;
    try {
      resultado = await adaptador.ejecutar(ctx, peticion, observadoEn, opciones.signal);
    } catch (e) {
      resultado = { estado: 'ERROR', salida: null, error: normalizarError(e, opciones.signal?.aborted ? opciones.signal.reason : undefined), ...base };
    }

    return { resultado, evidencia: this.evidencia(adaptador, peticion, resultado, saludEstado, observadoEn) };
  }

  private evidencia(
    adaptador: AdaptadorExterno,
    peticion: PeticionAdaptador,
    resultado: ResultadoAdaptador,
    salud: EvidenciaEjecucion['salud'],
    observadoEn: string,
  ): EvidenciaEjecucion {
    return {
      adaptador: adaptador.nombre,
      version: adaptador.version,
      capacidad: adaptador.capacidad,
      operacion: peticion.operacion,
      clave: claveEvidencia(peticion),
      resultado,
      salud,
      observadoEn,
    };
  }
}
