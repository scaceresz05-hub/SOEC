/**
 * Frontera técnica de las operaciones intelectuales.
 *
 * La OPERACIÓN es arquitectónica (Nivel A); el MECANISMO que la realiza es
 * sustituible (Nivel C). El dominio jamás importa un SDK externo: depende solo de
 * este puerto neutral. Varios mecanismos (determinístico, IA simulada, reglas,
 * proveedores futuros) realizan el mismo contrato.
 */
import type { Attribution, RequestContext } from '@soec/contracts';
import type { EceState } from '@soec/ece';
import type { CorteEce, ProductoIntelectual, TipoOperacion } from './product';

export interface SolicitudOperacion {
  readonly operacion: TipoOperacion;
  readonly eceId: string;
  readonly proposito: string;
  /** Elemento del ECE a esclarecer/analizar (opcional). */
  readonly objetivoElementoId?: string;
  /** Horizonte para proyectar (opcional). */
  readonly horizonte?: string;
  /** Operación histórica sobre un corte del ECE (tiempo de conocimiento). */
  readonly asOfRecordedAt?: string;
  /** Selección de mecanismo autorizado (opcional). */
  readonly mecanismo?: string;
  readonly attribution: Attribution;
  readonly occurredAt: string;
  readonly idempotencyKey?: string;
  /** Presupuesto técnico: tiempo máximo (ms). */
  readonly maxMs?: number;
  readonly dataPolicy?: 'may-leave-org' | 'must-stay-internal';
}

/** Todo lo que un mecanismo necesita, ya leído del ECE por el servicio (no accede al store). */
export interface ContextoMecanismo {
  readonly operacion: TipoOperacion;
  readonly proposito: string;
  readonly eceId: string;
  readonly eceState: EceState;
  readonly eceCorte: CorteEce;
  readonly objetivoElementoId: string | null;
  readonly horizonte: string | null;
  readonly attribution: Attribution;
}

export interface MecanismoOperacion {
  readonly nombre: string;
  readonly version: string;
  /** Si el mecanismo necesitaría enviar datos fuera de la organización (política de datos). */
  readonly requiereSalidaDeOrg?: boolean;
  soporta(op: TipoOperacion): boolean;
  ejecutar(ctx: RequestContext, contexto: ContextoMecanismo, signal?: AbortSignal): Promise<ProductoIntelectual>;
}
