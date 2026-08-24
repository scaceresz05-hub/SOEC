// @vitest-environment jsdom
/**
 * TEST DE INTEGRACIÓN DEL WIRING PRODUCTIVO (el que faltó).
 *
 * Los 7 tests aislados probaban <BotonActualizarAds/> con una `org` inyectada a mano; no podían detectar
 * un fallo de INTEGRACIÓN en `negocios/page.tsx` (que la org activa real no llegara al botón, o que el
 * aviso del padre no se renderizara). Este test monta la PÁGINA REAL, con la misma cadena que producción:
 *   orgActiva() → cargar(panel) → negocio truthy → <BotonActualizarAds org={org}/> → clic → POST refresh.
 * Reproduce el caso "Mi negocio → SmileFlow activo → panel cargado → botón".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// La MISMA fuente de verdad de la organización que usa la página para cargar el panel.
// La página importa '../../lib/org-activa'; aquí se resuelve al mismo módulo absoluto → el mock aplica.
vi.mock('../lib/org-activa', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, orgActiva: () => 'smileflow' }; // slug UI/sesión real (alias legado; se canoniza upstream)
});
// next/link no es necesario para el flujo del botón; lo reducimos a un <a> para montar en jsdom.
vi.mock('next/link', () => ({ default: (p: { href: string; children?: unknown; className?: string }) => h('a', { href: p.href, className: p.className }, p.children as never) }));

import Panel from '../app/negocios/page';

const jsonOk = (d: unknown) => ({ ok: true, status: 200, json: async () => d });

function fetchDeSmileFlow(refresh: () => { status: number; ok: boolean; json: () => Promise<unknown> }) {
  return vi.fn(async (url: string, _opts?: { method?: string }) => {
    const u = String(url);
    if (u === '/api/plataforma/negocio')
      return jsonOk({ displayName: 'SmileFlow Clinic', legalName: 'SmileFlow', rut: null, modeloDeNegocio: 'SAAS_FUNNEL', mercado: 'Chile', estado: 'ACTIVE', categoriasDeclaradas: [], fuentes: [], datosHumanosPendientes: [] });
    if (u === '/api/plataforma/fundamentos') return jsonOk({ veredicto: 'OBSERVAR', motivos: [], cimientosPresentes: [], puedeRecomendarInversionPublicitaria: false });
    if (u === '/api/medicion/panel') return jsonOk({ googleAdsConfigured: false });
    if (u === '/api/medicion/lectura-director') return jsonOk({ veredicto: 'OBSERVAR' });
    if (u === '/api/medicion/plan-accion') return jsonOk({});
    if (u === '/api/medicion/g2a-bandeja') return jsonOk({ items: [] });
    if (u === '/api/google-ads/refresh') return refresh();
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

describe('Wiring productivo: Mi negocio → SmileFlow → botón Actualizar', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => cleanup());

  it('active_organization_reaches_button + button_click_invokes_POST /api/google-ads/refresh (guarda NO se dispara)', async () => {
    const fetchMock = fetchDeSmileFlow(() => ({ status: 200, ok: true, json: async () => ({ datos: { estado: 'OK', dataThrough: '2026-08-19' } }) }));
    vi.stubGlobal('fetch', fetchMock);

    render(h(Panel));

    // El botón sólo aparece cuando el panel cargó el negocio con la MISMA org activa (SmileFlow).
    const btn = await waitFor(() => screen.getByRole('button', { name: /Actualizar/ }));
    expect(btn).toBeTruthy();

    fireEvent.click(btn);

    // FETCH_EXECUTED: se posteó al refresh manual P1 (no router.refresh, no la guarda de "sin empresa").
    await waitFor(() => {
      const llamado = fetchMock.mock.calls.some((c) => String(c[0]) === '/api/google-ads/refresh' && (c[1] as { method?: string } | undefined)?.method === 'POST');
      expect(llamado).toBe(true);
    });
    // GUARD_TRIGGERED = NO: nunca apareció el aviso de "sin empresa activa".
    expect(screen.queryByText(/No hay una empresa activa/)).toBeNull();
    // ON_AVISO_RENDERED: el resultado se muestra en el panel (feedback no silencioso).
    await waitFor(() => expect(screen.getByText(/Datos actualizados/)).toBeTruthy());
  });

  it('missing_organization_produces_visible_error_not_silent (no hay org activa)', async () => {
    // Sin org: la página no monta el botón; muestra el estado explícito "no elegiste ninguna empresa".
    vi.doMock('../lib/org-activa', async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      return { ...real, orgActiva: () => null };
    });
    vi.resetModules();
    const { default: PanelSinOrg } = await import('../app/negocios/page');
    vi.stubGlobal('fetch', fetchDeSmileFlow(() => ({ status: 200, ok: true, json: async () => ({ datos: { estado: 'OK' } }) })));

    render(h(PanelSinOrg));
    await waitFor(() => expect(screen.getByText(/Todavía no elegiste ninguna empresa/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Actualizar$/ })).toBeNull(); // no botón mudo
    vi.doUnmock('../lib/org-activa');
  });
});
