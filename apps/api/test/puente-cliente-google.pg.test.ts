/**
 * Autonomy Fase I.1 · GATE: ¿el runtime puede CONSTRUIR el cliente de Google Ads después de elegir cuenta?
 *
 * Que los prerrequisitos digan PASS no basta. El defecto original era operativo: `clienteDeEscrituraGoogle`
 * devolvía `null` para cualquier empresa nueva, porque exige una fila `CONNECTED` en `business_connection` con
 * su `customerId`, y el OAuth escribía sólo las tablas del proveedor. Aquí se recorre el camino completo —
 * callback OAuth real → descubrimiento → selección → puente → composición del cliente → una lectura— con
 * dobles del transporte HTTP, sin tocar Google ni escribir nada fuera.
 *
 * Y se demuestra de dónde sale cada pieza, que es la pregunta de fondo:
 *
 *   refresh token   → depósito cifrado del proveedor (`google_ads_credential.secret_ref` + sobre KMS), por org
 *   customerId      → `business_connection.configuracion.customerId` (SSOT operativo), por org
 *   loginCustomerId → ídem (manager si lo hay; si no, la propia cuenta)
 *   developer token → configuración de la APLICACIÓN (env), igual para todas las empresas
 *   moneda / zona   → descubiertas en Google y proyectadas al SSOT al elegir la cuenta
 *
 * `business_connection.secret_ref = null` es correcto A PROPÓSITO: el SSOT no guarda ni referencia credenciales.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { googleAdsOAuthMigrations, crearRepositoriosGoogleAdsPg } from '../src/acquisition/google-ads-oauth-pg';
import { EnvelopeSecretBackend, KmsFake } from '../src/acquisition/meta-secret-backend';
import { crearEstadoGoogleAds } from '../src/acquisition/google-ads-oauth';
import { connectionIdDe, type CuentaGoogleAds } from '../src/acquisition/google-ads-connection';
import { procesarCallbackGoogleAds, seleccionarCuenta, type ComponentesFlujoGoogleAds } from '../src/acquisition/google-ads-oauth-flow';
import { proyectarCuentaGoogleAds } from '../src/conexion/puente-google-ads';
import { clienteDeEscrituraGoogle, clienteDeLecturaGoogle } from '../src/ejecucion/composicion';
import type { ResultadoIntercambio, ResultadoRefresh, GoogleOAuthPort, GoogleAdsAccountsPort } from '../src/acquisition/google-ads-api-http';

const pool = makeTestPool();
const AHORA = '2026-09-23T12:00:00.000Z';
const ORG_A = 'org-qa-cliente-a';
const ORG_B = 'org-qa-cliente-b';

/** Configuración de APLICACIÓN: el developer token es global, no por empresa. */
const ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token-de-la-aplicacion',
  SOEC_EXTERNAL_MUTATIONS: 'on',
} as unknown as NodeJS.ProcessEnv;

/** Google de mentira: intercambia el código por un refresh token propio de cada empresa y lo renueva. */
class OAuthFake implements GoogleOAuthPort {
  public invalidGrant = false;
  constructor(private readonly sufijo: string) {}
  async intercambiarCodigo(): Promise<ResultadoIntercambio> {
    return { ok: true, refreshToken: `refresh-${this.sufijo}`, accessToken: `access-${this.sufijo}`, expiresIn: 3600 } as ResultadoIntercambio;
  }
  async refrescarAccessToken(refreshToken: string): Promise<ResultadoRefresh> {
    if (this.invalidGrant) return { ok: false, motivo: 'INVALID_GRANT' } as ResultadoRefresh;
    // El access token lleva el refresh token dentro: así la prueba puede afirmar de DÓNDE salió.
    return { ok: true, accessToken: `access-de-${refreshToken}`, expiresIn: 3600 } as ResultadoRefresh;
  }
  async revocar(): Promise<void> { /* no aplica */ }
}

/** Cuentas de mentira: una cuenta operable por empresa. */
class CuentasFake implements GoogleAdsAccountsPort {
  constructor(
    private readonly cuentas: readonly CuentaGoogleAds[],
    /** Cuentas cliente que cuelgan del manager: sólo son accesibles a través de él. */
    private readonly clientesDelManager: readonly string[] = [],
  ) {}
  async listAccessibleCustomers(): Promise<readonly string[]> {
    return this.cuentas.filter((c) => !this.clientesDelManager.includes(c.customerId)).map((c) => c.customerId);
  }
  async describeCustomer(_t: string, customerId: string): Promise<CuentaGoogleAds | null> {
    return this.cuentas.find((c) => c.customerId === customerId) ?? null;
  }
  async listClientCustomers(): Promise<readonly string[]> { return this.clientesDelManager; }
}

const cuenta = (customerId: string, over: Partial<CuentaGoogleAds> = {}): CuentaGoogleAds => ({
  customerId, descriptiveName: `Cuenta ${customerId}`, currencyCode: 'CLP',
  timeZone: 'America/Santiago', manager: false, testAccount: false, managerCustomerId: null, ...over,
});

function composicion(
  org: string,
  cuentas: readonly CuentaGoogleAds[],
  oauth: OAuthFake = new OAuthFake(org),
  clientesDelManager: readonly string[] = [],
): ComponentesFlujoGoogleAds & { oauthFake: OAuthFake } {
  const repos = crearRepositoriosGoogleAdsPg(pool);
  return {
    stateStore: repos.stateStore,
    credRepo: repos.credRepo,
    connRepo: repos.connRepo,
    secretWriter: new EnvelopeSecretBackend(new KmsFake(), repos.ciphertextStore),
    oauth,
    accounts: new CuentasFake(cuentas, clientesDelManager),
    clientId: 'client-id-publico',
    redirectUri: 'https://soec.example/callback',
    ahora: () => AHORA,
    // El puente REAL: es justo lo que este gate tiene que ejercitar.
    puenteSsot: async (o, c) => {
      const r = await proyectarCuentaGoogleAds(o, {
        customerId: c.customerId, loginCustomerId: c.loginCustomerId, descriptiveName: c.descriptiveName,
        currencyCode: c.currencyCode, timeZone: c.timeZone, manager: c.manager, testAccount: c.testAccount,
      }, { pool, ahora: () => AHORA });
      return r.ok ? { ok: true } : { ok: false, motivo: r.motivo, explicacion: r.explicacion };
    },
    oauthFake: oauth,
  };
}

async function altaDeNegocio(org: string): Promise<void> {
  await new RepositorioNegocios(pool).insertarPerfil(pool, {
    organizationId: org, businessKey: `bk-${org}`, displayName: `Empresa ${org}`, legalName: null,
    businessType: 'CLINICA', description: 'clínica dental', website: null, country: 'CL',
    currency: 'CLP', timezone: 'America/Santiago', language: 'es', customerType: 'B2C',
    primaryObjective: 'captar pacientes', status: 'ACTIVE', origen: 'UI',
  });
}

/** Recorre OAuth + descubrimiento + selección para una empresa, como lo haría una persona. */
async function conectarYElegir(comp: ComponentesFlujoGoogleAds, org: string, customerId: string): Promise<void> {
  const st = crearEstadoGoogleAds({ nonce: 'n'.repeat(32), ahora: AHORA, ttlMs: 600_000 }, org, 'dueña');
  await comp.stateStore.guardar(st);
  const cb = await procesarCallbackGoogleAds(comp, { code: 'codigo-bueno', stateValor: st.valor });
  expect(cb.estado, JSON.stringify(cb)).toBe('ACCOUNT_SELECTION_PENDING');
  const sel = await seleccionarCuenta(comp, org, customerId);
  expect(sel.ok, JSON.stringify(sel)).toBe(true);
}

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await runMigrations(pool, googleAdsOAuthMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate google_ads_oauth_state, google_ads_credential, google_ads_connection, google_ads_ciphertext, google_ads_sync_lease');
  await ejecutarDestructivoDePrueba(pool, 'truncate business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile cascade');
  await altaDeNegocio(ORG_A);
  await altaDeNegocio(ORG_B);
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await pool.end(); });

/** Captura las llamadas HTTP que haría el cliente, sin salir a la red. */
function espiarFetch(): { llamadas: Array<{ url: string; headers: Record<string, string> }> } {
  const llamadas: Array<{ url: string; headers: Record<string, string> }> = [];
  // Las cabeceras se normalizan a minúsculas: HTTP no distingue mayúsculas y la prueba tampoco debe hacerlo.
  const enMinusculas = (h: Record<string, string> = {}): Record<string, string> =>
    Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]));
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
    llamadas.push({ url: String(url), headers: enMinusculas(init?.headers) });
    return new Response(JSON.stringify([{ results: [] }]), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return { llamadas };
}

describe('después de elegir cuenta, el runtime construye el cliente que usan las fases F y G', () => {
  it('el cliente de LECTURA existe y habla con la cuenta de ESA empresa', async () => {
    const comp = composicion(ORG_A, [cuenta('1111111111')]);
    await conectarYElegir(comp, ORG_A, '1111111111');

    const espia = espiarFetch();
    const cliente = await clienteDeLecturaGoogle(ORG_A, { pool, env: ENV, composicionGoogleAds: comp });
    expect(cliente, 'el puente debería haber dejado la conexión lista para leer').not.toBeNull();

    await cliente!.buscar('1111111111', 'SELECT campaign.id FROM campaign LIMIT 1');
    expect(espia.llamadas).toHaveLength(1);
    expect(espia.llamadas[0]!.url).toContain('/customers/1111111111/');
    expect(espia.llamadas[0]!.headers['login-customer-id']).toBe('1111111111');
    // El developer token es de la APLICACIÓN; el access token viene del refresh CIFRADO de esta empresa.
    expect(espia.llamadas[0]!.headers['developer-token']).toBe('dev-token-de-la-aplicacion');
    expect(espia.llamadas[0]!.headers['authorization']).toBe(`Bearer access-de-refresh-${ORG_A}`);
  });

  it('el cliente de ESCRITURA aparece sólo cuando la empresa enciende el permiso, y usa su propia cuenta', async () => {
    // La cuenta accesible es el MCC; la del negocio cuelga de él, así que el login-customer-id es el manager.
    const comp = composicion(ORG_A, [cuenta('7000000000', { manager: true }), cuenta('1111111111')], undefined, ['1111111111']);
    await conectarYElegir(comp, ORG_A, '1111111111');

    // Conectar no autoriza a escribir: hasta que el permiso se enciende, no hay cliente de escritura.
    expect(await clienteDeEscrituraGoogle(ORG_A, { pool, env: ENV, composicionGoogleAds: comp })).toBeNull();

    await new RepositorioConexiones(pool).fijarCapacidad(pool, {
      organizationId: ORG_A, capacidad: 'ESCRITURA_ADS', habilitada: true, origen: 'UI',
      nota: 'lo encendió el dueño', actor: 'dueña',
    });
    const espia = espiarFetch();
    const cliente = await clienteDeEscrituraGoogle(ORG_A, { pool, env: ENV, composicionGoogleAds: comp });
    expect(cliente).not.toBeNull();

    await cliente!.buscar('1111111111', 'SELECT campaign.id FROM campaign LIMIT 1');
    // El login-customer-id sale del manager descubierto en Google y proyectado al SSOT.
    expect(espia.llamadas[0]!.headers['login-customer-id']).toBe('7000000000');
  });

  it('el secret_ref del SSOT es null y aun así las credenciales se resuelven: viven en el depósito del proveedor', async () => {
    const comp = composicion(ORG_A, [cuenta('1111111111')]);
    await conectarYElegir(comp, ORG_A, '1111111111');

    const ssot = await new RepositorioConexiones(pool).buscar(ORG_A, 'GOOGLE_ADS');
    expect(ssot?.secretRef).toBeNull();
    // La credencial está en la tabla del proveedor, cifrada y referenciada por su propio secretRef.
    const { rows } = await pool.query('select secret_ref, status from google_ads_credential where organization_id = $1', [ORG_A]);
    expect(rows[0].status).toBe('ACTIVE');
    expect(String(rows[0].secret_ref)).toContain(`secretstore:${ORG_A}/`);
    // Y el refresh token NO está en claro en ninguna de las dos tablas.
    const claro = await pool.query(
      `select count(*)::int as n from google_ads_credential, business_connection
       where google_ads_credential.organization_id = $1 and (google_ads_credential.secret_ref like $2 or business_connection.configuracion::text like $2)`,
      [ORG_A, `%refresh-${ORG_A}%`],
    );
    expect(claro.rows[0].n).toBe(0);

    const espia = espiarFetch();
    const cliente = await clienteDeLecturaGoogle(ORG_A, { pool, env: ENV, composicionGoogleAds: comp });
    await cliente!.buscar('1111111111', 'SELECT campaign.id FROM campaign LIMIT 1');
    expect(espia.llamadas[0]!.headers['authorization']).toBe(`Bearer access-de-refresh-${ORG_A}`);
  });
});

describe('el cliente se resuelve por empresa, y falla cerrado', () => {
  it('cada empresa habla con su cuenta y con su credencial; ninguna ve la de la otra', async () => {
    const compA = composicion(ORG_A, [cuenta('1111111111')]);
    const compB = composicion(ORG_B, [cuenta('2222222222')]);
    await conectarYElegir(compA, ORG_A, '1111111111');
    await conectarYElegir(compB, ORG_B, '2222222222');

    const espia = espiarFetch();
    const a = await clienteDeLecturaGoogle(ORG_A, { pool, env: ENV, composicionGoogleAds: compA });
    const b = await clienteDeLecturaGoogle(ORG_B, { pool, env: ENV, composicionGoogleAds: compB });
    await a!.buscar('1111111111', 'SELECT campaign.id FROM campaign LIMIT 1');
    await b!.buscar('2222222222', 'SELECT campaign.id FROM campaign LIMIT 1');

    expect(espia.llamadas[0]!.url).toContain('/customers/1111111111/');
    expect(espia.llamadas[0]!.headers['authorization']).toBe(`Bearer access-de-refresh-${ORG_A}`);
    expect(espia.llamadas[1]!.url).toContain('/customers/2222222222/');
    expect(espia.llamadas[1]!.headers['authorization']).toBe(`Bearer access-de-refresh-${ORG_B}`);
    // Y la resolución es por organization_id: la conexión de A no existe bajo el id de B.
    expect(await compB.connRepo.obtener(ORG_B, connectionIdDe(ORG_A))).toBeNull();
  });

  it('sin OAuth no hay cliente para esa empresa, aunque otra sí lo tenga', async () => {
    const compA = composicion(ORG_A, [cuenta('1111111111')]);
    await conectarYElegir(compA, ORG_A, '1111111111');
    expect(await clienteDeLecturaGoogle(ORG_B, { pool, env: ENV, composicionGoogleAds: compA })).toBeNull();
  });

  it('OAuth revocado: el cliente se construye pero NINGUNA lectura ocurre sin token — nunca cae a un token de entorno', async () => {
    const comp = composicion(ORG_A, [cuenta('1111111111')]);
    await conectarYElegir(comp, ORG_A, '1111111111');
    comp.oauthFake.invalidGrant = true; // Google revoca el refresh token

    const espia = espiarFetch();
    const cliente = await clienteDeLecturaGoogle(ORG_A, { pool, env: ENV, composicionGoogleAds: comp });
    await expect(cliente!.buscar('1111111111', 'SELECT campaign.id FROM campaign LIMIT 1')).rejects.toThrow(/NO_ACCESS_TOKEN/);
    expect(espia.llamadas).toHaveLength(0); // no se llamó a Google con nada
  });

  it('una conexión CONNECTED en el SSOT sin credencial del proveedor no produce lecturas', async () => {
    // Se fabrica a mano el estado incoherente: SSOT conectado, proveedor sin OAuth.
    await new RepositorioConexiones(pool).guardar(pool, {
      organizationId: ORG_A, provider: 'GOOGLE_ADS', id: `${ORG_A}:GOOGLE_ADS`, estado: 'CONNECTED',
      configuracion: { customerId: '1111111111', loginCustomerId: '1111111111' },
      externalAccountId: '1111111111', loginAccountId: '1111111111', secretRef: null,
      validadaEn: AHORA, ultimoError: null, origen: 'UI',
    });
    await new RepositorioConexiones(pool).fijarCapacidad(pool, {
      organizationId: ORG_A, capacidad: 'MEDICION_REAL', habilitada: true, origen: 'UI', nota: null, actor: 'qa',
    });

    const comp = composicion(ORG_A, [cuenta('1111111111')]);
    const espia = espiarFetch();
    const cliente = await clienteDeLecturaGoogle(ORG_A, { pool, env: ENV, composicionGoogleAds: comp });
    await expect(cliente!.buscar('1111111111', 'SELECT campaign.id FROM campaign LIMIT 1')).rejects.toThrow(/NO_ACCESS_TOKEN/);
    expect(espia.llamadas).toHaveLength(0);
  });
});

describe('el defecto original, antes y después', () => {
  it('ANTES del puente (OAuth completo pero SSOT vacío) no había cliente; DESPUÉS sí', async () => {
    const comp = composicion(ORG_A, [cuenta('1111111111')]);
    // ANTES: se reproduce el estado que dejaba el flujo sin puente — proveedor CONNECTED, SSOT vacío.
    const st = crearEstadoGoogleAds({ nonce: 'n'.repeat(32), ahora: AHORA, ttlMs: 600_000 }, ORG_A, 'dueña');
    await comp.stateStore.guardar(st);
    await procesarCallbackGoogleAds(comp, { code: 'codigo-bueno', stateValor: st.valor });
    const sinPuente = await seleccionarCuenta({ ...comp, puenteSsot: undefined }, ORG_A, '1111111111');
    expect(sinPuente.ok).toBe(true);
    expect(await new RepositorioConexiones(pool).buscar(ORG_A, 'GOOGLE_ADS')).toBeNull();
    expect(await clienteDeLecturaGoogle(ORG_A, { pool, env: ENV, composicionGoogleAds: comp })).toBeNull();

    // DESPUÉS: la misma selección, con el puente puesto.
    const conPuente = await seleccionarCuenta(comp, ORG_A, '1111111111');
    expect(conPuente.ok).toBe(true);
    expect(await clienteDeLecturaGoogle(ORG_A, { pool, env: ENV, composicionGoogleAds: comp })).not.toBeNull();
  });
});
