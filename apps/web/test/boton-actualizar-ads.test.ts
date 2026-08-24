// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BotonActualizarAds, mensajeRefreshAds } from '../components/boton-actualizar-ads';

// El include de vitest sólo matchea *.test.ts, así que se usa React.createElement en vez de JSX.

describe('mensajeRefreshAds (mapeo puro)', () => {
  it('home_update_reports_success', () => {
    const m = mensajeRefreshAds({ httpStatus: 200, datos: { estado: 'OK', dataThrough: '2026-08-19' } });
    expect(m.ok).toBe(true);
    expect(m.texto).toContain('Datos actualizados');
  });
  it('home_update_reports_error (fallo / no conectado / reauth)', () => {
    expect(mensajeRefreshAds({ httpStatus: 200, datos: { estado: 'FALLO', error: 'x' } }).ok).toBe(false);
    expect(mensajeRefreshAds({ httpStatus: 409 }).texto).toContain('no está conectado');
    expect(mensajeRefreshAds({ httpStatus: 200, datos: { estado: 'NEEDS_REAUTH' } }).texto).toContain('reconexión');
  });
});

describe('BotonActualizarAds', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => cleanup());

  it('home_update_invokes_existing_google_ads_manual_refresh + is_not_router_refresh_only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, datos: { estado: 'OK', dataThrough: '2026-08-19' } }) });
    vi.stubGlobal('fetch', fetchMock);
    const onAviso = vi.fn();
    render(h(BotonActualizarAds, { org: 'org-smileflow', onAviso }));
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('/api/google-ads/refresh'); // use-case P1 real, no router.refresh
    expect(opts.method).toBe('POST');
    await waitFor(() => expect(onAviso).toHaveBeenCalledWith(expect.stringContaining('Datos actualizados'), true));
  });

  it('home_update_disables_while_running', async () => {
    let resolver: (v: unknown) => void = () => {};
    const fetchMock = vi.fn(() => new Promise((res) => { resolver = res; }));
    vi.stubGlobal('fetch', fetchMock);
    render(h(BotonActualizarAds, { org: 'org-smileflow', onAviso: () => {} }));
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true)); // no doble-clic concurrente
    expect(btn.textContent).toContain('Actualizando');
    resolver({ status: 200, json: async () => ({ datos: { estado: 'OK' } }) });
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  it('home_update_reports_error (fallo de red ⇒ feedback, no silencio)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    const onAviso = vi.fn();
    render(h(BotonActualizarAds, { org: 'org-smileflow', onAviso }));
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(onAviso).toHaveBeenCalledWith(expect.stringContaining('No pudimos actualizar'), false));
  });

  it('home_update_does_not_mutate_google_ads: sólo llama al refresh read-only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ datos: { estado: 'OK' } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(h(BotonActualizarAds, { org: 'org-smileflow', onAviso: () => {} }));
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    for (const call of fetchMock.mock.calls) {
      const url = String(call[0]);
      expect(url).toBe('/api/google-ads/refresh');
      expect(url).not.toMatch(/mutate|select-account|disconnect|budget/i);
    }
  });

  it('sin empresa activa: feedback explícito y NINGÚN fetch (no-op no silencioso)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onAviso = vi.fn();
    render(h(BotonActualizarAds, { org: null, onAviso }));
    fireEvent.click(screen.getByRole('button'));
    expect(onAviso).toHaveBeenCalledWith(expect.stringContaining('No hay una empresa activa'), false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
