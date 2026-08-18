/**
 * apps/api · V2-B · CONTENT ENGINE. Genera copy estructurado DETERMINISTA a partir del perfil declarado del
 * negocio y del objetivo. No inventa servicios, precios ni claims clínicos: solo usa lo declarado por el
 * negocio. Todo lo producido pasa por `validarContenido` (content-policy) antes de proponerse.
 */
import { validarContenido, type ResultadoContentPolicy } from './content-policy';

export type Placement = 'instagram' | 'facebook';
export type ObjetivoCampana = 'RECONOCIMIENTO' | 'CONSIDERACION' | 'MENSAJES' | 'TRAFICO';

export interface PerfilNegocio {
  readonly organizationId: string;
  readonly nombre: string;
  readonly rubro: string; // ej. "odontología"
  readonly serviciosDeclarados: readonly string[]; // SOLO lo que el negocio declaró; puede ir vacío
  readonly comuna?: string;
  readonly tono?: 'cercano' | 'profesional' | 'neutro';
}

export interface BriefContenido {
  readonly organizationId: string;
  readonly objetivo: ObjetivoCampana;
  readonly placement: Placement;
  readonly servicioFoco?: string; // debe pertenecer a serviciosDeclarados
}

export interface PiezaContenido {
  readonly variante: string;
  readonly headline: string;
  readonly primaryText: string;
  readonly description: string;
  readonly cta: string;
  readonly hashtags: readonly string[];
  readonly instruccionImagen: string; // brief para diseño/creatividad, no una imagen inventada
  readonly policy: ResultadoContentPolicy;
}

const CTA_POR_OBJETIVO: Record<ObjetivoCampana, string> = {
  RECONOCIMIENTO: 'Conócenos',
  CONSIDERACION: 'Más información',
  MENSAJES: 'Escríbenos',
  TRAFICO: 'Visita el sitio',
};

function foco(perfil: PerfilNegocio, brief: BriefContenido): string | null {
  if (brief.servicioFoco && perfil.serviciosDeclarados.includes(brief.servicioFoco)) return brief.servicioFoco;
  return perfil.serviciosDeclarados[0] ?? null;
}

function lugar(perfil: PerfilNegocio): string {
  return perfil.comuna ? ` en ${perfil.comuna}` : '';
}

/** Dos variantes A/B deterministas. Sin precios/superlativos/claims: describen el servicio declarado y el CTA. */
export function generarContenido(perfil: PerfilNegocio, brief: BriefContenido): PiezaContenido[] {
  const servicio = foco(perfil, brief);
  const sujeto = servicio ?? perfil.rubro;
  const cta = CTA_POR_OBJETIVO[brief.objetivo];
  const tag = perfil.rubro.replace(/[^\p{L}\p{N}]/gu, '');
  const hashtags = [`#${tag}`, perfil.comuna ? `#${perfil.comuna.replace(/[^\p{L}\p{N}]/gu, '')}` : `#${perfil.nombre.replace(/[^\p{L}\p{N}]/gu, '')}`].filter(Boolean);

  const variantes: Array<Omit<PiezaContenido, 'policy'>> = [
    {
      variante: 'A',
      headline: `${perfil.nombre}${lugar(perfil)}`,
      primaryText: `En ${perfil.nombre} te acompañamos con ${sujeto}${lugar(perfil)}. Agenda cuando lo necesites.`,
      description: `${sujeto} con atención cercana.`,
      cta,
      hashtags,
      instruccionImagen: `Foto real del equipo o del espacio de ${perfil.nombre} relacionada con ${sujeto}. Sin stock genérico, sin texto sobreimpreso de precios.`,
    },
    {
      variante: 'B',
      headline: `${sujeto}${lugar(perfil)}`,
      primaryText: `¿Buscas ${sujeto}${lugar(perfil)}? Conversemos y resolvemos tus dudas sin compromiso.`,
      description: `${perfil.nombre}: ${perfil.rubro}.`,
      cta,
      hashtags,
      instruccionImagen: `Imagen del servicio ${sujeto} en contexto real de ${perfil.nombre}. Evitar claims clínicos o superlativos.`,
    },
  ];

  return variantes.map((v) => ({
    ...v,
    policy: validarContenido({ organizationId: perfil.organizationId, textos: [v.headline, v.primaryText, v.description, v.cta] }, brief.organizationId),
  }));
}
