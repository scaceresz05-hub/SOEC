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

/** La tarea de CP tal como la devuelve el backend: sin cuenta de anuncios, acción en Google. */
const TAREA_GOOGLE = {
  id: 'hand-cp-0001', canal: 'GOOGLE_ADS',
  titulo: 'Crea tu cuenta de anuncios en Google',
  motivo: 'Google ya está autorizado, pero todavía no encontramos una cuenta de anuncios donde SOEC pueda trabajar.',
  etiquetaAccion: 'Continuar con Google', urlProveedor: 'https://ads.google.com/nav/selectaccount',
  esperando: false, bloqueadaFuera: false,
};

/** Devuelve también las llamadas hechas, para poder exigir que MIRAR no escriba nada. */
function servidor(tarea: unknown = null): { llamadas: string[] } {
  const llamadas: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { method?: string }) => {
    const u = String(url);
    llamadas.push(`${init?.method ?? 'GET'} ${u}`);
    const cuerpo = u.includes('/api/google-ads/connection') ? CONEXION_GOOGLE
      : u.includes('/api/google-ads/accounts') ? { datos: { cuentas: [] } }
        : u.includes('/handoff') ? { organizationId: 'org-qa-conexiones', tarea, pendientes: 0 }
          : VISTA;
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return { llamadas };
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
    // El caso de CP tal como llega: autorizado y sin ninguna cuenta de publicidad. Lo que se ve desde el
    // primer pintado es qué falta, no un «elige cuenta» que se desmiente al pulsarlo.
    await waitFor(() => { expect(document.body.textContent).toMatch(/todavía no hay una cuenta de anuncios disponible/i); });
    expect(screen.queryByRole('button', { name: /Elegir cuenta/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Volver a buscar/i })).toBeTruthy();
    // Y ya no se manda a nadie a otra sección a buscar la acción.
    expect(document.body.textContent).not.toMatch(/desde\s+Adquisición/i);
  });

  /**
    * El defecto que esto fija: con la tarea activa, la pantalla ofrecía «Continuar con Google» arriba y
    * «Volver a buscar» abajo para el MISMO problema. Dos botones distintos para lo mismo no son dos
    * oportunidades: son una duda sobre cuál es el bueno.
    */
  it('con una tarea de Google activa hay UNA sola acción, y la tarjeta del canal cede', async () => {
    servidor(TAREA_GOOGLE);
    render(h(ConexionesPage));

    await waitFor(() => { expect(screen.getByText('Crea tu cuenta de anuncios en Google')).toBeTruthy(); });
    expect(screen.getByRole('button', { name: 'Continuar con Google' })).toBeTruthy();
    // La tarjeta del canal sigue contando el estado…
    await waitFor(() => { expect(document.body.textContent).toMatch(/todavía no hay una cuenta de anuncios disponible/i); });
    // …pero ya no compite con su propio botón.
    expect(screen.queryByRole('button', { name: /Volver a buscar/i })).toBeNull();
    expect(document.body.textContent).toMatch(/Es lo que SOEC te está pidiendo arriba/i);
    expect(screen.getAllByRole('button', { name: /Continuar con Google/i })).toHaveLength(1);
  });

  it('sin tarea activa, el canal recupera su propia acción', async () => {
    servidor(null);
    render(h(ConexionesPage));
    await waitFor(() => { expect(screen.getByRole('button', { name: /Volver a buscar/i })).toBeTruthy(); });
    expect(screen.queryByText('Crea tu cuenta de anuncios en Google')).toBeNull();
  });

  it('abrir la pantalla no escribe nada: ni un POST, ni un PATCH, ni un DELETE', async () => {
    const s = servidor(TAREA_GOOGLE);
    render(h(ConexionesPage));
    await waitFor(() => { expect(screen.getByText('Crea tu cuenta de anuncios en Google')).toBeTruthy(); });

    const escrituras = s.llamadas.filter((l) => /^(POST|PATCH|DELETE|PUT)\s/.test(l));
    expect(escrituras, 'mirar una pantalla no puede cambiar el estado de nadie').toEqual([]);
    expect(s.llamadas.some((l) => l.startsWith('GET') && l.includes('/handoff'))).toBe(true);
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
