/**
 * apps/api · INVESTIGACIÓN · SEMILLAS VERIFICADAS DEL SITIO (fallback cuando el planificador calla).
 *
 * POR QUÉ EXISTE ESTO. El planificador de palabras de Google puede responder con una lista vacía —le pasa,
 * por ejemplo, a cuentas sin historial— y ese silencio dejaba al negocio sin plan posible. Pero que Google no
 * traiga términos no significa que nadie busque: significa que hoy no tenemos sus números.
 *
 * Este módulo construye CANDIDATOS a partir de lo que SÍ está verificado —las páginas que SOEC auditó en el
 * sitio del negocio, las ofertas que el negocio declaró y su territorio— para que se pueda armar y revisar un
 * plan. Es material para que una persona decida, no una medición.
 *
 * LAS TRES COSAS QUE NUNCA HACE, y que son la razón de que el módulo esté separado y sea puro:
 *
 *  · NO INVENTA VOLUMEN. Cada candidato sale con `volumenMensual: null` y `evidenciaDemanda: 'UNKNOWN'`.
 *    Nunca cero: cero es una medición, y aquí no se midió nada.
 *  · NO INVENTA PÁGINAS. Un grupo sólo puede apuntar a una URL que la auditoría vio responder.
 *  · NO INVENTA AFIRMACIONES. Los textos de anuncio se recortan de lo que el sitio ya dice; y aun así se
 *    descarta todo lo que suene a precio, promoción, convenio o promesa de resultado, porque eso no lo
 *    podemos verificar y lo firma el negocio, no nosotros.
 */
import type { OfertaNegocio } from '../negocio/negocio-pg';

/** Página tal como la vio la auditoría del sitio. Sólo lo que sirve para redactar y decidir. */
export interface PaginaVerificada {
  readonly ruta: string;
  readonly httpStatus: number;
  readonly titulo: string | null;
  readonly metaDescription: string | null;
  readonly h1: readonly string[];
  readonly indexable: boolean;
}

export type EvidenciaDemanda = 'KNOWN' | 'UNKNOWN';

export interface CandidatoDeSitio {
  readonly termino: string;
  /** Siempre `null`: no se observó volumen. Un cero aquí sería una medición inventada. */
  readonly volumenMensual: null;
  readonly evidenciaDemanda: 'UNKNOWN';
  readonly origen: 'VERIFIED_SITE_SEEDS';
  /** De dónde salió literalmente: la oferta declarada, una página del sitio, o la combinación con territorio. */
  readonly respaldo: string;
}

export interface GrupoDeSitio {
  readonly ofertaSlug: string;
  readonly nombre: string;
  readonly landing: string | null;
  readonly candidatos: readonly CandidatoDeSitio[];
}

export interface NegativaSegura {
  readonly termino: string;
  readonly motivo: string;
}

export interface BorradorRSA {
  readonly ofertaSlug: string;
  readonly titulares: readonly string[];
  readonly descripciones: readonly string[];
  readonly respaldo: readonly string[];
}

export interface EntradaSemillasSitio {
  readonly oferta: readonly OfertaNegocio[];
  readonly paginas: readonly PaginaVerificada[];
  readonly localidades: readonly string[];
  readonly marca: string;
  /** Landing verificada por oferta (sólo se aceptan las que la auditoría comprobó). */
  readonly landingPorOferta: ReadonlyMap<string, string | null>;
}

export interface SemillasDeSitio {
  readonly grupos: readonly GrupoDeSitio[];
  readonly negativas: readonly NegativaSegura[];
  readonly anuncios: readonly BorradorRSA[];
  /** `true` sólo si hubo material verificado suficiente para construir algo. */
  readonly utilizable: boolean;
}

/** Límites deliberados: un plan con 200 términos no es más plan, es una bolsa que nadie revisa. */
const MAX_CANDIDATOS_POR_GRUPO = 12;
const MAX_LOCALIDADES_COMBINADAS = 4;
const MAX_TITULARES = 8;
const MAX_DESCRIPCIONES = 4;
const LARGO_TITULAR = 30; // límite real de un titular de anuncio de búsqueda
const LARGO_DESCRIPCION = 90;

/**
 * NEGATIVAS DE INTENCIÓN NO COMERCIAL. Lista corta y conservadora a propósito: cada negativa de más es una
 * búsqueda legítima que el negocio deja de ver. Sólo entran las que no tienen lectura comercial posible
 * —quien busca «trabajo dentista» no quiere una hora, y quien busca «odontología pdf» tampoco—.
 */
const NEGATIVAS_DE_INTENCION: readonly NegativaSegura[] = [
  { termino: 'empleo', motivo: 'busca trabajo, no atención' },
  { termino: 'trabajo', motivo: 'busca trabajo, no atención' },
  { termino: 'curso', motivo: 'busca formación, no atención' },
  { termino: 'estudiar', motivo: 'busca formación, no atención' },
  { termino: 'gratis', motivo: 'busca algo sin costo: el negocio no lo ofrece' },
  { termino: 'pdf', motivo: 'busca un documento, no un servicio' },
  { termino: 'definicion', motivo: 'busca una definición, no atención' },
  { termino: 'wikipedia', motivo: 'busca enciclopedia, no atención' },
];

const sinAcentos = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizar = (s: string): string => sinAcentos(s).toLowerCase().replace(/\s+/g, ' ').trim();
const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * AFIRMACIONES QUE NO SE PUEDEN FIRMAR. Aunque el texto venga del propio sitio, no se copia a un anuncio si
 * promete precio, convenio, resultado o autoridad: un anuncio lo firma el negocio ante la plataforma, y si la
 * afirmación no se sostiene el problema es suyo, no nuestro. Ante la duda, no se propone.
 */
const PATRONES_NO_VERIFICABLES: readonly RegExp[] = [
  /\$|\bclp\b|\bprecio|\bdesde\s+\d|\boferta\b|\bdescuento|\bpromoci/i,
  /\bgratis\b|\bsin costo\b|\b\d+\s*%/,
  /\bfonasa\b|\bisapre\b|\bconvenio\b|\bbono\b/i,
  /\bgarant|\bresultado[s]?\s+asegurad|\bsin dolor\b|\bindoloro\b|\bmejor\b|\bnúmero\s*1\b|\bn°\s*1\b|\blíder\b/i,
  /\b\d+\s*años\b|\bexperiencia de\b|\bespecialista certificad/i,
  /\burgencia[s]?\s+24|\b24\s*\/?\s*7\b/i,
];

const esAfirmacionSegura = (texto: string): boolean => !PATRONES_NO_VERIFICABLES.some((p) => p.test(texto));

/**
 * Palabras con las que una frase no puede terminar. Cortar «rehabilitación oral en Licantén» a treinta
 * caracteres deja «rehabilitación oral en», que no es un titular: es una frase a medias que nadie escribiría.
 */
const CONECTORES_FINALES = new Set(['en', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'con', 'para', 'por', 'a', 'al', 'un', 'una', 'que', 'su', 'sus']);

/**
 * Recorta sin partir palabras NI dejar frases colgando. Si el texto no cabe, se prefiere una frase completa
 * —hasta el último punto— y, si no la hay, se corta por palabras y se retiran los conectores finales. Devuelve
 * `null` cuando lo que queda ya no dice nada: es mejor proponer un titular menos que uno roto.
 */
function recortar(texto: string, max: number): string | null {
  const t = limpio(texto);
  if (t === '') return null;
  if (t.length <= max) return sinColgar(t);
  // Una frase entera dentro del límite se lee mucho mejor que una cortada por la mitad.
  const frase = t.slice(0, max + 1).match(/^.*[.!?](?=\s|$)/);
  if (frase !== null && frase[0].length >= Math.min(30, max)) return limpio(frase[0]);
  const corte = t.slice(0, max + 1).lastIndexOf(' ');
  return corte > 8 ? sinColgar(t.slice(0, corte)) : null;
}

/** Quita puntuación y conectores finales; `null` si lo que queda es demasiado corto para significar algo. */
function sinColgar(texto: string): string | null {
  let r = texto.replace(/[\s,;:.\-—–|]+$/, '');
  for (let i = 0; i < 3; i += 1) {
    const partes = r.split(' ');
    const ultima = (partes[partes.length - 1] ?? '').toLowerCase().replace(/[.,;:]/g, '');
    if (partes.length > 1 && CONECTORES_FINALES.has(ultima)) {
      r = partes.slice(0, -1).join(' ').replace(/[\s,;:.\-—–|]+$/, '');
    } else break;
  }
  return r.length >= 10 ? r : null;
}

/**
 * Términos base de una oferta: su nombre declarado y los títulos/H1 de las páginas del sitio que hablan de
 * ella. No se inventan sinónimos ni «tratamientos parecidos»: si el negocio no lo nombra y su sitio no lo
 * dice, aquí no aparece.
 */
function basesDeOferta(o: OfertaNegocio, paginas: readonly PaginaVerificada[]): ReadonlyArray<{ termino: string; respaldo: string }> {
  const bases = new Map<string, string>();
  const nombre = limpio(o.name);
  if (nombre !== '') bases.set(normalizar(nombre), `oferta declarada por el negocio: «${nombre}»`);

  const clave = normalizar(nombre);
  const palabrasClave = clave.split(' ').filter((p) => p.length > 4);
  for (const p of paginas) {
    if (!p.indexable || p.httpStatus !== 200) continue;
    const textos = [p.titulo ?? '', ...p.h1];
    for (const bruto of textos) {
      const texto = limpio(bruto.replace(/\s*[|·—–-]\s*.*$/, '')); // se queda con la parte propia del título
      if (texto === '' || texto.length > 60) continue;
      const n = normalizar(texto);
      // Sólo si la página habla de ESTA oferta: comparte una palabra significativa con su nombre.
      const habla = n === clave || palabrasClave.some((w) => n.includes(w));
      if (!habla || bases.has(n)) continue;
      bases.set(n, `texto de la página ${p.ruta} del sitio`);
    }
  }
  return [...bases.entries()].map(([n, respaldo]) => ({ termino: n, respaldo }));
}

/**
 * Construye candidatos, negativas y borradores de anuncio con lo verificado. Si no hay ofertas activas o no
 * hay ni una página que responda, devuelve `utilizable: false`: preferimos no proponer nada a proponer humo.
 */
export function semillasDeSitio(e: EntradaSemillasSitio): SemillasDeSitio {
  const activas = e.oferta.filter((o) => o.status === 'ACTIVE').slice().sort((a, b) => a.priority - b.priority);
  const paginasVivas = e.paginas.filter((p) => p.httpStatus === 200);
  const localidades = e.localidades.slice(0, MAX_LOCALIDADES_COMBINADAS);

  const grupos: GrupoDeSitio[] = [];
  const anuncios: BorradorRSA[] = [];

  for (const o of activas) {
    const landing = e.landingPorOferta.get(o.slug) ?? null;
    // SIN PÁGINA VERIFICADA NO HAY GRUPO. Mandar clics a una página que nadie comprobó es pagar por perder a
    // alguien en el camino.
    if (landing === null || landing === undefined) continue;

    const bases = basesDeOferta(o, paginasVivas);
    if (bases.length === 0) continue;

    const vistos = new Set<string>();
    const candidatos: CandidatoDeSitio[] = [];
    const añadir = (termino: string, respaldo: string): void => {
      const n = normalizar(termino);
      if (n === '' || n.split(' ').length > 6 || vistos.has(n) || candidatos.length >= MAX_CANDIDATOS_POR_GRUPO) return;
      vistos.add(n);
      candidatos.push({ termino: n, volumenMensual: null, evidenciaDemanda: 'UNKNOWN', origen: 'VERIFIED_SITE_SEEDS', respaldo });
    };

    for (const b of bases) añadir(b.termino, b.respaldo);
    // El territorio es del negocio, está persistido y es el que se va a segmentar: combinarlo no inventa nada.
    for (const loc of localidades) {
      for (const b of bases.slice(0, 3)) añadir(`${b.termino} ${normalizar(loc)}`, `${b.respaldo} + territorio declarado «${loc}»`);
    }

    if (candidatos.length === 0) continue;
    grupos.push({ ofertaSlug: o.slug, nombre: o.name, landing, candidatos });

    // ── BORRADORES DE ANUNCIO, sólo con lo que el sitio ya dice ──
    const paginaDeLanding = paginasVivas.find((p) => p.ruta === landing) ?? null;
    const fuentesTitular: Array<{ texto: string; de: string }> = [];
    if (paginaDeLanding !== null) {
      for (const h of paginaDeLanding.h1) fuentesTitular.push({ texto: h, de: `h1 de ${paginaDeLanding.ruta}` });
      if (paginaDeLanding.titulo !== null) fuentesTitular.push({ texto: paginaDeLanding.titulo, de: `título de ${paginaDeLanding.ruta}` });
    }
    fuentesTitular.push({ texto: o.name, de: 'oferta declarada' });
    for (const loc of localidades.slice(0, 2)) fuentesTitular.push({ texto: `${o.name} en ${loc}`, de: `oferta + territorio declarado` });
    if (limpio(e.marca) !== '') fuentesTitular.push({ texto: e.marca, de: 'nombre del negocio' });

    const titulares: string[] = [];
    const respaldo = new Set<string>();
    for (const f of fuentesTitular) {
      if (titulares.length >= MAX_TITULARES) break;
      const t = recortar(f.texto, LARGO_TITULAR);
      if (t === null || !esAfirmacionSegura(t)) continue;
      const yaEsta = titulares.some((x) => normalizar(x) === normalizar(t));
      if (yaEsta) continue;
      titulares.push(t);
      respaldo.add(f.de);
    }

    const descripciones: string[] = [];
    const fuentesDescripcion = paginaDeLanding === null ? [] : [
      ...(paginaDeLanding.metaDescription !== null ? [{ texto: paginaDeLanding.metaDescription, de: `meta description de ${paginaDeLanding.ruta}` }] : []),
      ...(paginaDeLanding.titulo !== null ? [{ texto: paginaDeLanding.titulo, de: `título de ${paginaDeLanding.ruta}` }] : []),
    ];
    for (const f of fuentesDescripcion) {
      if (descripciones.length >= MAX_DESCRIPCIONES) break;
      const d = recortar(f.texto, LARGO_DESCRIPCION);
      if (d === null || d.length < 30 || !esAfirmacionSegura(d)) continue;
      descripciones.push(d);
      respaldo.add(f.de);
    }

    // Un anuncio sin material del sitio no se propone a medias: se declara que faltan textos.
    if (titulares.length > 0) anuncios.push({ ofertaSlug: o.slug, titulares, descripciones, respaldo: [...respaldo] });
  }

  return {
    grupos,
    negativas: grupos.length > 0 ? NEGATIVAS_DE_INTENCION : [],
    anuncios,
    utilizable: grupos.length > 0,
  };
}

export { NEGATIVAS_DE_INTENCION };
