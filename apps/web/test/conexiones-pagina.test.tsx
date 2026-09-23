// @vitest-environment jsdom
/**
 * LA PANTALLA COMPLETA de «Conexiones y permisos», que es a donde los errores de media aplicación mandan a la
 * persona. Dos cosas que antes no se cumplían:
 *
 *   · el permiso de hacer cambios (`ESCRITURA_ADS`) se muestra AQUÍ — el mensaje de error decía «actívalo en
 *     Conexiones» y en Conexiones no aparecía;
 *   · la conexión de Google se hace aquí mismo, y el estado se lee en lenguaje de negocio, sin nombres internos.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import ConexionesPage from '../app/negocios/conexiones/page';

vi.mock('../lib/org-activa', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, orgActiva: () => 'org-qa-conexiones' };
});

const CAPACIDADES = [
  'INGESTA_GROWTH', 'MEDICION_REAL', 'DIRECTOR_REAL', 'CICLO_DIRECTOR', 'AUTONOMIA_ADS', 'MONITOR_SEGURIDAD', 'ESCRITURA_ADS',
].map((capacidad) => ({ capacidad, habilitada: false, origen: 'SISTEMA', nota: null, conexionLista: true, requiereConexion: null }));

const VISTA = {
  organizationId: 'org-qa-conexiones',
  conexiones: [{
    provider: 'GROWTH_M2M', estado: 'CONNECTED', cuenta: { id: null, nombre: null },
    configuracion: { baseUrl: 'https://qa.example' },
    credencial: { configurada: true, clase: 'DEPOSITO_CIFRADO' },
    ultimoError: null, validadaEn: null,
  }],
  capacidades: CAPACIDADES,
  depositoDisponible: true,
  oauthGoogleAds: { estado: 'ACCOUNT_SELECTION_PENDING', customerId: null, salud: 'UNKNOWN' },
  oauthMeta: null,
};

const CONEXION_GOOGLE = {
  datos: {
    conexion: { estado: 'ACCOUNT_SELECTION_PENDING', salud: 'UNKNOWN', customerId: null, descriptiveName: null, timeZone: null, currencyCode: null, needsReauth: false, connectedAt: null },
    datos: { estado: 'SIN_DATOS', capturedAt: null, dataThrough: null, ultimaActualizacion: null, impressions: null, clicks: null, cost: null },
    configurado: true,
  },
};

function servidor(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url);
    const cuerpo = u.includes('/api/google-ads/connection') ? CONEXION_GOOGLE
      : u.includes('/api/google-ads/accounts') ? { datos: { cuentas: [] } }
        : VISTA;
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Conexiones y permisos', () => {
  it('el permiso de hacer cambios se ve, apagado, y dice lo que implica', async () => {
    servidor();
    render(h(ConexionesPage));
    await waitFor(() => { expect(screen.getByText(/Permiso para que SOEC haga cambios en tu cuenta/i)).toBeTruthy(); });
    const casilla = screen.getByRole('checkbox', { name: /Permiso para que SOEC haga cambios/i }) as HTMLInputElement;
    expect(casilla.checked).toBe(false); // nace apagado y nadie lo enciende por ti
    expect(document.body.textContent).toMatch(/gastar y encender campañas siguen siendo decisiones tuyas/i);
  });

  it('la conexión de Google se hace en esta misma pantalla, no en otra', async () => {
    servidor();
    render(h(ConexionesPage));
    await waitFor(() => { expect(screen.getByText(/Conexión a Google Ads/i)).toBeTruthy(); });
    expect(screen.getByRole('button', { name: /Elegir cuenta/i })).toBeTruthy();
    // Y ya no se manda a nadie a otra sección a buscar la acción.
    expect(document.body.textContent).not.toMatch(/desde\s+Adquisición/i);
  });

  it('ningún nombre interno llega a la pantalla', async () => {
    servidor();
    render(h(ConexionesPage));
    await waitFor(() => { expect(screen.getByText(/Conexión a Google Ads/i)).toBeTruthy(); });
    for (const interno of ['ACCOUNT_SELECTION_PENDING', 'NOT_CONNECTED', 'ESCRITURA_ADS', 'MEDICION_REAL', 'GOOGLE_ADS', 'GROWTH_M2M']) {
      expect(document.body.textContent, `«${interno}» no puede salir a la pantalla`).not.toContain(interno);
    }
  });

  it('las cuatro decisiones se explican separadas, sin implicarse entre sí', async () => {
    servidor();
    render(h(ConexionesPage));
    await waitFor(() => { expect(screen.getByText(/Cuatro decisiones distintas/i)).toBeTruthy(); });
    const texto = document.body.textContent ?? '';
    expect(texto).toMatch(/Conexión.*MIRAR/i);
    expect(texto).toMatch(/Permiso para hacer cambios/i);
    expect(texto).toMatch(/Autorización financiera/i);
    expect(texto).toMatch(/Operación autónoma/i);
    expect(texto).toMatch(/Conectar no autoriza cambios; permitir cambios no autoriza gasto/i);
  });
});
