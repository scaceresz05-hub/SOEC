/**
 * apps/api · INVESTIGACIÓN AUTÓNOMA · auditoría comercial del PROPIO sitio.
 *
 * Evoluciona la lectura única del onboarding a una revisión acotada: unas pocas páginas del propio dominio para
 * poder decir si existe una landing por oferta, si hay una vía de contacto y si la página es indexable. Nada más.
 *
 * LÍMITES DUROS (un rastreador sin límites es un problema, incluso sobre el sitio propio):
 *   · presupuesto de rastreo: máximo de páginas, profundidad máxima, tiempo por página y tamaño por página;
 *   · SÓLO el mismo dominio registrable; cualquier enlace externo se ignora (no se visita nada de terceros);
 *   · mismas defensas que el onboarding: https, puerto estándar, el host debe resolver a IP pública;
 *   · NO se guarda el cuerpo de las páginas: sólo los campos que sirven para decidir.
 *
 * Un sitio caído o lento no es un error del sistema: es un hallazgo de la investigación.
 */
import { lookup } from 'node:dns/promises';
import { dominioRegistrable, esIpNoPublica, validarUrlDeSitio } from '../onboarding/sitio-web';
import type { AuditoriaSitio, PaginaObservada, PresupuestoRastreo, WebsiteResearchProvider } from './proveedores';

export interface OpcionesAuditoria {
  readonly fetchFn?: typeof fetch;
  readonly resolver?: (host: string) => Promise<readonly string[]>;
  readonly ahora?: () => string;
}

const resolverPorDefecto = async (host: string): Promise<readonly string[]> =>
  (await lookup(host, { all: true, verbatim: true })).map((x) => x.address);

const limpio = (s: string, max = 300): string => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Palabras que delatan una llamada a la acción. No se juzga el diseño: se detecta si existe una invitación. */
const PALABRAS_CTA = ['agendar', 'agenda', 'reservar', 'reserva', 'pedir hora', 'contactar', 'contacto', 'cotizar', 'cotización', 'comprar', 'solicitar', 'escríbenos', 'escribenos', 'llámanos', 'llamanos', 'whatsapp', 'pide tu', 'consulta'];

function extraerDePagina(html: string, url: URL, ruta: string, httpStatus: number): { pagina: PaginaObservada; enlaces: readonly URL[] } {
  const titulo = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html)?.[1] ?? null;
  const meta =
    /<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]{0,600}?)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([\s\S]{0,600}?)["'][^>]*name=["']description["']/i.exec(html)?.[1] ??
    null;
  const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/gi)].map((m) => limpio(m[1] ?? '', 160)).filter((x) => x !== '').slice(0, 5);
  const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]{0,300}?)<\/h2>/gi)].map((m) => limpio(m[1] ?? '', 160)).filter((x) => x !== '').slice(0, 12);
  const canonical = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
  const robots = /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ?? '';
  const indexable = httpStatus === 200 && !/noindex/i.test(robots);
  const tieneDatosEstructurados = /application\/ld\+json/i.test(html) || /itemtype=["']https?:\/\/schema\.org/i.test(html);

  const textoVisible = limpio(html, 20000).toLowerCase();
  const ctas = PALABRAS_CTA.filter((p) => textoVisible.includes(p)).slice(0, 8);

  const vias: string[] = [];
  if (/href=["']tel:/i.test(html)) vias.push('telefono');
  if (/wa\.me|api\.whatsapp\.com|whatsapp:\/\//i.test(html)) vias.push('whatsapp');
  if (/href=["']mailto:/i.test(html)) vias.push('correo');
  if (/<form[\s>]/i.test(html)) vias.push('formulario');

  const enlaces: URL[] = [];
  let internos = 0;
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    let destino: URL;
    try {
      destino = new URL(m[1] ?? '', url);
    } catch {
      continue;
    }
    if (destino.hostname.toLowerCase() !== url.hostname.toLowerCase()) continue;
    if (!/^https?:$/.test(destino.protocol)) continue;
    internos += 1;
    destino.hash = '';
    destino.search = '';
    enlaces.push(destino);
  }

  return {
    pagina: {
      ruta,
      httpStatus,
      titulo: titulo !== null ? limpio(titulo, 200) : null,
      metaDescription: meta !== null ? limpio(meta, 300) : null,
      h1,
      h2,
      ctas,
      enlacesInternos: internos,
      canonical,
      indexable,
      tieneDatosEstructurados,
      viasDeContacto: vias,
    },
    enlaces,
  };
}

/**
 * Audita el sitio con un presupuesto. NUNCA lanza: si el sitio no responde, devuelve `alcanzable: false` con el
 * motivo, porque eso también es información del negocio.
 */
export async function auditarSitio(entrada: string, presupuesto: PresupuestoRastreo, opciones: OpcionesAuditoria = {}): Promise<AuditoriaSitio> {
  const ahora = opciones.ahora ?? (() => new Date().toISOString());
  const validada = validarUrlDeSitio(entrada);
  if (!validada.ok) {
    return { url: (entrada ?? '').trim(), alcanzable: false, paginas: [], paginasVisitadas: 0, paginasOmitidas: 0, error: validada.motivo, observadoEn: ahora() };
  }
  const inicio = validada.url;
  const dominio = dominioRegistrable(inicio.hostname);
  const resolver = opciones.resolver ?? resolverPorDefecto;
  const fetchFn = opciones.fetchFn ?? fetch;

  // Defensa de red: el host debe resolver a una dirección pública ANTES de cualquier petición.
  try {
    const ips = await resolver(inicio.hostname);
    if (ips.length === 0 || ips.some((ip) => esIpNoPublica(ip))) {
      return { url: inicio.toString(), alcanzable: false, paginas: [], paginasVisitadas: 0, paginasOmitidas: 0, error: 'el dominio no resuelve a una dirección pública', observadoEn: ahora() };
    }
  } catch {
    return { url: inicio.toString(), alcanzable: false, paginas: [], paginasVisitadas: 0, paginasOmitidas: 0, error: 'el dominio no resuelve', observadoEn: ahora() };
  }

  const pendientes: Array<{ url: URL; profundidad: number }> = [{ url: inicio, profundidad: 0 }];
  const vistas = new Set<string>();
  const paginas: PaginaObservada[] = [];
  let omitidas = 0;
  let errorGlobal: string | null = null;

  while (pendientes.length > 0 && paginas.length < presupuesto.maxPaginas) {
    const actual = pendientes.shift()!;
    const clave = actual.url.pathname.replace(/\/+$/, '') || '/';
    if (vistas.has(clave)) continue;
    vistas.add(clave);

    if (dominioRegistrable(actual.url.hostname) !== dominio) {
      omitidas += 1;
      continue;
    }

    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), presupuesto.timeoutMsPorPagina);
    try {
      const res = await fetchFn(actual.url, {
        method: 'GET',
        redirect: 'follow',
        signal: control.signal,
        headers: { accept: 'text/html', 'user-agent': 'SOEC-research/1.0 (auditoría del propio sitio del negocio)' },
      });
      const tipo = res.headers.get('content-type') ?? '';
      if (!res.ok || !/html/i.test(tipo)) {
        // Una página que no responde o no es HTML se registra con su estado: es evidencia, no un fallo.
        paginas.push({
          ruta: clave, httpStatus: res.status, titulo: null, metaDescription: null, h1: [], h2: [], ctas: [],
          enlacesInternos: 0, canonical: null, indexable: false, tieneDatosEstructurados: false, viasDeContacto: [],
        });
        continue;
      }
      const cuerpo = (await res.text()).slice(0, presupuesto.maxBytesPorPagina);
      const { pagina, enlaces } = extraerDePagina(cuerpo, actual.url, clave, res.status);
      paginas.push(pagina);
      if (actual.profundidad < presupuesto.maxProfundidad) {
        for (const e of enlaces) {
          const k = e.pathname.replace(/\/+$/, '') || '/';
          if (!vistas.has(k) && pendientes.length + paginas.length < presupuesto.maxPaginas * 2) {
            pendientes.push({ url: e, profundidad: actual.profundidad + 1 });
          }
        }
      } else {
        omitidas += enlaces.length;
      }
    } catch (e) {
      const abortado = control.signal.aborted;
      const mensaje = abortado ? 'el sitio no respondió en el tiempo esperado' : e instanceof Error ? e.message.slice(0, 160) : 'error de red';
      if (paginas.length === 0) errorGlobal = mensaje;
      omitidas += 1;
    } finally {
      clearTimeout(reloj);
    }
  }

  omitidas += pendientes.length;
  return {
    url: inicio.toString(),
    alcanzable: paginas.some((p) => p.httpStatus === 200),
    paginas,
    paginasVisitadas: paginas.length,
    paginasOmitidas: omitidas,
    error: errorGlobal,
    observadoEn: ahora(),
  };
}

/** Proveedor de auditoría web sobre HTTP real. Es el único que sale a la red en esta capa. */
export function crearProveedorSitio(opciones: OpcionesAuditoria = {}): WebsiteResearchProvider {
  return {
    nombre: 'auditoria-sitio-http',
    fuente: 'WEBSITE_AUDIT',
    auditar: (url, presupuesto) => auditarSitio(url, presupuesto, opciones),
  };
}
