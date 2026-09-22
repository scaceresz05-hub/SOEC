// @vitest-environment jsdom
/**
 * OBJETIVOS Y CRITERIOS · «todavía no sé la meta» tiene que existir EN LA PANTALLA.
 *
 * La regla de la Fase D vivía sólo en el servidor: el modelo aceptaba una meta por aprender, pero esta página
 * exigía escribir un número —sin él ni siquiera enviaba el indicador— y ofrecía un mínimo de evidencia
 * escrito a mano (500) distinto del que el servidor guarda. Aquí se fija el contrato visible:
 *
 *   · se puede decir «Todavía no lo sé» y la empresa queda igual de configurada;
 *   · la cifra recomendada la manda el SERVIDOR y se guarda como recomendación suya, no como decisión del dueño;
 *   · quien escribe su propio número, firma ese número.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { documentoDeObjetivos, type FormularioObjetivos, type VistaPolitica } from '../lib/politica-client';
import ObjetivosPage from '../app/negocios/objetivos/page';

vi.mock('../lib/org-activa', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, orgActiva: () => 'org-qa-objetivos' };
});

const RECOMENDACION = { metrica: 'IMPRESSIONS', valor: 1000, version: 'v1' };

const formulario = (over: Partial<FormularioObjetivos> = {}): FormularioObjetivos => ({
  objetivo: 'más pacientes nuevos',
  contexto: '',
  accion: 'whatsapp_intent',
  accionLibre: '',
  indicador: 'contactos',
  conoceMeta: 'TODAVIA_NO',
  meta: '',
  horizonte: '30',
  modoEvidencia: 'RECOMENDADA',
  evidencia: '',
  pausa: '',
  ...over,
});

const vista = (over: Partial<VistaPolitica> = {}): VistaPolitica => ({
  organizationId: 'org-qa-objetivos',
  objetivoDeclarado: 'más pacientes nuevos',
  politica: { politica: null, kpis: [], eventos: [], reglas: [], limites: null, canales: [] },
  completitud: { estado: 'EVALUATION_PROFILE_INCOMPLETE', faltantes: [], recomendaciones: [], actualizadoEn: null },
  referencias: { oferta: [], territorios: [], restricciones: [] },
  perfilEvaluableDisponible: false,
  recomendacionEvidencia: RECOMENDACION,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('documento que se envía al guardar', () => {
  it('«todavía no lo sé» envía el indicador SIN meta: el servidor lo guarda como por aprender', () => {
    const doc = documentoDeObjetivos(formulario(), RECOMENDACION);
    expect(doc.kpis).toHaveLength(1);
    expect(doc.kpis![0]!.clave).toBe('contactos');
    expect(doc.kpis![0]!.targetValue).toBeNull();
    expect(doc.kpis![0]!.nota).toContain('aprender');
  });

  it('la evidencia recomendada viaja con el número del SERVIDOR y como recomendación suya', () => {
    const doc = documentoDeObjetivos(formulario(), RECOMENDACION);
    const ev = doc.reglas!.find((r) => r.tipo === 'EVIDENCE_MINIMUM')!;
    expect(ev.valor).toBe(1000);
    expect(ev.procedencia).toBe('SYSTEM_DEFAULT');
    expect(ev.nota).toContain('v1');
  });

  it('sin recomendación del servidor no se inventa ningún número en la pantalla', () => {
    const doc = documentoDeObjetivos(formulario(), null);
    expect((doc.reglas ?? []).some((r) => r.tipo === 'EVIDENCE_MINIMUM')).toBe(false);
  });

  it('quien escribe su propio número, lo firma', () => {
    const doc = documentoDeObjetivos(formulario({ modoEvidencia: 'PROPIA', evidencia: '2500' }), RECOMENDACION);
    const ev = doc.reglas!.find((r) => r.tipo === 'EVIDENCE_MINIMUM')!;
    expect(ev.valor).toBe(2500);
    expect(ev.procedencia).toBe('USER_DEFINED');
  });

  it('declarar la meta la envía tal cual, firmada por el negocio', () => {
    const doc = documentoDeObjetivos(formulario({ conoceMeta: 'SI', meta: '15' }), RECOMENDACION);
    expect(doc.kpis![0]!.targetValue).toBe(15);
    expect(doc.kpis![0]!.nota).toBeUndefined();
  });
});

describe('la pantalla real', () => {
  const montar = (v: VistaPolitica): void => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(h(ObjetivosPage));
  };

  it('ofrece decir que todavía no se conoce la meta, y explica qué implica', async () => {
    montar(vista());
    const boton = await screen.findByRole('button', { name: /Todavía no lo sé/i });
    fireEvent.click(boton);
    await waitFor(() => {
      expect(screen.getByText(/no hace falta inventar un número/i)).toBeTruthy();
      expect(screen.getByText(/no subirá presupuestos/i)).toBeTruthy();
    });
    // Y mientras no se elige «Sí», no se pide ningún número.
    expect(screen.queryByPlaceholderText('un número')).toBeNull();
  });

  it('muestra la cifra recomendada que manda el servidor, no una escrita en la pantalla', async () => {
    montar(vista());
    fireEvent.click(await screen.findByRole('button', { name: /opciones avanzadas|avanzad/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Usar la recomendación de SOEC: 1\.000 impresiones/i })).toBeTruthy();
    });
    expect(screen.queryByText(/500 es un punto de partida/i)).toBeNull();
  });

  it('cuando la meta se está aprendiendo, la pantalla lo dice', async () => {
    montar(vista({ completitud: { estado: 'EVALUATION_PROFILE_COMPLETE', faltantes: [], recomendaciones: [], lineaBase: 'LEARNING_BASELINE', actualizadoEn: null } }));
    await waitFor(() => {
      expect(screen.getByText(/está aprendiendo tu meta/i)).toBeTruthy();
    });
  });
});
