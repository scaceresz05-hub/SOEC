/**
 * CP Odontología · Growth fase 5: estructura comercial preparada SIN gasto.
 *
 * Valida los dos specs versionados que la describen: las 4 líneas en BORRADOR de SOEC y la arquitectura
 * Google Search (una campaña, 4 grupos). No toca Google ni ninguna base.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALCANCE_COMERCIAL_CP_ODONTOLOGIA } from '../src/plataforma/negocios/org-cp-odontologia';

const leer = (r: string) => JSON.parse(readFileSync(join(__dirname, '../../..', r), 'utf8'));
const BORRADORES = leer('docs/growth/cp-odontologia-borradores.json') as {
  borradores: { campaniaId: string; campania: Record<string, unknown>; decision: Record<string, unknown> }[];
};
type Grupo = { id: string; nombre: string; borradorSoec: string; urlsFinales: string[]; keywords: string[]; negativasGrupo: string[] };
const SEARCH = leer('docs/growth/cp-odontologia-google-search.json') as {
  estado: string;
  campania: {
    nombre: string; tipo: string; presupuesto: unknown; presupuestoCompartido: boolean;
    segmentacionGeografica: { comunasAlcanceComercial: string[]; comunasEjecutablesGoogleAds: string[]; comunasNoSegmentablesSinDesborde: string[]; criterioUbicacion: string };
    parametrosUrlFinal: string; negativasCampania: string[]; grupos: Grupo[];
  };
  keywordsRetiradas: string[];
  fueraDePautaPagada: { borradorSoec: string; pautaPagada: boolean }[];
};
const WWW = 'https://www.dentistaclaudiapacheco.cl';
const LANDINGS_REALES = new Set([
  '/odontologia-general/',
  ...['carillas-dentales', 'coronas-dentales', 'puentes-dentales', 'implantes-dentales', 'protesis-removibles-totales', 'protesis-removibles-parciales', 'protesis-hibrida'].map((s) => `/servicios/${s}/`),
]);

describe('fase 5 · SOEC: exactamente 4 borradores de CP', () => {
  it('las cuatro líneas, con su canal, presupuesto null y el alcance comercial 9/9', () => {
    expect(BORRADORES.borradores.map((b) => [b.campania['nombre'], b.campania['canal'], b.campania['presupuesto']])).toEqual([
      ['CP | Implantes | Provincia de Curicó', 'GOOGLE_SEARCH', null],
      ['CP | Rehabilitación y Prótesis | Provincia de Curicó', 'GOOGLE_SEARCH', null],
      ['CP | Carillas y Estética | Provincia de Curicó', 'ORGANIC_INSTAGRAM', null],
      ['CP | Odontología General | Provincia de Curicó', 'GOOGLE_SEARCH', null],
    ]);
    for (const b of BORRADORES.borradores) expect(b.campania['alcanceGeografico']).toEqual(ALCANCE_COMERCIAL_CP_ODONTOLOGIA);
    expect(ALCANCE_COMERCIAL_CP_ODONTOLOGIA.comunas).toHaveLength(9);
  });

  it('odontología general apunta a su landing y no afirma Fonasa, precios ni KPIs', () => {
    const og = BORRADORES.borradores.find((b) => b.campaniaId === 'cp-odontologia-general-provincia-curico')!;
    expect(og.campania['destino']).toBe(`${WWW}/odontologia-general/`);
    expect(og.campania['metricas']).toEqual(['whatsapp_intent', 'phone_intent']);
    const texto = JSON.stringify(og);
    // «Fonasa» sólo aparece para excluirlo, nunca como modalidad atendida.
    expect(texto).not.toMatch(/atiende[^.]*fonasa|convenio|reembolso|cobertura/i);
    expect(texto).not.toMatch(/\$\s?\d|CLP|leads\/mes|CPL|simulad/i);
  });
});

describe('fase 5 · Google Search: una campaña, 4 grupos, sin gasto', () => {
  const c = SEARCH.campania;

  it('una sola campaña Search, presupuesto compartido y sin monto', () => {
    expect(SEARCH.estado).toBe('PREPARADA_SIN_ACTIVAR');
    expect(c.nombre).toBe('CP | Search | Provincia de Curicó');
    expect(c.tipo).toBe('SEARCH');
    expect(c.presupuestoCompartido).toBe(true);
    expect(c.presupuesto).toBeNull();
    expect(c.grupos.map((g) => [g.id, g.nombre])).toEqual([
      ['AG1', 'Odontología General'], ['AG2', 'Implantes'], ['AG3', 'Prótesis'], ['AG4', 'Coronas / Puentes'],
    ]);
  });

  it('cada grupo usa landings reales del sitio con utm_source=google y nada más', () => {
    const esperado: Record<string, string[]> = {
      AG1: ['/odontologia-general/'],
      AG2: ['/servicios/implantes-dentales/'],
      AG3: ['/servicios/protesis-removibles-totales/', '/servicios/protesis-removibles-parciales/', '/servicios/protesis-hibrida/'],
      AG4: ['/servicios/coronas-dentales/', '/servicios/puentes-dentales/'],
    };
    for (const g of c.grupos) {
      const rutas = g.urlsFinales.map((u) => {
        const url = new URL(u);
        expect(url.origin).toBe(WWW);
        expect([...url.searchParams.keys()]).toEqual(['utm_source']);
        expect(url.searchParams.get('utm_source')).toBe('google');
        expect(LANDINGS_REALES.has(url.pathname)).toBe(true);
        return url.pathname;
      });
      expect(rutas).toEqual(esperado[g.id]);
      expect(BORRADORES.borradores.some((b) => b.campaniaId === g.borradorSoec)).toBe(true);
      expect(g.keywords.length).toBeGreaterThan(0);
    }
    expect(c.parametrosUrlFinal).toBe('utm_source=google');
  });

  it('carillas queda fuera de la pauta pagada', () => {
    expect(c.grupos.some((g) => /carilla/i.test(g.nombre) || g.urlsFinales.some((u) => u.includes('carillas')))).toBe(false);
    expect(SEARCH.fueraDePautaPagada).toEqual([expect.objectContaining({ borradorSoec: 'cp-carillas-estetica-provincia-curico', pautaPagada: false })]);
  });

  it('AG1: keywords confirmadas; Fonasa retirado del positivo y presente como negativa', () => {
    const ag1 = c.grupos[0]!;
    expect(ag1.keywords).toEqual(['dentista curico', 'clinica dental curico', 'centro dental curico', 'mejores dentistas en curico', 'odontologia general curico']);
    expect(SEARCH.keywordsRetiradas).toEqual(['dentista curico fonasa', 'dentista fonasa curico']);
    for (const g of c.grupos) expect(g.keywords.some((k) => /fonasa/i.test(k))).toBe(false);
    for (const n of ['fonasa', 'bono fonasa', 'dentista fonasa', 'dental fonasa']) expect(c.negativasCampania).toContain(n);
  });

  it('ninguna negativa bloquea una prestación confirmada de odontología general', () => {
    const negativas = [...c.negativasCampania, ...c.grupos[0]!.negativasGrupo].map((n) => n.toLowerCase());
    for (const p of ['blanqueamiento', 'endodoncia', 'extraccion', 'extracción', 'limpieza', 'destartraje', 'urgencia', 'encias', 'encías', 'odontopediatria', 'radiografia', 'obturacion', 'caries']) {
      expect(negativas.some((n) => n.includes(p))).toBe(false);
    }
  });

  it('geografía: alcance comercial 9/9, ejecutable en Google 6/9, siempre dentro de la provincia', () => {
    const geo = c.segmentacionGeografica;
    expect(geo.comunasAlcanceComercial).toEqual([...ALCANCE_COMERCIAL_CP_ODONTOLOGIA.comunas]);
    expect(geo.comunasEjecutablesGoogleAds).toEqual(['Curicó', 'Molina', 'Teno', 'Sagrada Familia', 'Rauco', 'Licantén']);
    expect([...geo.comunasEjecutablesGoogleAds, ...geo.comunasNoSegmentablesSinDesborde].sort()).toEqual([...ALCANCE_COMERCIAL_CP_ODONTOLOGIA.comunas].sort());
    expect(geo.criterioUbicacion).toBe('PRESENCIA');
  });
});
