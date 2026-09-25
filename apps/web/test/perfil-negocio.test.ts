// @vitest-environment jsdom
/**
 * PRESENTACIÓN DEL NEGOCIO en el panel (contrato de renderizado).
 *
 *   · SERVICIOS (CP Odontología) → NO renderiza el boilerplate SaaS («Software dental (SaaS)»,
 *     «Conseguir clínicas interesadas», «solicite una demo»); renderiza lo que el negocio declara.
 *   · SAAS (SmileFlow) → sigue renderizando su interfaz SaaS, igual que antes.
 *
 * Se monta la PÁGINA REAL con la misma cadena que producción (orgActiva → /api/plataforma/negocio).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { etiquetaTipo, etiquetaUbicacion, objetivoDeclarado, presentacionDe } from '../lib/perfil-negocio';

let orgActual = 'org-cp-odontologia';
vi.mock('../lib/org-activa', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, orgActiva: () => orgActual };
});
vi.mock('next/link', () => ({ default: (p: { href: string; children?: unknown; className?: string }) => h('a', { href: p.href, className: p.className }, p.children as never) }));

import Panel from '../app/negocios/page';

const jsonOk = (d: unknown) => ({ ok: true, status: 200, json: async () => d });
const noEncontrado = () => ({ ok: false, status: 404, json: async () => ({}) });

/** Lo que devuelve la API real para CP tras la integración (identidad comercial declarada). */
const NEGOCIO_CP = {
  organizationId: 'org-cp-odontologia', displayName: 'CP Odontología',
  legalName: 'CENTRO DE SALUD ODONTOLÓGICA CP SpA', rut: '77.214.436-9',
  modeloDeNegocio: 'SERVICIOS', mercado: 'Chile', estado: 'SOURCES_PENDING',
  categoriasDeclaradas: ['clínica dental', 'odontología general'], fuentes: [], datosHumanosPendientes: [],
  tipoDeNegocio: 'clínica odontológica',
  objetivoComercial: 'captar pacientes / evaluaciones odontológicas',
  especialidad: { principal: 'rehabilitación oral', tambienPresta: ['odontología general'] },
  ubicacionComercial: 'Provincia de Curicó, Región del Maule, Chile',
};

/** SmileFlow tal como responde hoy: sin identidad comercial declarada. */
const NEGOCIO_SMILEFLOW = {
  organizationId: 'org-smileflow', displayName: 'SmileFlow Clinic', legalName: 'SmileFlow', rut: null,
  modeloDeNegocio: 'SAAS_FUNNEL', mercado: 'Chile', estado: 'OBSERVING', categoriasDeclaradas: [], fuentes: [], datosHumanosPendientes: [],
  tipoDeNegocio: null, objetivoComercial: null, especialidad: null, ubicacionComercial: null,
};

function fetchCon(negocio: unknown) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u === '/api/plataforma/negocio') return jsonOk(negocio);
    if (u === '/api/plataforma/fundamentos') return jsonOk({ veredicto: 'FOUNDATION_REQUIRED', motivos: [], cimientosPresentes: [], puedeRecomendarInversionPublicitaria: false });
    return noEncontrado();
  });
}

describe('perfil-negocio · funciones puras', () => {
  it('SERVICIOS usa lo declarado; SAAS y e-commerce conservan su etiqueta', () => {
    expect(presentacionDe('SERVICIOS')).toBe('SERVICIOS');
    expect(etiquetaTipo(NEGOCIO_CP)).toBe('clínica odontológica');
    expect(etiquetaUbicacion(NEGOCIO_CP)).toBe('Provincia de Curicó, Región del Maule, Chile');
    expect(objetivoDeclarado(NEGOCIO_CP)).toBe('captar pacientes / evaluaciones odontológicas');
    expect(etiquetaTipo(NEGOCIO_SMILEFLOW)).toBe('Software dental (SaaS)');
    expect(etiquetaUbicacion(NEGOCIO_SMILEFLOW)).toBe('Chile');
    expect(etiquetaTipo({ modeloDeNegocio: 'ECOMMERCE_DISTRIBUCION', mercado: 'Chile' })).toBe('E-commerce / distribución');
  });

  it('SERVICIOS sin identidad declarada no hereda la de SaaS ni inventa objetivo', () => {
    const sinDeclarar = { modeloDeNegocio: 'SERVICIOS', mercado: 'Chile' };
    expect(etiquetaTipo(sinDeclarar)).toBe('Servicios');
    expect(objetivoDeclarado(sinDeclarar)).toBeNull();
  });
});

describe('panel · SERVICIOS no renderiza boilerplate SaaS; SAAS sí', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => cleanup());

  it('CP (SERVICIOS): cabecera con tipo y ubicación declarados, sin «Software dental (SaaS)»', async () => {
    orgActual = 'org-cp-odontologia';
    vi.stubGlobal('fetch', fetchCon(NEGOCIO_CP));
    render(h(Panel));
    await waitFor(() => expect(screen.getByText('CP Odontología')).toBeTruthy());
    expect(screen.getByText('clínica odontológica · Provincia de Curicó, Región del Maule, Chile')).toBeTruthy();
    expect(screen.queryByText(/Software dental \(SaaS\)/)).toBeNull();
  });

  it('CP (SERVICIOS): Objetivos muestra objetivo, especialidad y odontología general; nunca «Conseguir clínicas interesadas»', async () => {
    orgActual = 'org-cp-odontologia';
    vi.stubGlobal('fetch', fetchCon(NEGOCIO_CP));
    render(h(Panel));
    await waitFor(() => expect(screen.getByText('CP Odontología')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: /Objetivos/ }));
    await waitFor(() => expect(screen.getByText('captar pacientes / evaluaciones odontológicas')).toBeTruthy());
    expect(screen.getByText(/rehabilitación oral/)).toBeTruthy();
    expect(screen.getByText(/odontología general/)).toBeTruthy();
    expect(screen.queryByText(/Conseguir clínicas interesadas/)).toBeNull();
    expect(screen.queryByText(/demos y contactos reales/)).toBeNull();
  });

  it('CP (SERVICIOS): la pestaña Contactos no habla de demos', async () => {
    orgActual = 'org-cp-odontologia';
    vi.stubGlobal('fetch', fetchCon(NEGOCIO_CP));
    render(h(Panel));
    await waitFor(() => expect(screen.getByText('CP Odontología')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: /Contactos/ }));
    await waitFor(() => expect(screen.getByText(/Todavía no hay contactos para mostrar/)).toBeTruthy());
    expect(screen.queryByText(/demo/i)).toBeNull();
  });

  it('SmileFlow (SAAS): sigue mostrándose como «Software dental (SaaS)» con su objetivo de siempre', async () => {
    orgActual = 'org-smileflow';
    vi.stubGlobal('fetch', fetchCon(NEGOCIO_SMILEFLOW));
    render(h(Panel));
    await waitFor(() => expect(screen.getByText('SmileFlow Clinic')).toBeTruthy());
    expect(screen.getByText('Software dental (SaaS) · Chile')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Objetivos/ }));
    await waitFor(() => expect(screen.getByText('Conseguir clínicas interesadas')).toBeTruthy());
  });
});
