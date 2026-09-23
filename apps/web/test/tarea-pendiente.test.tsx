// @vitest-environment jsdom
/**
 * «SOEC NECESITA QUE HAGAS UNA COSA» · la tarjeta que sustituye a la lista de bloqueos técnicos.
 *
 * Lo que se fija aquí: una tarea a la vez, en lenguaje humano, con un botón; y que decir «ya lo hice» NO
 * cierra nada por sí solo — se lo pregunta al proveedor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TareaPendiente } from '../components/tarea-pendiente';

const TAREA_CP = {
  id: 'hand-abc123',
  titulo: 'Crea tu cuenta de anuncios en Google',
  motivo: 'Google ya está autorizado, pero todavía no encontramos una cuenta de anuncios donde SOEC pueda trabajar.',
  etiquetaAccion: 'Continuar con Google',
  urlProveedor: 'https://ads.google.com/nav/selectaccount',
  esperando: false,
  bloqueadaFuera: false,
};

function servidor(vista: unknown, alPost?: (url: string) => unknown): { llamadas: string[] } {
  const llamadas: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { method?: string }) => {
    const u = String(url);
    llamadas.push(`${init?.method ?? 'GET'} ${u}`);
    const cuerpo = init?.method === 'POST' && alPost ? alPost(u) : vista;
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return { llamadas };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('la tarjeta de una sola cosa', () => {
  it('muestra qué falta, por qué y un botón — y ningún nombre interno', async () => {
    servidor({ organizationId: 'org-qa', tarea: TAREA_CP, pendientes: 0 });
    render(h(TareaPendiente, { org: 'org-qa' }));

    await screen.findByText('Crea tu cuenta de anuncios en Google');
    expect(screen.getByText(/SOEC necesita que hagas una cosa/i)).toBeTruthy();
    expect(screen.getByText(/todavía no encontramos una cuenta de anuncios/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continuar con Google' })).toBeTruthy();

    const texto = document.body.textContent ?? '';
    for (const interno of ['ACCOUNT_PROVISIONING_REQUIRED', 'ACCOUNT_SELECTION_PENDING', 'OAuth', 'customerId', 'MCC', 'handoff', 'WAITING_EXTERNAL']) {
      expect(texto, `«${interno}» no puede salir a la pantalla`).not.toContain(interno);
    }
    // Un solo botón: no hay menú de opciones ni lista de pendientes.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('sin tareas pendientes no se pinta nada', async () => {
    servidor({ organizationId: 'org-qa', tarea: null, pendientes: 0 });
    const { container } = render(h(TareaPendiente, { org: 'org-qa' }));
    await waitFor(() => { expect(container.textContent).toBe(''); });
  });

  it('al pulsar el botón se abre el proveedor y la tarea queda esperando al mundo', async () => {
    const abrir = vi.fn();
    vi.stubGlobal('open', abrir);
    const s = servidor(
      { organizationId: 'org-qa', tarea: TAREA_CP, pendientes: 0 },
      () => ({ organizationId: 'org-qa', tarea: { ...TAREA_CP, esperando: true }, pendientes: 0 }),
    );
    render(h(TareaPendiente, { org: 'org-qa' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar con Google' }));

    await waitFor(() => { expect(screen.getByRole('button', { name: /Ya lo hice, compruébalo/i })).toBeTruthy(); });
    expect(abrir).toHaveBeenCalledWith('https://ads.google.com/nav/selectaccount', '_blank', 'noopener,noreferrer');
    expect(s.llamadas.some((l) => l.includes('POST') && l.includes('/handoff/hand-abc123/abierta'))).toBe(true);
    expect(screen.getByText(/Cuando la termines, vuelve y compruébalo aquí/i)).toBeTruthy();
  });

  it('«ya lo hice» pregunta al proveedor: si el mundo no cambió, la tarea sigue', async () => {
    const s = servidor(
      { organizationId: 'org-qa', tarea: { ...TAREA_CP, esperando: true }, pendientes: 0 },
      () => ({ organizationId: 'org-qa', tarea: { ...TAREA_CP, esperando: true }, pendientes: 0, revisadas: 1, completadas: 0 }),
    );
    render(h(TareaPendiente, { org: 'org-qa' }));
    fireEvent.click(await screen.findByRole('button', { name: /Ya lo hice, compruébalo/i }));

    await waitFor(() => { expect(s.llamadas.some((l) => l.includes('POST') && l.endsWith('/handoff/revisar'))).toBe(true); });
    expect(screen.getByText('Crea tu cuenta de anuncios en Google')).toBeTruthy(); // no se cerró sola
  });

  it('cuando la condición se cumple, la tarjeta desaparece', async () => {
    servidor(
      { organizationId: 'org-qa', tarea: { ...TAREA_CP, esperando: true }, pendientes: 0 },
      () => ({ organizationId: 'org-qa', tarea: null, pendientes: 0, revisadas: 1, completadas: 1 }),
    );
    const { container } = render(h(TareaPendiente, { org: 'org-qa' }));
    fireEvent.click(await screen.findByRole('button', { name: /Ya lo hice, compruébalo/i }));
    await waitFor(() => { expect(container.textContent).toBe(''); });
  });

  it('si el proveedor no deja avanzar, se dice y no se ofrece un botón inútil', async () => {
    servidor({ organizationId: 'org-qa', tarea: { ...TAREA_CP, bloqueadaFuera: true }, pendientes: 0 });
    render(h(TareaPendiente, { org: 'org-qa' }));
    await screen.findByText(/depende del proveedor y hoy no se puede avanzar/i);
    expect(screen.queryByRole('button', { name: 'Continuar con Google' })).toBeNull();
  });

  it('cuando la acción ocurre dentro de SOEC, no se abre ninguna pestaña', async () => {
    const abrir = vi.fn();
    vi.stubGlobal('open', abrir);
    const dentro = vi.fn();
    servidor({ organizationId: 'org-qa', tarea: { ...TAREA_CP, titulo: 'Elige en qué cuenta debe trabajar SOEC', etiquetaAccion: 'Elegir cuenta', urlProveedor: null }, pendientes: 2 });
    render(h(TareaPendiente, { org: 'org-qa', alActuarDentro: dentro }));

    fireEvent.click(await screen.findByRole('button', { name: 'Elegir cuenta' }));
    await waitFor(() => { expect(dentro).toHaveBeenCalled(); });
    expect(abrir).not.toHaveBeenCalled();
    // Lo que queda detrás se cuenta, no se lista.
    expect(screen.getByText(/quedan 2 cosa\(s\) más/i)).toBeTruthy();
  });
});
