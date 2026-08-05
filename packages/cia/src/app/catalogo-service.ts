/**
 * @soec/cia · app · CATÁLOGO de capacidades de marketing (lectura neutral).
 * Presenta los RESULTADOS que el usuario puede autorizar. Nunca expone proveedores.
 */
import { CATALOGO_MARKETING, buscarCapacidad, type CapacidadMarketing } from '../dominio/catalogo';

export interface CapacidadCatalogoVista {
  readonly id: string;
  readonly titulo: string;
  readonly descripcion: string;
  readonly unidadLimite: CapacidadMarketing['unidadLimite'];
}

export class CatalogoService {
  /** Lista el catálogo en términos de RESULTADO. Omite deliberadamente `proveedoresRef` y `capacidadTipoPCE`. */
  listar(): readonly CapacidadCatalogoVista[] {
    return CATALOGO_MARKETING.map((c) => ({ id: c.id, titulo: c.titulo, descripcion: c.descripcion, unidadLimite: c.unidadLimite }));
  }

  detalle(id: string): CapacidadCatalogoVista | null {
    const c = buscarCapacidad(id);
    return c ? { id: c.id, titulo: c.titulo, descripcion: c.descripcion, unidadLimite: c.unidadLimite } : null;
  }
}
