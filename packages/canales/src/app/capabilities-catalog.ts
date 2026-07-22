/**
 * Catálogo de capacidades por canal (F2-CHAN-01 §4). Declara qué soporta cada canal;
 * el adaptador no supone que todos los proveedores funcionan igual. Canales de texto
 * (blog/linkedin/correo/facebook) publican sin archivo real; canales visuales
 * (instagram/meta_ads) EXIGEN un archivo real de imagen para publicar con imagen.
 */
import type { CanalCapabilities } from '../domain/capabilities';

const ESTADOS = ['accepted', 'processing', 'published', 'deleted'];

function cap(canal: string, over: Partial<CanalCapabilities>): CanalCapabilities {
  return {
    canal,
    publicaTexto: true,
    publicaImagen: false,
    publicaVideo: false,
    soportaBorradores: false,
    soportaProgramacion: true,
    soportaEdicion: false,
    soportaEliminacion: true,
    soportaConsulta: true,
    soportaWebhooks: true,
    exigeArchivoRealParaImagen: false,
    limiteCuerpo: 0,
    estadosRemotos: ESTADOS,
    ...over,
  };
}

const CAPACIDADES: Readonly<Record<string, CanalCapabilities>> = {
  blog: cap('blog', { limiteCuerpo: 0 }),
  linkedin: cap('linkedin', { publicaImagen: true, limiteCuerpo: 3000 }),
  correo: cap('correo', { limiteCuerpo: 0, soportaWebhooks: false }),
  facebook: cap('facebook', { publicaImagen: true, limiteCuerpo: 63206 }),
  instagram: cap('instagram', { publicaTexto: false, publicaImagen: true, exigeArchivoRealParaImagen: true, limiteCuerpo: 2200 }),
  meta_ads: cap('meta_ads', { publicaImagen: true, exigeArchivoRealParaImagen: true, limiteCuerpo: 125 }),
};

export function capacidadesDeCanal(canal: string): CanalCapabilities | null {
  return CAPACIDADES[canal] ?? null;
}
