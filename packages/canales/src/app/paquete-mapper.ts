/**
 * Mapper de payload (F2-CHAN-01 §9). Transforma un paquete publicable (de la fábrica
 * de contenido) en el payload específico del canal, validando formato y límites,
 * conservando CTA, alt text, afirmaciones y disclaimers, e impidiendo campos
 * incompatibles. Produce una huella estable y registra la versión del transformador.
 * El payload NO se arma en la interfaz ni el worker: pertenece al mapper.
 */
import type { PaqueteState } from '@soec/contenido';
import type { CanalCapabilities } from '../domain/capabilities';
import type { PayloadCanal } from '../domain/ports';

export const MAPPER_VERSION = 'mapper-emulado@1';

/** Cuenta activos con ARCHIVO real (no especificaciones). En F2-CONT-01 son especificaciones → 0. */
function contarArchivosReales(paquete: PaqueteState): number {
  return paquete.activos.filter((a) => a.tipo !== 'texto' && a.texto.startsWith('file://')).length;
}

function huella(canal: string, content: string, title: string): string {
  const base = `${canal}|${title}|${content}`;
  let h = 0;
  for (let i = 0; i < base.length; i += 1) h = (h * 131 + base.charCodeAt(i)) % 1_000_000_007;
  return `pl${h.toString(16)}`;
}

export interface ResultadoMapeo {
  readonly payload: PayloadCanal;
  readonly incompatibilidades: readonly string[];
}

export function mapearPaquete(paquete: PaqueteState, canal: string, capacidades: CanalCapabilities): ResultadoMapeo {
  const ad = paquete.adaptaciones.find((a) => a.canal === canal);
  const incompatibilidades: string[] = [];
  if (!ad) incompatibilidades.push(`sin adaptación para el canal '${canal}'`);
  const content = ad?.cuerpo ?? '';
  const title = ad?.titulo ?? '';
  if (capacidades.limiteCuerpo > 0 && content.length > capacidades.limiteCuerpo) {
    incompatibilidades.push(`cuerpo excede el límite del canal (${capacidades.limiteCuerpo})`);
  }
  if (!capacidades.publicaTexto && content.length > 0 && !capacidades.publicaImagen) {
    incompatibilidades.push('el canal no admite publicación de texto');
  }
  const assetsReales = contarArchivosReales(paquete);
  const payload: PayloadCanal = {
    canal,
    formato: ad?.formato ?? 'post_social',
    content,
    title,
    altText: ad?.altText ?? '',
    hashtags: ad?.hashtags ?? [],
    llamadaAccion: ad?.llamadaAccion ?? '',
    urlObjetivo: ad?.urlObjetivo ?? '',
    assetsReales,
    requiereArchivoReal: capacidades.exigeArchivoRealParaImagen,
    huella: huella(canal, content, title),
    mapperVersion: MAPPER_VERSION,
  };
  return { payload, incompatibilidades };
}
