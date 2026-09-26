/**
 * SONDAS DEL PLANIFICADOR — preguntar en vez de suponer.
 *
 * Cuando el planificador de Google devolvió cero términos, había al menos cinco explicaciones posibles y
 * ninguna forma de elegir entre ellas sin comprobarlo. Estas pruebas fijan las dos mitades del diagnóstico:
 * que se pregunta lo mismo de varias maneras, y que la lectura del resultado no afirma más de lo que las
 * propias sondas separan. «No se sabe» tiene que seguir siendo una respuesta posible.
 */
import { describe, expect, it, vi } from 'vitest';
import { correrSondasDeDemanda, leerSondas, type EntradaSondas, type ResultadoSonda } from '../src/investigacion/probe-demanda';
import { GoogleSearchError, type GoogleAdsMutateHttpClient } from '../src/campana/google-ads-mutate-http';

type Peticion = { semillas: readonly string[]; url?: string | null; geoTargetIds?: readonly string[]; languageId?: string };

/** Cliente falso: responde según lo que se le pregunte, y anota cada petición. */
function clienteFalso(responder: (p: Peticion) => unknown[] | Error): { cliente: GoogleAdsMutateHttpClient; peticiones: Peticion[] } {
  const peticiones: Peticion[] = [];
  const cliente = {
    generarIdeasDePalabras: vi.fn(async (_cid: string, p: Peticion) => {
      peticiones.push(p);
      const r = responder(p);
      if (r instanceof Error) throw r;
      return r.map((t) => ({ texto: String(t), avgMonthlySearches: null, competition: null, competitionIndex: null, lowTopOfPageBidMicros: null, highTopOfPageBidMicros: null }));
    }),
  } as unknown as GoogleAdsMutateHttpClient;
  return { cliente, peticiones };
}

const entrada = (cliente: GoogleAdsMutateHttpClient, over: Partial<EntradaSondas> = {}): EntradaSondas => ({
  cliente,
  customerId: '1234567890',
  semillas: ['clínica dental', 'odontología general'],
  urlSitio: 'https://www.clinica-qa.example/',
  idioma: 'es',
  pais: 'CL',
  geoComunas: ['9246355', '9258244'],
  geoPaisId: '2152',
  geoRegionId: '20142',
  geoRegionNombre: 'Región del Maule',
  ...over,
});

describe('se pregunta lo mismo de varias maneras', () => {
  it('cubre los seis modos: sin geo, país, región, comunas, sólo sitio y sitio + palabras', async () => {
    const { cliente, peticiones } = clienteFalso(() => []);
    const sondas = await correrSondasDeDemanda(entrada(cliente));
    expect(sondas.map((s) => s.modo)).toEqual([
      'SEMILLAS_SIN_GEO', 'SEMILLAS_PAIS', 'SEMILLAS_REGION', 'SEMILLAS_COMUNAS', 'SOLO_URL', 'SEMILLAS_Y_URL',
    ]);
    expect(peticiones).toHaveLength(6);
    expect(peticiones[0]!.geoTargetIds).toEqual([]);
    expect(peticiones[1]!.geoTargetIds).toEqual(['2152']);
    expect(peticiones[3]!.geoTargetIds).toEqual(['9246355', '9258244']);
    expect(peticiones[4]!.semillas).toEqual([]);
    expect(peticiones[4]!.url).toBe('https://www.clinica-qa.example/');
  });

  it('sin sitio declarado no se inventan las sondas que dependen de él', async () => {
    const { cliente } = clienteFalso(() => []);
    const sondas = await correrSondasDeDemanda(entrada(cliente, { urlSitio: null }));
    expect(sondas.map((s) => s.modo)).not.toContain('SOLO_URL');
  });

  it('un fallo del proveedor se traslada con su código, sin convertirse en conclusión', async () => {
    const { cliente } = clienteFalso(() => new GoogleSearchError({
      httpStatus: 403, requestId: 'req-1', status: 'PERMISSION_DENIED', code: 'authorizationError:USER_PERMISSION_DENIED',
      message: 'sin permiso', errorPath: null, fieldPathElements: [], cuerpoResumen: null,
    }));
    const sondas = await correrSondasDeDemanda(entrada(cliente));
    expect(sondas[0]!.resultado).toBe('ERROR');
    expect(sondas[0]!.httpStatus).toBe(403);
    expect(sondas[0]!.codigo).toContain('USER_PERMISSION_DENIED');
    expect(sondas[0]!.ideas).toBeNull(); // no se sabe: ni 0 ni otra cosa
  });

  it('nunca registra credenciales', async () => {
    const { cliente } = clienteFalso(() => ['dentista curico']);
    const sondas = await correrSondasDeDemanda(entrada(cliente));
    const texto = JSON.stringify(sondas);
    for (const prohibido of ['Bearer', 'developer-token', 'refresh', 'Authorization']) {
      expect(texto).not.toContain(prohibido);
    }
  });
});

describe('leer las sondas sin inventar la causa', () => {
  const sonda = (over: Partial<ResultadoSonda>): ResultadoSonda => ({
    modo: 'SEMILLAS_SIN_GEO', geo: null, geoTargetIds: [], idioma: '1003', conUrl: false, semillas: 2,
    resultado: 'OK', ideas: 0, ejemplos: [], httpStatus: null, codigo: null, mensaje: null, ...over,
  });

  it('si sin geo trae términos y con las comunas no, la causa es la geografía', () => {
    const r = leerSondas([
      sonda({ modo: 'SEMILLAS_SIN_GEO', ideas: 120 }),
      sonda({ modo: 'SEMILLAS_COMUNAS', geoTargetIds: ['9246355'], ideas: 0 }),
    ]);
    expect(r.causa).toBe('GEO_DEMASIADO_RESTRICTIVA');
  });

  it('si todas responden y ninguna trae términos, la causa está en la cuenta', () => {
    const r = leerSondas([
      sonda({ modo: 'SEMILLAS_SIN_GEO', ideas: 0 }),
      sonda({ modo: 'SEMILLAS_PAIS', geoTargetIds: ['2152'], ideas: 0 }),
      sonda({ modo: 'SOLO_URL', conUrl: true, semillas: 0, ideas: 0 }),
    ]);
    expect(r.causa).toBe('CUENTA_O_ACCESO');
    expect(r.explicacion).toMatch(/no está entregando datos/i);
  });

  it('si las palabras traen y el sitio solo no, la causa es el sitio como semilla', () => {
    const r = leerSondas([
      sonda({ modo: 'SEMILLAS_SIN_GEO', ideas: 90 }),
      sonda({ modo: 'SOLO_URL', conUrl: true, semillas: 0, ideas: 0 }),
    ]);
    expect(r.causa).toBe('SITIO_COMO_SEMILLA');
  });

  it('si ninguna consulta llegó a responder, no se culpa a las palabras', () => {
    const r = leerSondas([sonda({ resultado: 'ERROR', ideas: null, httpStatus: 401, codigo: 'AUTH' })]);
    expect(r.causa).toBe('CUENTA_O_ACCESO');
  });

  it('si todas traen términos, no hay silencio que explicar', () => {
    const r = leerSondas([sonda({ ideas: 10 }), sonda({ modo: 'SEMILLAS_PAIS', ideas: 5 })]);
    expect(r.causa).toBe('NINGUN_SILENCIO');
  });

  /**
   * EL CASO REAL DE CP, tal como lo devolvieron las sondas en producción: las tres palabras declaradas no
   * traen nada —ni sueltas, ni con país, ni con comunas— y el sitio como semilla trae 200 términos. Lo que
   * no produce resultados son esas semillas. La primera versión de esta lectura culpó al territorio.
   */
  it('si las palabras callan siempre y el sitio trae, la causa son las semillas', () => {
    const r = leerSondas([
      sonda({ modo: 'SEMILLAS_SIN_GEO', ideas: 0 }),
      sonda({ modo: 'SEMILLAS_PAIS', geoTargetIds: ['2152'], ideas: 0 }),
      sonda({ modo: 'SEMILLAS_COMUNAS', geoTargetIds: ['9246355'], ideas: 0 }),
      sonda({ modo: 'SOLO_URL', conUrl: true, semillas: 0, ideas: 200 }),
      sonda({ modo: 'SEMILLAS_Y_URL', conUrl: true, ideas: 0 }),
    ]);
    expect(r.causa).toBe('SEMILLAS_SIN_RESULTADO');
    expect(r.explicacion).toMatch(/no la cuenta ni el territorio/i);
  });

  it('no se culpa al territorio comparando sondas con semillas distintas', () => {
    // Sin geo pero con el SITIO trae; con comunas y con PALABRAS no trae. Cambió la semilla, no el territorio.
    const r = leerSondas([
      sonda({ modo: 'SOLO_URL', conUrl: true, semillas: 0, ideas: 200 }),
      sonda({ modo: 'SEMILLAS_COMUNAS', geoTargetIds: ['9246355'], ideas: 0 }),
    ]);
    expect(r.causa).not.toBe('GEO_DEMASIADO_RESTRICTIVA');
  });

  it('si los resultados están mezclados, la respuesta es DESCONOCIDA', () => {
    const r = leerSondas([
      sonda({ modo: 'SEMILLAS_PAIS', geoTargetIds: ['2152'], ideas: 40 }),
      sonda({ modo: 'SEMILLAS_REGION', geoTargetIds: ['20142'], ideas: 0 }),
    ]);
    expect(r.causa).toBe('DESCONOCIDA');
  });
});
