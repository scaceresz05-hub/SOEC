/**
 * AUDITORÍA DE MEDICIÓN — saber qué falta antes de tocar la cuenta de nadie.
 *
 * Medir una conversión publicitaria tiene dos mitades: una acción que existe en la plataforma y un sitio que
 * la dispara. Faltar una, faltar la otra o no haber podido preguntar son tres situaciones distintas, y cada
 * una se arregla de una forma. Lo que estas pruebas impiden es lo de siempre: que un fallo de la consulta se
 * lea como «no hay conversiones», que es el error que ya cometimos con los programas de verificación, con
 * `billing_setup` y con el planificador de palabras.
 */
import { describe, expect, it, vi } from 'vitest';
import { auditarMedicion, riesgoDeDuplicacion, type DepsAuditoriaMedicion } from '../src/ejecucion/auditoria-medicion';
import { GoogleSearchError } from '../src/campana/google-ads-mutate-http';

const ORG = 'org-qa-medicion';
const CUSTOMER = '8303175180';
const NOMBRE = 'SOEC · Clínica QA · whatsapp_intent';

const accionGoogle = (over: Record<string, unknown> = {}) => ({
  conversionAction: {
    id: '7654321', name: NOMBRE, status: 'ENABLED', type: 'WEBPAGE', category: 'CONTACT',
    origin: 'WEBSITE', countingType: 'ONE_PER_CLICK', primaryForGoal: true,
    clickThroughLookbackWindowDays: 30,
    tagSnippets: [{ eventSnippet: "gtag('event', 'conversion', {'send_to': 'AW-123456789/AbC-D_efG'});", globalSiteTag: '' }],
    ...over,
  },
});

/** La cuenta tal como la declara la plataforma: auto-etiquetado encendido y seguimiento propio. */
const filaCuenta = (over: Record<string, unknown> = {}) => ({
  customer: {
    id: CUSTOMER, autoTaggingEnabled: true, timeZone: 'America/Santiago', currencyCode: 'CLP',
    conversionTrackingSetting: { conversionTrackingId: '123456789', conversionTrackingStatus: 'CONVERSION_TRACKING_MANAGED_BY_SELF' },
    ...over,
  },
});

/** Responde según la consulta: los ajustes de cuenta y las acciones son dos lecturas distintas. */
const clienteQueResponde = (acciones: unknown[], cuenta: unknown[] = [filaCuenta()]) => ({
  buscar: vi.fn(async (_cid: string, q: string) => (q.includes('from customer') ? cuenta : acciones)),
});

const deps = (over: Partial<DepsAuditoriaMedicion> = {}): DepsAuditoriaMedicion => ({
  cliente: clienteQueResponde([accionGoogle()]),
  customerId: CUSTOMER,
  eventoDeclarado: 'whatsapp_intent',
  nombreEstableEsperado: NOMBRE,
  observarEventosDelSitio: async () => ({ observados: 12, desde: '2026-09-01T00:00:00.000Z' }),
  ...over,
});

describe('las dos mitades de la medición', () => {
  it('con acción, etiqueta y evento del sitio observado, queda a un paso: confirmar que la plataforma la registra', async () => {
    const r = await auditarMedicion(ORG, deps());
    expect(r.causa).toBe('READY');
    expect(r.estado).toBe('TRACKING_INSTALLED');
    expect(r.accionRelevante?.id).toBe('7654321');
    expect(r.accionRelevante?.primaria).toBe(true);
    expect(r.accionRelevante?.etiquetaDisponible).toBe(true);
  });

  it('conexión sin acción de conversión NO está lista, y lo dice con su causa', async () => {
    const r = await auditarMedicion(ORG, deps({ cliente: clienteQueResponde([]) }));
    expect(r.estado).toBe('ACTION_MISSING');
    expect(r.causa).toBe('CONVERSION_ACTION_MISSING');
    expect(r.loQueFalta.join(' ')).toMatch(/crear en la plataforma/i);
  });

  it('acción existente pero SIN evento del sitio: falta instalar, no falta crear', async () => {
    const r = await auditarMedicion(ORG, deps({ observarEventosDelSitio: async () => ({ observados: 0, desde: null }) }));
    expect(r.causa).toBe('READY_FOR_INSTALL');
    expect(r.estado).toBe('TRACKING_MISSING');
    expect(r.loQueFalta.join(' ')).toMatch(/instalar la etiqueta/i);
  });

  it('evento del sitio sin acción en la plataforma: falta el otro lado', async () => {
    const r = await auditarMedicion(ORG, deps({ cliente: clienteQueResponde([]), observarEventosDelSitio: async () => ({ observados: 40, desde: '2026-08-01T00:00:00.000Z' }) }));
    expect(r.causa).toBe('CONVERSION_ACTION_MISSING');
    expect(r.explicacion).toMatch(/el sitio ya emite/i);
  });

  it('ni acción ni evento observado: se nombra la ausencia del sitio, que es lo primero que hay que resolver', async () => {
    const r = await auditarMedicion(ORG, deps({ cliente: clienteQueResponde([]), observarEventosDelSitio: async () => ({ observados: 0, desde: null }) }));
    expect(r.causa).toBe('SITE_EVENT_MISSING');
  });

  it('acción sin etiqueta instalable: el sitio no tendría con qué dispararla', async () => {
    const r = await auditarMedicion(ORG, deps({ cliente: clienteQueResponde([accionGoogle({ tagSnippets: [] })]) }));
    expect(r.causa).toBe('TAG_MISSING');
    expect(r.estado).toBe('TRACKING_MISSING');
  });

  it('sin evento declarado por el negocio no hay nada que medir todavía', async () => {
    const r = await auditarMedicion(ORG, deps({ eventoDeclarado: null, nombreEstableEsperado: null }));
    expect(r.causa).toBe('CONVERSION_ACTION_MISSING');
    expect(r.loQueFalta.join(' ')).toMatch(/declarar qué acción/i);
  });
});

describe('un fallo NO es una ausencia', () => {
  it('si la plataforma no responde, la causa es PROVIDER_UNOBSERVABLE y no «no hay conversiones»', async () => {
    const cliente = {
      buscar: vi.fn(async () => {
        throw new GoogleSearchError({
          httpStatus: 403, requestId: 'req-1', status: 'PERMISSION_DENIED',
          code: 'authorizationError:USER_PERMISSION_DENIED', message: 'sin permiso',
          errorPath: null, fieldPathElements: [], cuerpoResumen: null,
        });
      }),
    };
    const r = await auditarMedicion(ORG, deps({ cliente }));
    expect(r.causa).toBe('PROVIDER_UNOBSERVABLE');
    expect(r.fallo?.httpStatus).toBe(403);
    expect(r.fallo?.codigo).toContain('USER_PERMISSION_DENIED');
    expect(r.acciones).toEqual([]);
    expect(r.explicacion).toMatch(/no se puede afirmar que no existan/i);
  });

  it('sin cuenta conectada tampoco se concluye que no haya conversiones', async () => {
    const r = await auditarMedicion(ORG, deps({ cliente: null, customerId: null }));
    expect(r.causa).toBe('PROVIDER_UNOBSERVABLE');
    expect(r.loQueFalta.join(' ')).toMatch(/conectar la cuenta/i);
  });

  it('un 429 tampoco se lee como ausencia', async () => {
    const cliente = {
      buscar: vi.fn(async () => {
        throw new GoogleSearchError({
          httpStatus: 429, requestId: null, status: 'RESOURCE_EXHAUSTED', code: 'quotaError:RESOURCE_EXHAUSTED',
          message: null, errorPath: null, fieldPathElements: [], cuerpoResumen: null,
        });
      }),
    };
    const r = await auditarMedicion(ORG, deps({ cliente }));
    expect(r.causa).toBe('PROVIDER_UNOBSERVABLE');
    expect(r.fallo?.httpStatus).toBe(429);
  });

  it('nunca se registra la credencial en el diagnóstico', async () => {
    const r = await auditarMedicion(ORG, deps());
    const texto = JSON.stringify(r);
    for (const prohibido of ['Bearer', 'developer-token', 'refresh', 'Authorization']) {
      expect(texto).not.toContain(prohibido);
    }
  });
});

describe('aislamiento entre negocios', () => {
  it('cada auditoría consulta la cuenta de SU organización', async () => {
    const llamadas: string[] = [];
    const cliente = { buscar: vi.fn(async (cid: string, q: string) => { if (!q.includes('from customer')) llamadas.push(cid); return []; }) };
    await auditarMedicion('org-a', deps({ cliente, customerId: '1111111111' }));
    await auditarMedicion('org-b', deps({ cliente, customerId: '2222222222' }));
    expect(llamadas).toEqual(['1111111111', '2222222222']);
  });

  it('la acción relevante se reconoce por el nombre estable del propio negocio', async () => {
    const deOtro = accionGoogle({ name: 'SOEC · Otra Clínica · whatsapp_intent' });
    const r = await auditarMedicion(ORG, deps({ cliente: clienteQueResponde([deOtro]) }));
    // La acción existe en la cuenta, pero no es la de este negocio: no se adopta por parecido.
    expect(r.acciones).toHaveLength(1);
    expect(r.accionRelevante).toBeNull();
    expect(r.causa).toBe('CONVERSION_ACTION_MISSING');
  });
});

/**
 * UNA INTENCIÓN, UNA CONVERSIÓN. El día que coexistan la etiqueta del sitio y una importación desde GA4, un
 * solo clic de WhatsApp se contará dos veces — y la cifra duplicada es con la que el sistema decide cuánto
 * pujar. Por eso el diseño fija un único camino que alimenta la conversión publicitaria.
 */
describe('riesgo de contar dos veces la misma intención', () => {
  it('un solo camino: sin riesgo', () => {
    const r = riesgoDeDuplicacion(['GOOGLE_ADS_TAG']);
    expect(r.riesgo).toBe('NONE');
    expect(r.fuentesQueAlimentanGoogle).toEqual(['GOOGLE_ADS_TAG']);
  });

  it('etiqueta + importación desde GA4: un clic contaría DOS veces', () => {
    const r = riesgoDeDuplicacion(['GOOGLE_ADS_TAG', 'GA4_IMPORT']);
    expect(r.riesgo).toBe('HIGH');
    expect(r.explicacion).toMatch(/2 veces/);
  });

  it('etiqueta + GTM + importación: tres caminos, tres conversiones', () => {
    const r = riesgoDeDuplicacion(['GOOGLE_ADS_TAG', 'GTM', 'GA4_IMPORT']);
    expect(r.riesgo).toBe('HIGH');
    expect(r.fuentesQueAlimentanGoogle).toHaveLength(3);
  });

  it('la medición interna de SOEC no alimenta la conversión publicitaria y no duplica nada', () => {
    const r = riesgoDeDuplicacion(['CP_GROWTH_INTERNO', 'GOOGLE_ADS_TAG']);
    expect(r.riesgo).toBe('NONE');
    expect(r.fuentesQueAlimentanGoogle).toEqual(['GOOGLE_ADS_TAG']);
  });

  it('el estado de CP hoy —sólo su medición interna— no tiene riesgo porque no alimenta a Google', () => {
    const r = riesgoDeDuplicacion(['CP_GROWTH_INTERNO']);
    expect(r.riesgo).toBe('LOW');
    expect(r.fuentesQueAlimentanGoogle).toEqual([]);
    expect(r.explicacion).toMatch(/al instalar el segundo/i);
  });

  it('el mismo camino declarado dos veces no es duplicación: es el mismo camino', () => {
    const r = riesgoDeDuplicacion(['GOOGLE_ADS_TAG', 'GOOGLE_ADS_TAG']);
    expect(r.riesgo).toBe('NONE');
  });
});

describe('ajustes de la cuenta que deciden qué arquitectura es posible', () => {
  it('lee el auto-etiquetado y el seguimiento declarados por la plataforma', async () => {
    const r = await auditarMedicion(ORG, deps());
    expect(r.ajustes?.autoTagging).toBe(true);
    expect(r.ajustes?.conversionTrackingId).toBe('123456789');
    expect(r.ajustes?.moneda).toBe('CLP');
  });

  /**
   * Sin auto-etiquetado un clic de anuncio llega al sitio SIN su identificador, y entonces importar la
   * conversión desde fuera es imposible. Es el dato que decide entre dos arquitecturas, así que no puede
   * suponerse: si no se lee, se dice `null`.
   */
  it('si la plataforma no declara el auto-etiquetado, queda en NULL y no en falso', async () => {
    const r = await auditarMedicion(ORG, deps({ cliente: clienteQueResponde([accionGoogle()], [{ customer: { id: CUSTOMER } }]) }));
    expect(r.ajustes?.autoTagging).toBeNull();
  });

  it('si la lectura de los ajustes falla, la auditoría de conversiones sigue valiendo', async () => {
    const cliente = {
      buscar: vi.fn(async (_cid: string, q: string) => {
        if (q.includes('from customer')) throw new Error('fallo al leer la cuenta');
        return [accionGoogle()];
      }),
    };
    const r = await auditarMedicion(ORG, deps({ cliente }));
    expect(r.ajustes).toBeNull();
    expect(r.causa).toBe('READY');
  });
});
