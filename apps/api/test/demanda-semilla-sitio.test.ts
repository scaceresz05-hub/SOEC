/**
 * CUANDO LAS PALABRAS DECLARADAS NO TRAEN NADA, SE PREGUNTA POR EL SITIO.
 *
 * Esto no salió de una idea: salió de sondar la cuenta real de una clínica. Las tres ofertas declaradas
 * —«clínica dental», «odontología general», «rehabilitación oral»— devolvían CERO términos con y sin
 * territorio, y el sitio del negocio como semilla devolvía doscientos. Durante dos correcciones creímos que
 * el problema era el territorio o la cuenta; era la semilla.
 *
 * Lo que estas pruebas fijan: que se reintenta con el sitio antes de dar el silencio por bueno, que no se
 * mezclan las dos consultas, y que la respuesta dice con cuál de las dos se obtuvo lo que se obtuvo.
 */
import { describe, expect, it, vi } from 'vitest';
import { crearProveedorDemandaGoogle, CoordinadorDeConsultas } from '../src/investigacion/google-providers';
import type { GoogleAdsMutateHttpClient } from '../src/campana/google-ads-mutate-http';

type Peticion = { semillas: readonly string[]; url?: string | null; geoTargetIds?: readonly string[]; languageId?: string };

function clienteFalso(responder: (p: Peticion) => string[]): { cliente: GoogleAdsMutateHttpClient; peticiones: Peticion[] } {
  const peticiones: Peticion[] = [];
  const cliente = {
    generarIdeasDePalabras: vi.fn(async (_cid: string, p: Peticion) => {
      peticiones.push(p);
      return responder(p).map((t) => ({ texto: t, avgMonthlySearches: 140, competition: 'MEDIUM', competitionIndex: 50, lowTopOfPageBidMicros: null, highTopOfPageBidMicros: null }));
    }),
  } as unknown as GoogleAdsMutateHttpClient;
  return { cliente, peticiones };
}

const proveedor = (cliente: GoogleAdsMutateHttpClient) =>
  crearProveedorDemandaGoogle({ cliente, customerId: '123', org: 'org-qa', coordinador: new CoordinadorDeConsultas() });

const peticion = (over: Partial<{ semillas: readonly string[]; urlSitio: string | null }> = {}) => ({
  semillas: ['clínica dental', 'odontología general'],
  urlSitio: 'https://www.clinica-qa.example/',
  geoTargetIds: ['9246355'],
  idioma: 'es',
  pais: 'CL',
  ...over,
});

describe('semilla de la consulta de demanda', () => {
  it('si las palabras traen términos, manda esa consulta y no se pregunta nada más', async () => {
    const { cliente, peticiones } = clienteFalso(() => ['dentista curico', 'clinica dental curico']);
    const r = await proveedor(cliente).demanda(peticion());
    expect(r!.ideas).toHaveLength(2);
    expect(r!.semilla).toBe('PALABRAS');
    expect(peticiones, 'una sola llamada: no se gasta cuota sin motivo').toHaveLength(1);
  });

  it('si las palabras no traen nada, se reintenta con el sitio y se dice que fue así', async () => {
    const { cliente, peticiones } = clienteFalso((p) => (p.semillas.length > 0 ? [] : ['dentista urgencia', 'dentista cerca']));
    const r = await proveedor(cliente).demanda(peticion());
    expect(r!.ideas.map((i) => i.termino)).toEqual(['dentista urgencia', 'dentista cerca']);
    expect(r!.semilla).toBe('SITIO');
    expect(peticiones).toHaveLength(2);
    expect(peticiones[1]!.semillas).toEqual([]);
    expect(peticiones[1]!.url).toBe('https://www.clinica-qa.example/');
    // El territorio del negocio se respeta también en el reintento: no se ensancha para conseguir datos.
    expect(peticiones[1]!.geoTargetIds).toEqual(['9246355']);
  });

  it('sin sitio declarado no hay reintento: el silencio se devuelve tal cual', async () => {
    const { cliente, peticiones } = clienteFalso(() => []);
    const r = await proveedor(cliente).demanda(peticion({ urlSitio: null }));
    expect(r!.ideas).toHaveLength(0);
    expect(r!.semilla).toBe('PALABRAS');
    expect(peticiones).toHaveLength(1);
  });

  it('sin palabras declaradas se pregunta directamente por el sitio', async () => {
    const { cliente, peticiones } = clienteFalso(() => ['dentista cerca']);
    const r = await proveedor(cliente).demanda(peticion({ semillas: [] }));
    expect(r!.semilla).toBe('SITIO');
    expect(peticiones).toHaveLength(1);
    expect(peticiones[0]!.semillas).toEqual([]);
  });

  it('sin palabras y sin sitio no hay a quién preguntar', async () => {
    const { cliente, peticiones } = clienteFalso(() => ['lo que sea']);
    expect(await proveedor(cliente).demanda(peticion({ semillas: [], urlSitio: null }))).toBeNull();
    expect(peticiones).toHaveLength(0);
  });

  it('no se mezclan las dos consultas: los términos vienen de una sola', async () => {
    const { cliente } = clienteFalso((p) => (p.semillas.length > 0 ? [] : ['del sitio']));
    const r = await proveedor(cliente).demanda(peticion());
    expect(r!.ideas.map((i) => i.termino)).toEqual(['del sitio']);
  });

  it('un fallo del proveedor sigue siendo un fallo, no un silencio', async () => {
    const cliente = {
      generarIdeasDePalabras: vi.fn(async () => { throw new Error('GOOGLE_SEARCH_HTTP_429'); }),
    } as unknown as GoogleAdsMutateHttpClient;
    expect(await proveedor(cliente).demanda(peticion())).toBeNull();
  });
});
