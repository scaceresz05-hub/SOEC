/**
 * Contratos proveedor-independientes del plano de canales (F2-CHAN-01 §4). El
 * dominio jamás llama a un SDK: define puertos reemplazables. Un adaptador concreto
 * (simulado o emulado por HTTP) los realiza. No todos los canales soportan todo:
 * las capacidades lo expresan.
 */
import type { CanalCapabilities } from './capabilities';
import type { CredencialResuelta } from './credentials';
import type { ErrorPublicacion } from './errors-canal';

/** Payload específico del canal, producido por el mapper (no en la interfaz ni el worker). */
export interface PayloadCanal {
  readonly canal: string;
  readonly formato: string;
  readonly content: string;
  readonly title: string;
  readonly altText: string;
  readonly hashtags: readonly string[];
  readonly llamadaAccion: string;
  readonly urlObjetivo: string;
  /** Nº de activos con archivo REAL disponibles (no especificaciones). */
  readonly assetsReales: number;
  /** El canal exige un archivo real para publicar con imagen. */
  readonly requiereArchivoReal: boolean;
  /** Huella estable del payload (idempotencia y auditoría). */
  readonly huella: string;
  readonly mapperVersion: string;
}

export type ResultadoEnvioTipo = 'aceptada' | 'publicada' | 'desconocida' | 'rate_limited' | 'fallida';

export interface EstadoRemoto {
  readonly existe: boolean;
  readonly status: string;
  readonly externalRef: string;
  readonly publishedAt: string | null;
}

export interface ResultadoEnvio {
  readonly resultado: ResultadoEnvioTipo;
  readonly externalRef: string | null;
  readonly estadoRemoto: string | null;
  readonly error: ErrorPublicacion | null;
  readonly retryAfterMs: number | null;
}

export interface ContextoEnvio {
  readonly payload: PayloadCanal;
  readonly idempotencyKey: string;
  readonly credencial: CredencialResuelta;
  readonly capacidades: CanalCapabilities;
}

export interface CanalPublisher {
  enviar(ctx: ContextoEnvio, signal?: AbortSignal): Promise<ResultadoEnvio>;
}
export interface CanalVerifier {
  verificar(externalRef: string, credencial: CredencialResuelta): Promise<EstadoRemoto>;
}
export interface CanalReconciler {
  /** Busca en el proveedor una publicación por la clave de idempotencia (respuesta perdida). */
  buscarPorIdempotencia(idempotencyKey: string, credencial: CredencialResuelta): Promise<EstadoRemoto | null>;
}
export interface CanalRemover {
  retirar(externalRef: string, credencial: CredencialResuelta): Promise<{ ok: boolean; status: string }>;
}

/** Adaptador de canal completo, REEMPLAZABLE. Declara su modo y capacidades. */
export interface AdaptadorCanal extends CanalPublisher, CanalVerifier, CanalReconciler, CanalRemover {
  readonly nombre: string;
  readonly version: string;
  readonly modo: 'simulado' | 'sandbox';
  soporta(canal: string): boolean;
  capacidades(canal: string): CanalCapabilities;
}
