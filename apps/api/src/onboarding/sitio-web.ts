/**
 * apps/api · ONBOARDING INTELIGENTE · inspección mínima y segura del PROPIO sitio del negocio.
 *
 * QUÉ ES: una sola lectura de la portada del sitio que el dueño acaba de escribir, para no volver a pedirle
 * datos que están a la vista (título, descripción, páginas principales). Lo observado se guarda como
 * `DISCOVERED` y se le muestra para que lo confirme o lo corrija. Nunca como afirmación suya.
 *
 * QUÉ NO ES: no es un motor de investigación, no visita competidores, no rastrea el sitio entero y no lee
 * nada de terceros. Eso corresponde a la fase siguiente y tiene su propio gobierno.
 *
 * DEFENSAS (una petición a un host que escribe un usuario es una superficie de ataque):
 *   · sólo `https`, sólo el puerto por defecto, sin credenciales en la URL;
 *   · el host debe resolver a una IP PÚBLICA — se rechazan loopback, privadas, link-local y metadatos de nube;
 *   · redirecciones sólo dentro del MISMO dominio registrable, máximo dos saltos;
 *   · tiempo máximo de espera y tamaño máximo de lectura acotados;
 *   · sólo se extraen título, descripción y rutas internas. El cuerpo no se guarda.
 */
import { lookup } from 'node:dns/promises';

export interface ResultadoInspeccion {
  readonly url: string;
  readonly estado: 'OK' | 'UNREACHABLE' | 'NOT_HTTPS' | 'REJECTED' | 'ERROR';
  readonly httpStatus: number | null;
  readonly titulo: string | null;
  readonly metaDescription: string | null;
  readonly paginas: readonly string[];
  readonly enlacesInternos: number;
  readonly esHttps: boolean;
  readonly error: string | null;
}

export interface OpcionesInspeccion {
  readonly fetchFn?: typeof fetch;
  /** Resolución DNS inyectable: en test se evita la red real sin renunciar a probar la defensa. */
  readonly resolver?: (host: string) => Promise<readonly string[]>;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

const TIMEOUT_POR_DEFECTO_MS = 5_000;
const MAX_BYTES_POR_DEFECTO = 512 * 1024;
const MAX_PAGINAS = 12;
const MAX_SALTOS = 2;

/** Dominio registrable aproximado (dos últimas etiquetas). Basta para «no salir del sitio del negocio». */
export function dominioRegistrable(host: string): string {
  const partes = host.toLowerCase().split('.').filter((x) => x.length > 0);
  return partes.slice(-2).join('.');
}

/** ¿Es una IPv4 privada, de loopback, link-local o de metadatos de nube? */
function esIpv4NoPublica(v: string): boolean {
  const o = v.split('.').map((x) => Number(x));
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // no es IPv4 válida
  const [a, b] = o as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local: incluye 169.254.169.254 (metadatos de nube)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * ¿Es una IP privada, de loopback, link-local o de metadatos de nube? Fail-closed ante formatos raros.
 *
 * IPv6 SE CLASIFICA, NO SE RECHAZA EN BLOQUE. La versión anterior partía la dirección por puntos y, si no
 * salían cuatro números, la declaraba no pública: es decir, TODA dirección IPv6 era «interna». El sitio de un
 * negocio real detrás de Cloudflare publica AAAA además de A, la resolución del contenedor devuelve ambas, y
 * bastaba una de ellas para que SOEC dijera que «el dominio no resuelve a una dirección pública» de un sitio
 * que cualquiera abría en su navegador. La defensa contra direcciones internas es correcta; confundir «no es
 * IPv4» con «es interna» no lo es.
 *
 * Lo que sigue siendo no público en IPv6: `::` y `::1` (no especificada y loopback), `fe80::/10` (link-local),
 * `fc00::/7` (únicas locales) y las formas que embeben una IPv4 —`::ffff:a.b.c.d`, `64:ff9b::a.b.c.d`—, que se
 * juzgan por la IPv4 que llevan dentro para que nadie alcance 169.254.169.254 envolviéndola en IPv6.
 */
export function esIpNoPublica(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, ''); // sin corchetes ni zona
  if (v === '') return true;
  if (!v.includes(':')) return esIpv4NoPublica(v);

  // ── IPv6 ──
  if (v === '::' || v === '::1') return true;
  // Una IPv4 embebida manda sobre el envoltorio: ::ffff:169.254.169.254 es la dirección de metadatos.
  const embebida = /(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (embebida !== null) return esIpv4NoPublica(embebida[1]!);
  // Todo lo que empieza por `::` vive en el bloque reservado `::/8`: no es espacio público y no se admite
  // (las formas con IPv4 dentro ya se resolvieron arriba, que son las únicas útiles de ese bloque).
  if (v.startsWith('::')) return true;
  const grupos = v.split(':').filter((g) => g !== '');
  if (grupos.length === 0 || grupos.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return true; // formato raro ⇒ no
  const primero = Number.parseInt(grupos[0]!, 16);
  if (Number.isNaN(primero)) return true;
  if ((primero & 0xfe00) === 0xfc00) return true; // fc00::/7 — únicas locales
  if ((primero & 0xffc0) === 0xfe80) return true; // fe80::/10 — link-local
  // El resto del espacio IPv6 en uso público (2000::/3 y vecinos) es alcanzable y legítimo.
  return false;
}

/** Valida la URL que escribió el usuario. Devuelve la URL normalizada o el motivo del rechazo. */
export function validarUrlDeSitio(entrada: string): { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly estado: 'NOT_HTTPS' | 'REJECTED'; readonly motivo: string } {
  const texto = (entrada ?? '').trim();
  if (texto === '') return { ok: false, estado: 'REJECTED', motivo: 'sin dirección' };
  let u: URL;
  try {
    u = new URL(texto.startsWith('http') ? texto : `https://${texto}`);
  } catch {
    return { ok: false, estado: 'REJECTED', motivo: 'la dirección no es válida' };
  }
  if (u.protocol !== 'https:') return { ok: false, estado: 'NOT_HTTPS', motivo: 'el sitio debe usar https' };
  if (u.username !== '' || u.password !== '') return { ok: false, estado: 'REJECTED', motivo: 'la dirección no puede llevar credenciales' };
  if (u.port !== '') return { ok: false, estado: 'REJECTED', motivo: 'sólo se admite el puerto estándar' };
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return { ok: false, estado: 'REJECTED', motivo: 'la dirección debe tener un dominio' };
  return { ok: true, url: u };
}

async function resolverPublico(host: string, resolver: (h: string) => Promise<readonly string[]>): Promise<{ ok: boolean; motivo: string }> {
  try {
    const ips = await resolver(host);
    if (ips.length === 0) return { ok: false, motivo: 'el dominio no resuelve' };
    if (ips.some((ip) => esIpNoPublica(ip))) return { ok: false, motivo: 'el dominio apunta a una dirección interna' };
    return { ok: true, motivo: 'público' };
  } catch {
    return { ok: false, motivo: 'el dominio no resuelve' };
  }
}

const resolverPorDefecto = async (host: string): Promise<readonly string[]> =>
  (await lookup(host, { all: true, verbatim: true })).map((x) => x.address);

function extraer(html: string, base: URL): { titulo: string | null; metaDescription: string | null; paginas: readonly string[]; enlacesInternos: number } {
  const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 300);
  const titulo = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html)?.[1] ?? null;
  const meta =
    /<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]{0,600}?)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([\s\S]{0,600}?)["'][^>]*name=["']description["']/i.exec(html)?.[1] ??
    null;

  const rutas = new Set<string>();
  let internos = 0;
  const enlaces = html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi);
  for (const m of enlaces) {
    const href = m[1] ?? '';
    let destino: URL;
    try {
      destino = new URL(href, base);
    } catch {
      continue;
    }
    if (destino.hostname.toLowerCase() !== base.hostname.toLowerCase()) continue; // sólo el propio sitio
    internos += 1;
    const ruta = destino.pathname.replace(/\/+$/, '') || '/';
    if (rutas.size < MAX_PAGINAS) rutas.add(ruta);
  }
  return {
    titulo: titulo !== null ? limpio(titulo.replace(/<[^>]*>/g, '')) : null,
    metaDescription: meta !== null ? limpio(meta) : null,
    paginas: [...rutas].sort(),
    enlacesInternos: internos,
  };
}

/**
 * Inspecciona la portada del sitio. NUNCA lanza: devuelve el estado y el motivo, porque un sitio caído es
 * información útil del onboarding, no un error de SOEC.
 */
export async function inspeccionarSitio(entrada: string, opciones: OpcionesInspeccion = {}): Promise<ResultadoInspeccion> {
  const vacio = { httpStatus: null, titulo: null, metaDescription: null, paginas: [] as readonly string[], enlacesInternos: 0 };
  const validada = validarUrlDeSitio(entrada);
  if (!validada.ok) {
    return { url: (entrada ?? '').trim(), estado: validada.estado, esHttps: validada.estado !== 'NOT_HTTPS', error: validada.motivo, ...vacio };
  }
  let url = validada.url;
  const dominio = dominioRegistrable(url.hostname);
  const resolver = opciones.resolver ?? resolverPorDefecto;
  const fetchFn = opciones.fetchFn ?? fetch;
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS;
  const maxBytes = opciones.maxBytes ?? MAX_BYTES_POR_DEFECTO;

  for (let salto = 0; salto <= MAX_SALTOS; salto += 1) {
    const publico = await resolverPublico(url.hostname, resolver);
    if (!publico.ok) return { url: url.toString(), estado: 'REJECTED', esHttps: true, error: publico.motivo, ...vacio };

    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        method: 'GET',
        redirect: 'manual',
        signal: control.signal,
        headers: { accept: 'text/html', 'user-agent': 'SOEC-onboarding/1.0 (lectura única de la portada del propio sitio)' },
      });
      if (res.status >= 300 && res.status < 400) {
        const destino = res.headers.get('location');
        if (destino === null) return { url: url.toString(), estado: 'UNREACHABLE', esHttps: true, error: `redirección sin destino (${res.status})`, ...vacio, httpStatus: res.status };
        let siguiente: URL;
        try {
          siguiente = new URL(destino, url);
        } catch {
          return { url: url.toString(), estado: 'ERROR', esHttps: true, error: 'redirección inválida', ...vacio, httpStatus: res.status };
        }
        // Salir del dominio del negocio sería leer un sitio ajeno: se detiene aquí.
        if (siguiente.protocol !== 'https:' || dominioRegistrable(siguiente.hostname) !== dominio) {
          return { url: url.toString(), estado: 'REJECTED', esHttps: true, error: 'la dirección redirige fuera del sitio', ...vacio, httpStatus: res.status };
        }
        url = siguiente;
        continue;
      }
      if (!res.ok) {
        return { url: url.toString(), estado: 'UNREACHABLE', esHttps: true, error: `el sitio respondió ${res.status}`, ...vacio, httpStatus: res.status };
      }
      const cuerpo = (await res.text()).slice(0, maxBytes);
      const datos = extraer(cuerpo, url);
      return { url: url.toString(), estado: 'OK', esHttps: true, error: null, httpStatus: res.status, ...datos };
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      const abortado = control.signal.aborted;
      return {
        url: url.toString(),
        estado: abortado ? 'UNREACHABLE' : 'ERROR',
        esHttps: true,
        error: abortado ? 'el sitio no respondió en el tiempo esperado' : mensaje.slice(0, 200),
        ...vacio,
      };
    } finally {
      clearTimeout(reloj);
    }
  }
  return { url: url.toString(), estado: 'UNREACHABLE', esHttps: true, error: 'demasiadas redirecciones', ...vacio };
}
