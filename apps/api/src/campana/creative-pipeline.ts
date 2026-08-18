/**
 * apps/api · V2-B · CREATIVE ASSET PIPELINE (dry-run + proveedor mock honesto). Convierte una pieza de
 * contenido en un BORRADOR de creatividad con una referencia SIMULADA de activo. No genera ni sube imágenes
 * reales: el proveedor mock devuelve un `assetRef` determinista y marca `esActivoReal=false`. Sirve para
 * certificar el flujo completo (creatividad → anuncio) sin infraestructura de medios real.
 */
import { createHash } from 'node:crypto';
import { validarContenido } from './content-policy';
import type { PiezaContenido } from './content-engine';

export interface BorradorCreatividad {
  readonly organizationId: string;
  readonly variante: string;
  readonly assetRef: string; // referencia SIMULADA (nunca un id real de Meta)
  readonly esActivoReal: false;
  readonly headline: string;
  readonly primaryText: string;
  readonly cta: string;
  readonly instruccionImagen: string;
  readonly conforme: boolean; // pasó la content-policy
  readonly bloqueos: readonly string[];
}

export interface ProveedorCreatividad {
  readonly esReal: boolean;
  generarBorrador(organizationId: string, pieza: PiezaContenido): BorradorCreatividad;
}

/** Proveedor mock: determinista, sin red, sin generar medios. */
export class ProveedorCreatividadMock implements ProveedorCreatividad {
  readonly esReal = false;
  generarBorrador(organizationId: string, pieza: PiezaContenido): BorradorCreatividad {
    const policy = validarContenido({ organizationId, textos: [pieza.headline, pieza.primaryText, pieza.description, pieza.cta] }, organizationId);
    const hash = createHash('sha256').update(`${organizationId}:${pieza.variante}:${pieza.headline}`).digest('hex').slice(0, 12);
    return {
      organizationId,
      variante: pieza.variante,
      assetRef: `mock-creative:${hash}`,
      esActivoReal: false,
      headline: pieza.headline,
      primaryText: pieza.primaryText,
      cta: pieza.cta,
      instruccionImagen: pieza.instruccionImagen,
      conforme: policy.permitido,
      bloqueos: policy.violaciones.map((v) => v.tipo),
    };
  }
}

/** Genera los borradores de todas las piezas. Solo las conformes deberían avanzar a publicación/anuncio. */
export function prepararCreatividades(proveedor: ProveedorCreatividad, organizationId: string, piezas: readonly PiezaContenido[]): BorradorCreatividad[] {
  return piezas.map((p) => proveedor.generarBorrador(organizationId, p));
}
