/**
 * Agregado de publicación (F2-CHAN-01 §5, §6). Registra el ciclo completo de una
 * publicación controlada: preparación, intentos, referencia externa, verificación,
 * reconciliación, webhooks y retiro. Máquina de estados explícita; los saltos
 * inválidos se rechazan y un webhook antiguo no puede retroceder el estado. Los
 * secretos nunca entran aquí: solo referencias de credencial. Append-only.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { CanalCapabilities } from './capabilities';
import type { CategoriaError } from './errors-canal';
import type { ModoPublicacion } from './modes';
import type { PayloadCanal, ResultadoEnvioTipo } from './ports';
import type { HallazgoReconciliacion } from './reconciliation';

export type EstadoPublicacion =
  | 'preparada'
  | 'validando'
  | 'bloqueada'
  | 'lista'
  | 'enviando'
  | 'aceptada'
  | 'procesando'
  | 'publicada'
  | 'verificada'
  | 'fallida'
  | 'desconocida'
  | 'reconciliando'
  | 'retirada'
  | 'cancelada'
  | 'expirada';

export interface Intento {
  readonly intentoId: number;
  readonly resultado: ResultadoEnvioTipo;
  readonly externalRef: string | null;
  readonly categoriaError: CategoriaError | null;
  readonly mensaje: string;
  readonly en: string;
}

export const EVENTOS_PUB = {
  preparada: 'pub.preparada',
  intento: 'pub.intento',
  verificada: 'pub.verificada',
  reconciliada: 'pub.reconciliada',
  webhook: 'pub.webhook_aplicado',
  retirada: 'pub.retirada',
  cancelada: 'pub.cancelada',
  expirada: 'pub.expirada',
} as const;

export function pubStreamId(publicationId: string): string {
  return `pub:${publicationId}`;
}

const TRANSICIONES: Readonly<Record<EstadoPublicacion, readonly EstadoPublicacion[]>> = {
  preparada: ['validando', 'lista', 'bloqueada', 'cancelada'],
  validando: ['lista', 'bloqueada'],
  bloqueada: ['lista', 'cancelada'],
  lista: ['enviando', 'aceptada', 'publicada', 'procesando', 'desconocida', 'fallida', 'cancelada', 'expirada'],
  enviando: ['aceptada', 'publicada', 'procesando', 'desconocida', 'fallida'],
  aceptada: ['procesando', 'publicada', 'verificada', 'desconocida', 'fallida'],
  procesando: ['publicada', 'verificada', 'desconocida', 'fallida'],
  publicada: ['verificada', 'reconciliando', 'retirada', 'desconocida'],
  verificada: ['reconciliando', 'retirada'],
  fallida: ['enviando', 'aceptada', 'publicada', 'procesando', 'desconocida', 'reconciliando', 'lista', 'cancelada'],
  desconocida: ['reconciliando', 'enviando', 'publicada', 'verificada', 'procesando', 'fallida', 'retirada'],
  reconciliando: ['publicada', 'verificada', 'procesando', 'fallida', 'lista', 'retirada', 'desconocida'],
  retirada: [],
  cancelada: [],
  expirada: ['enviando', 'cancelada'],
};

export function transicionPubValida(desde: EstadoPublicacion, hacia: EstadoPublicacion): boolean {
  if (desde === hacia) return true;
  return (TRANSICIONES[desde] ?? []).includes(hacia);
}

export interface PublicationState {
  readonly publicationId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly paqueteRef: string;
  readonly canal: string;
  readonly cuentaLogica: string;
  readonly credencialId: string;
  readonly modo: ModoPublicacion | '';
  readonly capacidades: CanalCapabilities | null;
  readonly payload: PayloadCanal | null;
  readonly idempotencyKey: string;
  readonly policyVersion: number | null;
  readonly estado: EstadoPublicacion;
  readonly motivoBloqueo: string | null;
  readonly externalRef: string | null;
  readonly estadoRemoto: string | null;
  readonly intentos: readonly Intento[];
  readonly webhooksAplicados: readonly string[];
  readonly reconciliaciones: readonly HallazgoReconciliacion[];
  readonly requiereIntervencion: boolean;
  readonly historial: readonly { estado: EstadoPublicacion; en: string }[];
}

export function estadoInicialPub(publicationId: string, organizationId: string): PublicationState {
  return {
    publicationId,
    organizationId,
    version: 0,
    existe: false,
    paqueteRef: '',
    canal: '',
    cuentaLogica: '',
    credencialId: '',
    modo: '',
    capacidades: null,
    payload: null,
    idempotencyKey: '',
    policyVersion: null,
    estado: 'preparada',
    motivoBloqueo: null,
    externalRef: null,
    estadoRemoto: null,
    intentos: [],
    webhooksAplicados: [],
    reconciliaciones: [],
    requiereIntervencion: false,
    historial: [],
  };
}

export interface PayloadPreparada {
  paqueteRef: string;
  canal: string;
  cuentaLogica: string;
  credencialId: string;
  modo: ModoPublicacion;
  capacidades: CanalCapabilities;
  payload: PayloadCanal;
  idempotencyKey: string;
  policyVersion: number | null;
  estado: EstadoPublicacion; // 'lista' | 'bloqueada'
  motivoBloqueo: string | null;
}
interface PayloadIntento {
  intento: Intento;
  nuevoEstado: EstadoPublicacion;
  externalRef: string | null;
}
interface PayloadVerificada {
  externalRef: string;
  estadoRemoto: string;
  nuevoEstado: EstadoPublicacion;
}
interface PayloadReconciliada {
  hallazgo: HallazgoReconciliacion;
}
interface PayloadWebhook {
  webhookId: string;
  tipo: string;
  status: string;
  nuevoEstado: EstadoPublicacion;
}
interface PayloadRetirada {
  externalRef: string;
  motivo: string;
}

function conHistorial(state: PublicationState, next: PublicationState, nuevoEstado: EstadoPublicacion, en: string): PublicationState {
  if (!transicionPubValida(state.estado, nuevoEstado)) return next; // ignora salto inválido
  if (nuevoEstado === state.estado) return { ...next, estado: nuevoEstado };
  return { ...next, estado: nuevoEstado, historial: [...state.historial, { estado: nuevoEstado, en }] };
}

export function aplicarPub(state: PublicationState, event: RecordedEvent): PublicationState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_PUB.preparada: {
      const p = event.payload as PayloadPreparada;
      return {
        ...next,
        existe: true,
        paqueteRef: p.paqueteRef,
        canal: p.canal,
        cuentaLogica: p.cuentaLogica,
        credencialId: p.credencialId,
        modo: p.modo,
        capacidades: p.capacidades,
        payload: p.payload,
        idempotencyKey: p.idempotencyKey,
        policyVersion: p.policyVersion,
        estado: p.estado,
        motivoBloqueo: p.motivoBloqueo,
        historial: [{ estado: p.estado, en: event.recordedAt }],
      };
    }
    case EVENTOS_PUB.intento: {
      const p = event.payload as PayloadIntento;
      const base = conHistorial(state, next, p.nuevoEstado, event.recordedAt);
      return { ...base, intentos: [...state.intentos, p.intento], externalRef: p.externalRef ?? state.externalRef };
    }
    case EVENTOS_PUB.verificada: {
      const p = event.payload as PayloadVerificada;
      const base = conHistorial(state, next, p.nuevoEstado, event.recordedAt);
      return { ...base, externalRef: p.externalRef, estadoRemoto: p.estadoRemoto };
    }
    case EVENTOS_PUB.reconciliada: {
      const p = event.payload as PayloadReconciliada;
      const base = conHistorial(state, next, p.hallazgo.nuevoEstado, event.recordedAt);
      return {
        ...base,
        reconciliaciones: [...state.reconciliaciones, p.hallazgo],
        externalRef: p.hallazgo.externalRef ?? state.externalRef,
        requiereIntervencion: state.requiereIntervencion || p.hallazgo.requiereIntervencion,
      };
    }
    case EVENTOS_PUB.webhook: {
      const p = event.payload as PayloadWebhook;
      if (state.webhooksAplicados.includes(p.webhookId)) return next; // dedup/replay
      const base = conHistorial(state, next, p.nuevoEstado, event.recordedAt);
      return { ...base, webhooksAplicados: [...state.webhooksAplicados, p.webhookId], estadoRemoto: p.status };
    }
    case EVENTOS_PUB.retirada: {
      const p = event.payload as PayloadRetirada;
      const base = conHistorial(state, next, 'retirada', event.recordedAt);
      return { ...base, externalRef: p.externalRef };
    }
    case EVENTOS_PUB.cancelada:
      return conHistorial(state, next, 'cancelada', event.recordedAt);
    case EVENTOS_PUB.expirada:
      return conHistorial(state, next, 'expirada', event.recordedAt);
    default:
      return next;
  }
}

export function reconstruirPub(publicationId: string, organizationId: string, events: readonly RecordedEvent[]): PublicationState {
  return events.reduce(aplicarPub, estadoInicialPub(publicationId, organizationId));
}
