/**
 * Validación editorial (F2-CONT-01 §14) — validadores independientes que producen
 * HALLAZGOS estructurados (código, severidad, ubicación, descripción, evidencia,
 * acción posible, bloqueante), nunca un simple true/false. Cubre completitud,
 * longitud, formato, coherencia con el brief, identidad de marca, afirmaciones,
 * palabras prohibidas, CTA, accesibilidad, compatibilidad de canal e idioma.
 */
import { afirmacionBloquea, puedePresentarseComoHecho } from './afirmacion';
import type { Adaptacion } from './adaptacion';
import type { ContenidoBrief } from './brief';
import type { VersionMarca } from './marca';
import { perfilCanal } from './canales';

export type Severidad = 'info' | 'menor' | 'mayor' | 'critico';

export interface Hallazgo {
  readonly codigo: string;
  readonly severidad: Severidad;
  readonly ubicacion: string;
  readonly descripcion: string;
  readonly evidencia: string;
  readonly accionPosible: string;
  readonly bloqueante: boolean;
}

export interface ContextoValidacion {
  readonly brief: ContenidoBrief;
  readonly marca: VersionMarca | null;
  /** Afirmaciones prohibidas efectivas (política + marca + brief). */
  readonly afirmacionesProhibidas: readonly string[];
  /** Canales autorizados por la política vigente. */
  readonly canalesAutorizados: readonly string[];
}

function h(codigo: string, severidad: Severidad, ubicacion: string, descripcion: string, evidencia: string, accionPosible: string, bloqueante: boolean): Hallazgo {
  return { codigo, severidad, ubicacion, descripcion, evidencia, accionPosible, bloqueante };
}

function contieneAlguna(texto: string, subcadenas: readonly string[]): string | null {
  const t = texto.toLowerCase();
  for (const s of subcadenas) if (s && t.includes(s.toLowerCase())) return s;
  return null;
}

/** Valida una adaptación contra su brief, marca y política. Devuelve todos los hallazgos. */
export function validarAdaptacion(a: Adaptacion, ctx: ContextoValidacion): readonly Hallazgo[] {
  const out: Hallazgo[] = [];
  const perfil = perfilCanal(a.canal);
  const donde = `adaptacion:${a.id}`;

  // Completitud
  if (!a.cuerpo.trim()) out.push(h('completitud.cuerpo', 'critico', donde, 'La adaptación no tiene cuerpo', '(vacío)', 'generar el cuerpo', true));
  if (perfil?.requiereTitulo && !a.titulo.trim()) out.push(h('completitud.titulo', 'mayor', donde, 'El canal requiere título', '(vacío)', 'generar un título', true));
  if (perfil?.requiereCta && !a.llamadaAccion.trim()) out.push(h('cta.faltante', 'mayor', donde, 'Falta la llamada a la acción', '(vacío)', 'agregar CTA', true));
  if (perfil?.requiereAltText && !a.altText.trim()) out.push(h('accesibilidad.alt', 'menor', donde, 'Falta texto alternativo (accesibilidad)', '(vacío)', 'agregar alt text', false));

  // Longitud / compatibilidad de canal
  if (perfil && perfil.limiteCuerpo > 0 && a.cuerpo.length > perfil.limiteCuerpo) {
    out.push(h('longitud.cuerpo', 'mayor', donde, `El cuerpo excede el límite del canal (${perfil.limiteCuerpo})`, `${a.cuerpo.length} caracteres`, 'acortar el cuerpo', true));
  }
  if (perfil && perfil.limiteTitulo > 0 && a.titulo.length > perfil.limiteTitulo) {
    out.push(h('longitud.titulo', 'menor', donde, `El título excede el límite (${perfil.limiteTitulo})`, `${a.titulo.length} caracteres`, 'acortar el título', false));
  }
  if (perfil && !perfil.permiteHashtags && a.hashtags.length > 0) {
    out.push(h('formato.hashtags', 'menor', donde, 'El canal no admite hashtags', a.hashtags.join(' '), 'quitar hashtags', false));
  }
  if (perfil && a.hashtags.length > perfil.maxHashtags && perfil.maxHashtags >= 0 && perfil.permiteHashtags) {
    out.push(h('formato.max_hashtags', 'menor', donde, `Demasiados hashtags (máx ${perfil.maxHashtags})`, `${a.hashtags.length}`, 'reducir hashtags', false));
  }

  // Compatibilidad: canal soportado / autorizado
  if (!perfil) out.push(h('canal.desconocido', 'critico', donde, `Canal desconocido '${a.canal}'`, a.canal, 'usar un canal soportado', true));

  // Idioma
  if (ctx.brief.idioma && a.metadatos['idioma'] && a.metadatos['idioma'] !== ctx.brief.idioma) {
    out.push(h('idioma.discrepancia', 'mayor', donde, 'El idioma de la adaptación no coincide con el brief', `${a.metadatos['idioma']} ≠ ${ctx.brief.idioma}`, 'regenerar en el idioma correcto', true));
  }

  // Coherencia con el brief: el mensaje principal debe estar presente
  const nucleo = ctx.brief.mensajePrincipal.trim();
  if (nucleo && !a.cuerpo.toLowerCase().includes(nucleo.toLowerCase().slice(0, Math.min(nucleo.length, 12)))) {
    out.push(h('coherencia.mensaje', 'menor', donde, 'El mensaje principal del brief no es evidente en el cuerpo', nucleo, 'reforzar el mensaje principal', false));
  }

  // Afirmaciones prohibidas (política/marca) — en cuerpo, título, descripción
  const superficie = `${a.titulo}\n${a.cuerpo}\n${a.descripcion}`;
  const prohibida = contieneAlguna(superficie, ctx.afirmacionesProhibidas);
  if (prohibida) {
    out.push(h('afirmacion.prohibida', 'critico', donde, 'El contenido incluye una afirmación prohibida', prohibida, `eliminar la afirmación "${prohibida}"`, true));
  }
  // Expresiones prohibidas de marca
  const expr = ctx.marca ? contieneAlguna(superficie, ctx.marca.expresionesProhibidas) : null;
  if (expr) out.push(h('marca.expresion', 'mayor', donde, 'Uso de una expresión prohibida por la marca', expr, `reemplazar "${expr}"`, true));

  // Afirmaciones no sustentadas / prohibidas conservadas
  for (const af of a.afirmaciones) {
    if (afirmacionBloquea(af)) out.push(h('afirmacion.riesgo', 'critico', donde, `Afirmación de tipo '${af.tipo}' no publicable`, af.texto, 'reemplazar o sustentar la afirmación', true));
    else if (!puedePresentarseComoHecho(af.tipo) && af.estado === 'validada') {
      // Afirmación presentada como validada pero no presentable como hecho.
      out.push(h('afirmacion.no_hecho', 'menor', donde, `Una afirmación '${af.tipo}' no debe presentarse como hecho`, af.texto, 'marcar como propuesta/inferencia', false));
    }
  }

  // Disclaimers de marca esenciales (no deben perderse)
  if (ctx.marca) {
    for (const disc of ctx.marca.disclaimers) {
      if (disc && !a.advertencias.some((w) => w.includes(disc))) {
        out.push(h('marca.disclaimer', 'menor', donde, 'Falta un disclaimer obligatorio de la marca', disc, 'incluir el disclaimer', false));
      }
    }
  }

  return out;
}

/** Un conjunto de hallazgos bloquea si contiene al menos uno bloqueante. */
export function hayBloqueante(hallazgos: readonly Hallazgo[]): boolean {
  return hallazgos.some((x) => x.bloqueante);
}

/** Hallazgos bloqueantes que la revisión automática puede intentar corregir (afirmaciones/expresiones). */
export function corregiblesAutomaticamente(hallazgos: readonly Hallazgo[]): readonly Hallazgo[] {
  const CORREGIBLES = new Set(['afirmacion.prohibida', 'marca.expresion']);
  return hallazgos.filter((x) => x.bloqueante && CORREGIBLES.has(x.codigo));
}
