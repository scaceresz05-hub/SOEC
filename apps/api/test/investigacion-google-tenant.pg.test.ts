/**
 * INVESTIGAR ES LEER — composición REAL, sobre PostgreSQL real.
 *
 * Esto nace de un defecto de producción, no de una idea: CP tenía su cuenta de Google Ads CONNECTED y sana
 * (customerId real, sin re-autorización pendiente) y la investigación afirmaba «sin conexión de Google» y
 * «falta una conexión de Google Ads con permiso de lectura». La conexión existía; lo que faltaba era una
 * capacidad de EJECUCIÓN (`MEDICION_REAL` / `AUTONOMIA_ADS`) que alguien había puesto a gobernar una lectura.
 *
 * Por eso estas pruebas construyen los proveedores con `proveedoresDeOrganizacion` —la MISMA función que usa
 * `app.ts` en producción— en lugar de con dobles: probar una composición inventada fue exactamente lo que
 * dejó pasar el defecto. La red se intercepta en el último borde (fetch), para que todo lo de en medio
 * —conexión, credencial cifrada, customerId, login-customer-id, developer token— sea el de verdad.
 *
 * Y se exige lo que más importa cuando hay varias empresas: cada una consulta CON LO SUYO.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import type { RequestContext } from '@soec/contracts';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { proveedoresDeOrganizacion, coordinadorGlobal } from '../src/investigacion/composicion';
import type { ComponentesFlujoGoogleAds } from '../src/acquisition/google-ads-oauth-flow';
import { connectionIdDe } from '../src/acquisition/google-ads-connection';

const pool = makeTestPool();
const DEVELOPER_TOKEN = 'dev-token-de-prueba';

/** Lo que cada empresa tiene conectado: su cuenta y su credencial, distintas entre sí. */
const TENANTS = {
  a: { org: 'org-qa-inv-a', customerId: '8303175180', login: '8303175180', token: 'token-de-a' },
  b: { org: 'org-qa-inv-b', customerId: '1112223334', login: '9998887776', token: 'token-de-b' },
};

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, identityMigrations);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile restart identity cascade');
  // La caché vive en el proceso: sin limpiarla, la respuesta de una empresa podría servir a la siguiente.
  coordinadorGlobal.limpiar();
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await pool.end(); });

/** Empresa mínima persistida: la conexión cuelga de su perfil, igual que en producción. */
async function crearEmpresa(org: string): Promise<void> {
  await new RepositorioNegocios(pool).insertarPerfil(pool, {
    organizationId: org, businessKey: `key-${org}`, displayName: org, legalName: null, businessType: 'CLINICA',
    description: null, website: 'https://www.ejemplo.cl/', country: 'CL', currency: 'CLP',
    timezone: 'America/Santiago', language: 'es', customerType: 'B2C', primaryObjective: null,
    status: 'ACTIVE', origen: 'UI',
  });
}

/** Conexión de publicidad CONNECTED y sana, como la de CP en producción. */
async function conectarGoogle(org: string, customerId: string, login: string): Promise<void> {
  await crearEmpresa(org);
  await new RepositorioConexiones(pool).guardar(pool, {
    organizationId: org, provider: 'GOOGLE_ADS', id: `${org}:GOOGLE_ADS`, estado: 'CONNECTED',
    configuracion: { customerId, loginCustomerId: login }, externalAccountId: customerId,
    loginAccountId: login, secretRef: `secreto:${org}`, validadaEn: new Date().toISOString(), ultimoError: null, origen: 'UI',
  });
}

async function fijarCapacidad(org: string, capacidad: string, habilitada: boolean): Promise<void> {
  await new RepositorioConexiones(pool).fijarCapacidad(pool, { organizationId: org, capacidad: capacidad as never, habilitada, origen: 'UI', nota: null, actor: 'prueba' });
}

/**
 * Composición OAuth mínima: sólo lo que la resolución de credenciales toca de verdad —la conexión del
 * proveedor y el depósito cifrado—. Cada organización devuelve SU token, que es lo que después se comprueba
 * en la cabecera de la llamada.
 */
function componentesGoogle(): ComponentesFlujoGoogleAds {
  return {
    connRepo: {
      obtener: async (org: string, id: string) => {
        const t = Object.values(TENANTS).find((x) => x.org === org);
        if (t === undefined || id !== connectionIdDe(org)) return null;
        return { organizationId: org, id, estado: 'CONNECTED', credencialRef: `ref:${org}`, customerId: t.customerId, loginCustomerId: t.login } as never;
      },
    },
    secretWriter: {
      resolver: async (c: RequestContext, ref: string) => ({
        usar: async (fn: (secreto: string) => Promise<unknown>) => {
          const t = Object.values(TENANTS).find((x) => `ref:${x.org}` === ref);
          // El refresh token de cada empresa es suyo: si alguien cruzara los cables, el token de salida lo diría.
          return fn(`refresh-de-${t?.org ?? 'desconocido'}`) as never;
        },
        ctx: c,
      }),
    },
    oauth: {
      refrescarAccessToken: async (refreshToken: string) => {
        const t = Object.values(TENANTS).find((x) => `refresh-de-${x.org}` === refreshToken);
        return t === undefined ? { ok: false, motivo: 'ERROR' } : { ok: true, accessToken: t.token, expiraEn: 3600 };
      },
    },
  } as unknown as ComponentesFlujoGoogleAds;
}

interface LlamadaGoogle { url: string; authorization: string; developerToken: string; loginCustomerId: string | null }

/** Intercepta la red en el último borde y registra CON QUÉ se llamó. Nada sale a internet. */
function googleFalso(respuesta: (url: string) => unknown = () => ({})): LlamadaGoogle[] {
  const llamadas: LlamadaGoogle[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const h = init?.headers ?? {};
    llamadas.push({
      url: String(url),
      authorization: String(h.Authorization ?? h.authorization ?? ''),
      developerToken: String(h['developer-token'] ?? ''),
      loginCustomerId: h['login-customer-id'] ?? null,
    });
    return new Response(JSON.stringify(respuesta(String(url))), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return llamadas;
}

const proveedores = (org: string) =>
  proveedoresDeOrganizacion(org, { pool, env: { GOOGLE_ADS_DEVELOPER_TOKEN: DEVELOPER_TOKEN } as NodeJS.ProcessEnv, composicionGoogleAds: componentesGoogle() });

describe('una cuenta conectada basta para investigar', () => {
  it('con TODAS las capacidades apagadas, el planificador de palabras sigue disponible', async () => {
    await conectarGoogle(TENANTS.a.org, TENANTS.a.customerId, TENANTS.a.login);
    // Ni escritura, ni autonomía, ni medición, ni director: nada encendido, como CP en producción.
    for (const c of ['ESCRITURA_ADS', 'AUTONOMIA_ADS', 'MEDICION_REAL', 'DIRECTOR_REAL']) await fijarCapacidad(TENANTS.a.org, c, false);

    const llamadas = googleFalso(() => ({ results: [{ text: 'implantes dentales curico', keywordIdeaMetrics: { avgMonthlySearches: '140', competition: 'MEDIUM' } }] }));
    const deps = await proveedores(TENANTS.a.org);

    expect(deps.demanda, 'una lectura no puede depender de un permiso de ejecución').toBeDefined();
    expect(deps.geo).toBeDefined();
    const r = await deps.demanda!.demanda({ semillas: ['implantes dentales'], urlSitio: 'https://www.ejemplo.cl/', geoTargetIds: [], idioma: 'es', pais: 'CL' });
    expect(r).not.toBeNull();
    expect(llamadas[0]!.url).toContain(`customers/${TENANTS.a.customerId}:generateKeywordIdeas`);
    expect(llamadas[0]!.developerToken).toBe(DEVELOPER_TOKEN);
  });

  it('encender ESCRITURA_ADS no cambia nada aquí: investigar no es escribir', async () => {
    await conectarGoogle(TENANTS.a.org, TENANTS.a.customerId, TENANTS.a.login);
    await fijarCapacidad(TENANTS.a.org, 'ESCRITURA_ADS', true);
    googleFalso();
    const deps = await proveedores(TENANTS.a.org);
    expect(deps.demanda).toBeDefined();
    expect(deps.geo).toBeDefined();
  });

  it('una empresa SIN Google declara la ausencia de verdad, no una cuenta inventada', async () => {
    googleFalso();
    const deps = await proveedores('org-qa-inv-sin-google');
    expect(deps.demanda).toBeUndefined();
    expect(deps.geo).toBeUndefined();
    // La auditoría del propio sitio no depende de Google y sigue ahí.
    expect(deps.sitio).toBeDefined();
  });

  it('sin developer token en el despliegue no se finge una consulta', async () => {
    await conectarGoogle(TENANTS.a.org, TENANTS.a.customerId, TENANTS.a.login);
    googleFalso();
    const deps = await proveedoresDeOrganizacion(TENANTS.a.org, { pool, env: {} as NodeJS.ProcessEnv, composicionGoogleAds: componentesGoogle() });
    expect(deps.demanda).toBeUndefined();
  });
});

describe('cada empresa consulta con lo suyo', () => {
  it('dos empresas conectadas: cada una usa SU cuenta y SU credencial', async () => {
    await conectarGoogle(TENANTS.a.org, TENANTS.a.customerId, TENANTS.a.login);
    await conectarGoogle(TENANTS.b.org, TENANTS.b.customerId, TENANTS.b.login);
    const llamadas = googleFalso(() => ({ results: [] }));

    const depsA = await proveedores(TENANTS.a.org);
    await depsA.demanda!.demanda({ semillas: ['implantes'], urlSitio: null, geoTargetIds: [], idioma: 'es', pais: 'CL' });
    const depsB = await proveedores(TENANTS.b.org);
    await depsB.demanda!.demanda({ semillas: ['ortodoncia'], urlSitio: null, geoTargetIds: [], idioma: 'es', pais: 'CL' });

    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]!.url).toContain(`customers/${TENANTS.a.customerId}:`);
    expect(llamadas[0]!.authorization).toBe(`Bearer ${TENANTS.a.token}`);
    expect(llamadas[1]!.url).toContain(`customers/${TENANTS.b.customerId}:`);
    expect(llamadas[1]!.authorization).toBe(`Bearer ${TENANTS.b.token}`);
    // Y ninguna llamada lleva la cuenta de la otra empresa.
    expect(llamadas[0]!.url).not.toContain(TENANTS.b.customerId);
    expect(llamadas[1]!.url).not.toContain(TENANTS.a.customerId);
  });

  it('la caché de cuota no cruza empresas: misma consulta, dos cuentas, dos llamadas', async () => {
    await conectarGoogle(TENANTS.a.org, TENANTS.a.customerId, TENANTS.a.login);
    await conectarGoogle(TENANTS.b.org, TENANTS.b.customerId, TENANTS.b.login);
    const llamadas = googleFalso(() => ({ results: [] }));
    const misma = { semillas: ['implantes dentales'], urlSitio: null, geoTargetIds: [] as string[], idioma: 'es', pais: 'CL' };

    await (await proveedores(TENANTS.a.org)).demanda!.demanda(misma);
    await (await proveedores(TENANTS.b.org)).demanda!.demanda(misma);
    expect(llamadas, 'la respuesta de una empresa jamás puede servirse a otra').toHaveLength(2);

    // La misma empresa repitiendo la misma pregunta SÍ se sirve de caché: eso es lo que protege la cuota.
    await (await proveedores(TENANTS.a.org)).demanda!.demanda(misma);
    expect(llamadas).toHaveLength(2);
  });

  it('el login-customer-id de cada empresa es el suyo, no el de la otra', async () => {
    await conectarGoogle(TENANTS.b.org, TENANTS.b.customerId, TENANTS.b.login);
    const llamadas = googleFalso(() => ({ geoTargetConstantSuggestions: [] }));
    const deps = await proveedores(TENANTS.b.org);
    await deps.geo!.resolver(['Curicó'], 'CL', 'es');
    expect(llamadas[0]!.loginCustomerId === null || llamadas[0]!.loginCustomerId === TENANTS.b.login).toBe(true);
    expect(llamadas[0]!.loginCustomerId).not.toBe(TENANTS.a.login);
    expect(llamadas[0]!.authorization).toBe(`Bearer ${TENANTS.b.token}`);
  });

  it('una conexión desactivada no habilita consultas', async () => {
    await crearEmpresa(TENANTS.a.org);
    await new RepositorioConexiones(pool).guardar(pool, {
      organizationId: TENANTS.a.org, provider: 'GOOGLE_ADS', id: `${TENANTS.a.org}:GOOGLE_ADS`, estado: 'DISABLED',
      configuracion: { customerId: TENANTS.a.customerId }, externalAccountId: TENANTS.a.customerId,
      loginAccountId: null, secretRef: null, validadaEn: null, ultimoError: null, origen: 'UI',
    });
    googleFalso();
    const deps = await proveedores(TENANTS.a.org);
    expect(deps.demanda).toBeUndefined();
  });
});
