/**
 * Reconciliación (F2-CHAN-01 §13). Resuelve divergencias entre el estado local y el
 * remoto (publicación local desconocida, remota existente, timeout, webhook perdido,
 * retiro externo, duplicado…). Produce un hallazgo con evidencia, resolución, nuevo
 * estado y necesidad de intervención. Nunca sobrescribe contradicciones en silencio.
 */
import type { EstadoRemoto } from './ports';
import type { EstadoPublicacion } from './publication';

export type TipoReconciliacion =
  | 'confirmada_remota' // remoto existe y está publicado → confirmar local
  | 'sin_rastro_remoto' // remoto no existe → el envío no llegó; reintentable
  | 'retirada_externa' // remoto eliminado fuera de SOEC → reflejar retiro
  | 'estado_remoto_divergente' // remoto en otro estado → requiere intervención
  | 'sin_cambios';

export interface HallazgoReconciliacion {
  readonly tipo: TipoReconciliacion;
  readonly evidencia: string;
  readonly resolucion: string;
  readonly nuevoEstado: EstadoPublicacion;
  readonly externalRef: string | null;
  readonly requiereIntervencion: boolean;
}

/**
 * Reconcilia una publicación local (posiblemente en estado `desconocida`) contra el
 * resultado de consultar al proveedor por su clave de idempotencia o referencia.
 */
export function reconciliar(estadoLocal: EstadoPublicacion, remoto: EstadoRemoto | null): HallazgoReconciliacion {
  if (!remoto || !remoto.existe) {
    return {
      tipo: 'sin_rastro_remoto',
      evidencia: 'el proveedor no tiene rastro de la publicación (por clave de idempotencia ni referencia)',
      resolucion: 'el envío no se materializó; la publicación puede reintentarse sin duplicar',
      nuevoEstado: 'fallida',
      externalRef: null,
      requiereIntervencion: false,
    };
  }
  if (remoto.status === 'deleted') {
    return {
      tipo: 'retirada_externa',
      evidencia: `el objeto remoto ${remoto.externalRef} fue eliminado fuera de SOEC`,
      resolucion: 'reflejar el retiro externo en el estado local',
      nuevoEstado: 'retirada',
      externalRef: remoto.externalRef,
      requiereIntervencion: false,
    };
  }
  if (remoto.status === 'published') {
    return {
      tipo: 'confirmada_remota',
      evidencia: `el objeto remoto ${remoto.externalRef} existe y está publicado`,
      resolucion: 'confirmar la publicación local a partir del estado remoto',
      nuevoEstado: 'verificada',
      externalRef: remoto.externalRef,
      requiereIntervencion: false,
    };
  }
  if (remoto.status === 'processing' || remoto.status === 'accepted') {
    return {
      tipo: 'confirmada_remota',
      evidencia: `el objeto remoto ${remoto.externalRef} existe y está en '${remoto.status}'`,
      resolucion: 'el proveedor aún procesa; conservar la referencia y verificar más tarde',
      nuevoEstado: 'procesando',
      externalRef: remoto.externalRef,
      requiereIntervencion: false,
    };
  }
  return {
    tipo: 'estado_remoto_divergente',
    evidencia: `estado remoto inesperado: '${remoto.status}'`,
    resolucion: 'no se sobrescribe en silencio; requiere intervención humana',
    nuevoEstado: 'reconciliando',
    externalRef: remoto.externalRef,
    requiereIntervencion: true,
  };
}
