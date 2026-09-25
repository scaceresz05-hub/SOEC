/**
 * EL SITIO DE UN NEGOCIO REAL NO ES «UNA DIRECCIÓN INTERNA» POR TENER IPv6.
 *
 * Esto salió de producción, no de una revisión de código. El sitio de CP —público, con HTTPS, abierto por
 * cualquiera en su navegador— quedaba registrado por la investigación como:
 *
 *     WEBSITE_AUDIT · FAILED · «el dominio no resuelve a una dirección pública»
 *
 * La causa: la defensa contra direcciones internas partía la IP por puntos y, si no salían cuatro números,
 * la declaraba no pública. Es decir, TODA dirección IPv6 era «interna». Un sitio detrás de Cloudflare publica
 * AAAA además de A; el contenedor resuelve ambas; bastaba una para que SOEC declarara inalcanzable un sitio
 * que funciona. Y el mensaje, además, culpaba al dominio del negocio.
 *
 * Estas pruebas fijan las dos mitades: lo público en IPv6 pasa, y lo interno —en IPv4, en IPv6 y en las formas
 * que esconden una IPv4 dentro de una IPv6— sigue bloqueado.
 */
import { describe, expect, it } from 'vitest';
import { esIpNoPublica } from '../src/onboarding/sitio-web';
import { auditarSitio } from '../src/investigacion/sitio-auditoria';
import type { PresupuestoRastreo } from '../src/investigacion/proveedores';

const PRESUPUESTO: PresupuestoRastreo = { maxPaginas: 3, maxProfundidad: 1, timeoutMsPorPagina: 1_000, maxBytesPorPagina: 50_000 };

/** Direcciones reales de un sitio detrás de Cloudflare: dos IPv4 y una IPv6 globales. */
const CLOUDFLARE = ['104.21.69.49', '172.67.204.176', '2606:4700:3030::6815:4531'];

const paginaHtml = (titulo: string): string =>
  `<html><head><title>${titulo}</title><meta name="description" content="Clínica dental"></head>
   <body><h1>${titulo}</h1><a href="/servicios/">Servicios</a><a href="https://wa.me/56900000000">WhatsApp</a></body></html>`;

describe('clasificación de direcciones', () => {
  it('una IPv6 global es pública: no es «interna» por no ser IPv4', () => {
    for (const ip of ['2606:4700:3030::6815:4531', '2800:3f0:4001:80f::200e', '2a00:1450:4003:80a::200e', '[2606:4700::1]']) {
      expect(esIpNoPublica(ip), `${ip} es una dirección pública de internet`).toBe(false);
    }
  });

  it('lo interno sigue siendo interno, en cualquiera de las dos familias', () => {
    const internas = [
      '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '::1', '::', 'fe80::1', 'fe80::1%eth0', 'fd00::1', 'fc00::abcd',
    ];
    for (const ip of internas) expect(esIpNoPublica(ip), `${ip} no puede considerarse pública`).toBe(true);
  });

  it('una IPv4 escondida dentro de una IPv6 se juzga por la IPv4 que lleva dentro', () => {
    // El caso que importa: envolver la dirección de metadatos de nube en IPv6 no la vuelve alcanzable.
    expect(esIpNoPublica('::ffff:169.254.169.254')).toBe(true);
    expect(esIpNoPublica('::ffff:127.0.0.1')).toBe(true);
    expect(esIpNoPublica('64:ff9b::10.0.0.1')).toBe(true);
    // Y la misma forma con una IPv4 pública sí lo es.
    expect(esIpNoPublica('::ffff:190.100.1.1')).toBe(false);
  });

  it('lo que no se entiende se rechaza: fail-closed', () => {
    for (const raro of ['', '   ', 'no-una-ip', '1.2.3', '999.1.1.1', 'gggg::1', '::zzzz']) {
      expect(esIpNoPublica(raro), `«${raro}» no es una dirección que se pueda dar por pública`).toBe(true);
    }
  });
});

describe('auditoría del sitio propio', () => {
  it('un sitio con A y AAAA públicas SE AUDITA (el caso de CP en producción)', async () => {
    const pedidas: string[] = [];
    const r = await auditarSitio('https://www.dentistaclaudiapacheco.cl/', PRESUPUESTO, {
      resolver: async () => CLOUDFLARE,
      fetchFn: (async (url: URL | string) => {
        pedidas.push(String(url));
        return new Response(paginaHtml('Clínica dental en Curicó'), { status: 200, headers: { 'content-type': 'text/html' } });
      }) as unknown as typeof fetch,
      ahora: () => '2026-09-25T20:00:00.000Z',
    });
    expect(r.alcanzable, r.error ?? '').toBe(true);
    expect(r.error).toBeNull();
    expect(r.paginas.length).toBeGreaterThan(0);
    expect(pedidas.length).toBeGreaterThan(0);
  });

  it('si UNA de las direcciones es interna, no se consulta el sitio (defensa intacta)', async () => {
    let pedido = false;
    const r = await auditarSitio('https://interno.example/', PRESUPUESTO, {
      resolver: async () => ['104.21.69.49', '169.254.169.254'],
      fetchFn: (async () => { pedido = true; return new Response('', { status: 200 }); }) as unknown as typeof fetch,
    });
    expect(r.alcanzable).toBe(false);
    expect(r.error).toMatch(/dirección pública/i);
    expect(pedido, 'ni una petición sale hacia un dominio que apunta a una dirección interna').toBe(false);
  });

  it('sólo con IPv6 pública también se audita: hay sitios que ya no publican IPv4', async () => {
    const r = await auditarSitio('https://solo-ipv6.example/', PRESUPUESTO, {
      resolver: async () => ['2606:4700:3030::6815:4531'],
      fetchFn: (async () => new Response(paginaHtml('Hola'), { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch,
    });
    expect(r.alcanzable).toBe(true);
  });
});
