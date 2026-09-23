// @vitest-environment jsdom
/**
 * CONEXIONES Y PERMISOS · la pantalla donde alguien conecta su publicidad y entiende qué ha autorizado.
 *
 * Tenía dos defectos que se ven juntos en producción: imprimía `ACCOUNT_SELECTION_PENDING` —un nombre interno,
 * en inglés— y no ofrecía ninguna acción para conectar, aunque los mensajes de error de toda la aplicación
 * mandan justo ahí. Estas pruebas fijan lo contrario:
 *
 *   · ningún nombre interno llega a la pantalla, en ningún estado;
 *   · en cada estado hay UNA sola próxima acción, y es la correcta;
 *   · sin cuentas disponibles no se abre un selector vacío: se explica qué falta;
 *   · el permiso de hacer cambios se ve, se puede apagar, y NADA lo enciende solo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GoogleAdsConexion, vistaDelEstadoGoogle } from '../components/google-ads-conexion';

const ENUMS_INTERNOS = [
  'ACCOUNT_SELECTION_PENDING', 'NOT_CONNECTED', 'OAUTH_PENDING', 'NEEDS_REAUTH', 'CONNECTED', 'DISCONNECTED',
  'ESCRITURA_ADS', 'MEDICION_REAL', 'customerId', 'refresh_token', 'developer-token', 'MCC',
];

const conexion = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  estado: 'NOT_CONNECTED', salud: 'UNKNOWN', customerId: null, descriptiveName: null,
  timeZone: null, currencyCode: null, needsReauth: false, connectedAt: null, ...over,
});

const estadoDe = (conn: Record<string, unknown>): Record<string, unknown> => ({
  conexion: conn,
  datos: { estado: 'SIN_DATOS', capturedAt: null, dataThrough: null, ultimaActualizacion: null, impressions: null, clicks: null, cost: null },
  configurado: true,
});

/** Doble del BFF: responde el estado de la conexión y, si se piden, las cuentas descubiertas. */
function servidor(conn: Record<string, unknown>, cuentas: unknown[] = []): { llamadas: string[] } {
  const llamadas: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { method?: string }) => {
    const u = String(url);
    llamadas.push(`${init?.method ?? 'GET'} ${u}`);
    const cuerpo = u.includes('/accounts') ? { datos: { cuentas } } : { datos: estadoDe(conn) };
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return { llamadas };
}

const textoVisible = (): string => document.body.textContent ?? '';
const sinEnumsInternos = (): void => {
  for (const e of ENUMS_INTERNOS) expect(textoVisible(), `«${e}» no puede salir a la pantalla`).not.toContain(e);
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('traducción de estados (función pura)', () => {
  it.each([
    ['NOT_CONNECTED', null, 'no está conectado', 'CONECTAR'],
    ['OAUTH_PENDING', null, 'Falta autorizar', 'CONECTAR'],
    ['ACCOUNT_SELECTION_PENDING', null, 'Elige qué cuenta', 'ELEGIR_CUENTA'],
    ['ACCOUNT_SELECTION_PENDING', 2, 'Elige qué cuenta', 'ELEGIR_CUENTA'],
    ['ACCOUNT_SELECTION_PENDING', 0, 'todavía no hay una cuenta de anuncios disponible', 'ESPERAR_CUENTA'],
    ['CONNECTED', null, 'conectado', 'NINGUNA'],
    ['NEEDS_REAUTH', null, 'vuelvas a autorizar', 'RECONECTAR'],
  ])('%s (cuentas: %s) se dice en lenguaje de negocio', (estado, cuentas, fragmento, accion) => {
    const v = vistaDelEstadoGoogle(estado, cuentas as number | null);
    expect(`${v.titulo} ${v.explicacion}`).toContain(fragmento);
    expect(v.accion).toBe(accion);
    for (const e of ENUMS_INTERNOS) expect(`${v.titulo} ${v.explicacion} ${v.etiquetaAccion ?? ''}`).not.toContain(e);
  });
});

describe('la pantalla, estado por estado', () => {
  it('sin conectar: ofrece conectar, y aclara que conectar no permite cambiar nada', async () => {
    servidor(conexion());
    render(h(GoogleAdsConexion, { org: 'org-qa' }));
    await screen.findByRole('button', { name: /Conectar Google Ads/i });
    expect(textoVisible()).toContain('no está conectado');
    expect(textoVisible()).toMatch(/no le permite cambiar nada/i);
    sinEnumsInternos();
  });

  it('autorización a medias: explica que quedó a medias y deja continuar', async () => {
    servidor(conexion({ estado: 'OAUTH_PENDING' }));
    render(h(GoogleAdsConexion, { org: 'org-qa' }));
    await screen.findByRole('button', { name: /Continuar con Google/i });
    expect(textoVisible()).toContain('Falta autorizar el acceso con Google');
    sinEnumsInternos();
  });

  it('autorizado y sin cuenta elegida: ofrece elegir cuenta', async () => {
    servidor(conexion({ estado: 'ACCOUNT_SELECTION_PENDING' }), [
      { customerId: '1111111111', descriptiveName: 'Clínica QA', currencyCode: 'CLP', timeZone: 'America/Santiago', manager: false, testAccount: false },
    ]);
    render(h(GoogleAdsConexion, { org: 'org-qa' }));
    const boton = await screen.findByRole('button', { name: /Elegir cuenta/i });
    expect(textoVisible()).toContain('Elige qué cuenta administrará SOEC');
    fireEvent.click(boton);
    await waitFor(() => { expect(screen.getByText(/Clínica QA/)).toBeTruthy(); });
    expect(screen.getByRole('button', { name: /Usar esta cuenta/i })).toBeTruthy();
    sinEnumsInternos();
  });

  /** El caso de CP: autorizó con Google y su cuenta no tiene ninguna cuenta de publicidad. */
  it('autorizado y SIN cuentas: ni selector vacío ni jerga, un mensaje y una sola acción', async () => {
    servidor(conexion({ estado: 'ACCOUNT_SELECTION_PENDING' }), []);
    render(h(GoogleAdsConexion, { org: 'org-qa' }));
    fireEvent.click(await screen.findByRole('button', { name: /Elegir cuenta/i }));

    await waitFor(() => { expect(textoVisible()).toContain('todavía no hay una cuenta de anuncios disponible'); });
    expect(textoVisible()).toMatch(/configurar una con Google/i);
    // No hay selector: ni radios, ni un botón de confirmar una elección que no existe.
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Usar esta cuenta/i })).toBeNull();
    // Una sola próxima acción.
    expect(screen.getByRole('button', { name: /Volver a buscar/i })).toBeTruthy();
    sinEnumsInternos();
  });

  it('conectado: nombre, moneda y zona horaria; el identificador queda en detalles', async () => {
    servidor(conexion({
      estado: 'CONNECTED', customerId: '1234567890', descriptiveName: 'Clínica QA · Google Ads',
      currencyCode: 'CLP', timeZone: 'America/Santiago',
    }));
    render(h(GoogleAdsConexion, { org: 'org-qa' }));
    await waitFor(() => { expect(textoVisible()).toContain('Google Ads conectado'); });
    expect(textoVisible()).toContain('Clínica QA · Google Ads');
    expect(textoVisible()).toContain('CLP');
    expect(textoVisible()).toContain('America/Santiago');
    // El identificador de la cuenta existe, pero dentro de «Detalles técnicos», no como dato principal.
    const detalles = document.querySelector('details');
    expect(detalles?.textContent).toContain('123-456-7890');
    sinEnumsInternos();
  });

  it('cambiar de cuenta pide confirmación: no ocurre de un clic', async () => {
    servidor(conexion({ estado: 'CONNECTED', customerId: '1234567890', descriptiveName: 'Clínica QA', currencyCode: 'CLP', timeZone: 'America/Santiago' }), []);
    render(h(GoogleAdsConexion, { org: 'org-qa' }));
    fireEvent.click(await screen.findByRole('button', { name: /Cambiar de cuenta/i }));
    await waitFor(() => { expect(textoVisible()).toMatch(/mueve dónde trabaja SOEC/i); });
    expect(screen.getByRole('button', { name: /No, dejarla como está/i })).toBeTruthy();
  });

  it('autorización caducada: ofrece volver a autorizar y tranquiliza sobre el histórico', async () => {
    servidor(conexion({ estado: 'NEEDS_REAUTH', needsReauth: true }));
    render(h(GoogleAdsConexion, { org: 'org-qa' }));
    await screen.findByRole('button', { name: /Volver a autorizar con Google/i });
    expect(textoVisible()).toMatch(/datos históricos están conservados/i);
    sinEnumsInternos();
  });
});

describe('conectar no autoriza nada más', () => {
  it('ni conectar ni elegir cuenta tocan permisos, mandato, gasto ni activación', async () => {
    const s = servidor(conexion({ estado: 'ACCOUNT_SELECTION_PENDING' }), [
      { customerId: '1111111111', descriptiveName: 'Clínica QA', currencyCode: 'CLP', timeZone: 'America/Santiago', manager: false, testAccount: false },
    ]);
    render(h(GoogleAdsConexion, { org: 'org-qa' }));
    fireEvent.click(await screen.findByRole('button', { name: /Elegir cuenta/i }));
    await waitFor(() => { expect(screen.getByRole('button', { name: /Usar esta cuenta/i })).toBeTruthy(); });
    fireEvent.click(screen.getByRole('button', { name: /Usar esta cuenta/i }));

    await waitFor(() => { expect(s.llamadas.some((l) => l.includes('select-account'))).toBe(true); });
    // Ninguna llamada a capacidades, mandato, gobierno, modo operativo ni activación.
    const prohibidas = /capacidad|mandate|mandato|gobierno|operational-mode|activar/i;
    expect(s.llamadas.filter((l) => prohibidas.test(l))).toEqual([]);
  });
});
