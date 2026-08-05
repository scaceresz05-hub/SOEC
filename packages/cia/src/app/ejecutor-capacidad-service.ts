/**
 * @soec/cia · app · EJECUTOR DE CAPACIDAD (composición CIA ↔ PCE/M4, SIMULADO).
 *
 * Éste es el corazón del BLOQUE 1: CIA deja de tener un motor de proveedores paralelo y se apoya en la
 * infraestructura canónica de M4. Dada una autorización CIA, este servicio:
 *   1. obtiene la `CapacidadState` de la PCE (autoridad de consumibilidad y degradación);
 *   2. consulta `esConsumible` (PCE) — si no lo es, traduce la degradación a lenguaje de producto y NO ejecuta;
 *   3. elige el adaptador DETRÁS de la frontera (un fake que implementa el puerto canónico);
 *   4. ejecuta por el **`OrquestadorAdaptadores` real** en modo SIMULADO (sandbox autoritativo, breaker, salud,
 *      evidencia), nunca un segundo sandbox;
 *   5. devuelve un resultado en lenguaje de producto (sin proveedor) + una referencia de evidencia para auditoría.
 *
 * `assertSimulado` garantiza que jamás se ejecuta en REAL. El proveedor concreto vive sólo en la auditoría.
 */
import type { RequestContext } from '@soec/contracts';
import { esConsumible, type PoliticaDegradacion } from '@soec/plataforma-capacidades';
import {
  OrquestadorAdaptadores, AdaptadorFake, CIRCUIT_BREAKER_CERRADO,
  type AdaptadorExterno, type RegistroAdaptador, type SolicitudAdaptador,
} from '@soec/adaptadores';
import { assertSimulado } from '../dominio/guardarrailes';
import { ProveedorCapacidadSimulado, degradacionAProducto, type ProveedorCapacidadPCE } from '../dominio/capacidad-pce';

export type MotivoEjecucion = 'EJECUTADA_SIMULADA' | 'ABSTENIDA' | 'ALTERNATIVA' | 'CACHE' | 'DETENIDA';

export interface ResultadoEjecucionCIA {
  readonly ejecutado: boolean;
  readonly motivo: MotivoEjecucion;
  /** Lenguaje de producto. NUNCA contiene proveedor, SDK, endpoint ni enum. */
  readonly mensajeProducto: string;
  /** Proveedor elegido detrás de la frontera. Sólo para auditoría. */
  readonly proveedorElegidoRef: string;
  /** Referencia a la evidencia operativa del sandbox M4 (auditoría). */
  readonly evidenciaOperativaRef: string | null;
  readonly degradacion: PoliticaDegradacion | null;
}

const POLITICA_BREAKER = { maxFallosConsecutivos: 3, ventanaMs: 60000, tiempoReaperturaMs: 30000, version: '1' } as const;

/** Selecciona el adaptador (herramienta) para un proveedor, DETRÁS de la frontera. Fake canónico, sin red. */
export function adaptadorParaProveedor(_proveedorElegidoRef: string, capacidadId: string, operacion: string): AdaptadorExterno {
  return new AdaptadorFake({ capacidad: capacidadId, respuestas: { [operacion]: { resultado: 'ok' } }, salud: 'SALUDABLE' });
}

function motivoDegradacion(p: PoliticaDegradacion | null): MotivoEjecucion {
  switch (p) {
    case 'DETENER': return 'DETENIDA';
    case 'ALTERNATIVA': return 'ALTERNATIVA';
    case 'CACHE': return 'CACHE';
    default: return 'ABSTENIDA';
  }
}

export class EjecutorCapacidadCIA {
  constructor(
    private readonly orquestador: OrquestadorAdaptadores = new OrquestadorAdaptadores(),
    private readonly pce: ProveedorCapacidadPCE = new ProveedorCapacidadSimulado(),
  ) {}

  async ejecutar(
    ctx: RequestContext,
    entrada: { capacidadTipoPCE: string; proveedorElegidoRef: string; operacion: string; instante: string },
  ): Promise<ResultadoEjecucionCIA> {
    assertSimulado('SIMULADO');
    const org = String(ctx.organizationId);
    const cap = this.pce.capacidadState(org, entrada.capacidadTipoPCE);

    // Autoridad PCE: ¿es consumible? Si no, traducir la degradación a producto y NO ejecutar.
    const veredicto = esConsumible(cap);
    if (!veredicto.consumible) {
      return {
        ejecutado: false,
        motivo: motivoDegradacion(veredicto.degradacion),
        mensajeProducto: degradacionAProducto(veredicto.degradacion),
        proveedorElegidoRef: entrada.proveedorElegidoRef,
        evidenciaOperativaRef: null,
        degradacion: veredicto.degradacion,
      };
    }

    // Ejecución por el orquestador M4 REAL, en SIMULADO (sandbox autoritativo, no un segundo sandbox).
    const adaptador = adaptadorParaProveedor(entrada.proveedorElegidoRef, cap.capacidadId, entrada.operacion);
    const solicitud: SolicitudAdaptador = {
      solicitudId: `cia-${cap.capacidadId}-${entrada.instante}`,
      capacidadId: cap.capacidadId,
      peticion: { operacion: entrada.operacion, parametros: {} },
    };
    const reg: RegistroAdaptador = {
      organizationId: org, adaptadorId: entrada.proveedorElegidoRef, capacidadId: cap.capacidadId,
      contratoId: cap.tipo, contratoVersion: '1.0.0', implementacionVersion: '1.0.0',
      estado: 'AUTORIZADO', modo: 'SIMULADO', secretRef: null, salud: 'SALUDABLE',
      compatibilidad: { contratoId: cap.tipo, versionesContratoSoportadas: ['1.0.0'], implementacionVersion: '1.0.0', evidenciaSchemaVersion: '1' },
      limites: { maxConcurrentesPorOrganizacion: 4, maxConcurrentesPorAdaptador: 4, maxConcurrentesPorCapacidad: 4, version: '1' },
      circuitBreaker: CIRCUIT_BREAKER_CERRADO, expiraEn: null, revocadoMotivo: null, reemplazadoPor: null,
      descriptor: null, nivelActivacion: 'SIMULADO', creadoPor: 'cia', actualizadoPor: 'cia',
      existe: true, terminada: false, version: 1,
    };

    const r = await this.orquestador.orquestar(adaptador, ctx, solicitud, cap, reg, {
      observadoEn: entrada.instante, politicaBreaker: POLITICA_BREAKER, modoSolicitado: 'SIMULADO',
    });
    const ok = r.resultado?.estado === 'OK';
    return {
      ejecutado: ok,
      motivo: ok ? 'EJECUTADA_SIMULADA' : 'ABSTENIDA',
      mensajeProducto: ok
        ? 'Ejecuté una versión simulada de la acción, sin efecto real, sin gasto y sin red.'
        : 'No pude completar la acción de forma segura, así que me abstuve.',
      proveedorElegidoRef: entrada.proveedorElegidoRef,
      evidenciaOperativaRef: r.evidenciaOperativa ? `evidencia-op:${r.evidenciaOperativa.capacidadId}:v${r.evidenciaOperativa.evidenciaVersion}` : null,
      degradacion: veredicto.degradacion,
    };
  }
}
