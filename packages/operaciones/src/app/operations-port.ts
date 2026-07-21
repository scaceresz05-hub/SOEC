/**
 * Frontera pública, estable y mínima del Sistema de Operaciones Intelectuales.
 *
 * Es la ÚNICA vía por la que una capa superior (las Capacidades, #14) consume las
 * operaciones. No expone tablas ni detalles del event store como contrato, y no
 * permite modificar la semántica del sistema de operaciones. La ruta cognitiva
 * permitida es: Capacidad → OperacionesPort → (internamente) EceReadPort.
 */
import type { RequestContext } from '@soec/contracts';
import type { SolicitudOperacion } from '../domain/mechanism';
import type { ProductoIntelectual } from '../domain/product';
import type { OiResultado } from './operations-service';

export interface OperacionesPort {
  /** Solicita una operación intelectual y devuelve un producto NO vinculante. */
  ejecutar(
    ctx: RequestContext,
    executionId: string,
    solicitud: SolicitudOperacion,
    signal?: AbortSignal,
  ): Promise<OiResultado>;
  /** Consulta el producto de una ejecución previa (por su identidad). */
  producto(ctx: RequestContext, executionId: string): Promise<ProductoIntelectual | null>;
}
