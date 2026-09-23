/**
 * Autonomy Fase I.1 · EL PUENTE ENTRE «ELEGÍ MI CUENTA» Y «SOEC PUEDE TRABAJAR EN ELLA».
 *
 * SOEC guardaba la cuenta elegida en las tablas del proveedor y el motor de campañas leía otra tabla distinta.
 * Una empresa nueva terminaba su OAuth, elegía su cuenta, veía «conectada» en pantalla… y la preparación de
 * campaña seguía diciéndole «conecta tu cuenta de Google Ads». Aquí se fija el contrato que cierra esa grieta:
 *
 *   elegir cuenta válida  ⇒ `business_connection` CONNECTED con su identidad, su moneda y su zona horaria
 *   elegir cuenta válida  ⇒ CONNECTION_VALID y ACCOUNT_SELECTED pasan a PASS
 *   elegir cuenta válida  ⇒ y NADA MÁS: ni mandato, ni gasto, ni permiso de escritura, ni activación
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { politicaMigrations } from '../src/politica/politica-pg';
import { onboardingMigrations } from '../src/onboarding/onboarding-pg';
import { accionMigrations, PgMandatoRepo } from '../src/accion/accion-pg';
import { proyectarCuentaGoogleAds, evaluarCuentaParaOperar, type CuentaSeleccionada } from '../src/conexion/puente-google-ads';
import { evaluarPrerrequisitos } from '../src/ejecucion/prerrequisitos';

const pool = makeTestPool();
const AHORA = '2026-09-23T12:00:00.000Z';
const ORG_A = 'org-qa-puente-a';
const ORG_B = 'org-qa-puente-b';

const cuenta = (over: Partial<CuentaSeleccionada> = {}): CuentaSeleccionada => ({
  customerId: '1234567890',
  loginCustomerId: null,
  descriptiveName: 'Clínica QA · Google Ads',
  currencyCode: 'CLP',
  timeZone: 'America/Santiago',
  manager: false,
  testAccount: false,
  ...over,
});

async function altaDeNegocio(org: string, nombre: string): Promise<void> {
  await new RepositorioNegocios(pool).insertarPerfil(pool, {
    organizationId: org, businessKey: `bk-${org}`, displayName: nombre, legalName: null,
    businessType: 'CLINICA', description: 'clínica dental', website: null, country: 'CL',
    currency: 'CLP', timezone: 'America/Santiago', language: 'es', customerType: 'B2C',
    primaryObjective: 'captar pacientes', status: 'ACTIVE', origen: 'UI',
  });
}

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, identityMigrations);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await runMigrations(pool, politicaMigrations);
  await runMigrations(pool, onboardingMigrations);
  await runMigrations(pool, accionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate accion_ledger, accion_mandato, business_budget_intent, business_website_insight, business_onboarding_answer, business_onboarding, business_channel_rule, business_autonomy_limits, business_evaluation_rule, business_conversion_event, business_kpi, business_evaluation_policy, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile restart identity cascade');
  await altaDeNegocio(ORG_A, 'Empresa QA Puente A');
  await altaDeNegocio(ORG_B, 'Empresa QA Puente B');
});
afterAll(async () => { await pool.end(); });

const opciones = { pool, ahora: () => AHORA, actor: 'google-ads-oauth' };

describe('elegir cuenta queda escrito donde el motor lo lee', () => {
  it('la cuenta elegida se proyecta al SSOT con su identidad, su moneda y su zona horaria', async () => {
    const r = await proyectarCuentaGoogleAds(ORG_A, cuenta({ loginCustomerId: '9999999999' }), opciones);
    expect(r.ok).toBe(true);

    const c = await new RepositorioConexiones(pool).buscar(ORG_A, 'GOOGLE_ADS');
    expect(c?.estado).toBe('CONNECTED');
    expect(c?.externalAccountId).toBe('1234567890');
    expect(c?.loginAccountId).toBe('9999999999');
    expect(c?.origen).toBe('OAUTH');
    expect(c?.validadaEn).toBe(AHORA);
    expect(c?.configuracion).toMatchObject({
      customerId: '1234567890', loginCustomerId: '9999999999',
      moneda: 'CLP', zonaHoraria: 'America/Santiago', esManager: false, esCuentaDePrueba: false,
    });
    // Ningún secreto viaja al SSOT: la credencial sigue viviendo en el depósito cifrado del proveedor.
    expect(c?.secretRef).toBeNull();
    expect(JSON.stringify(c?.configuracion)).not.toMatch(/token|secret|refresh/i);
  });

  it('CONNECTION_VALID y ACCOUNT_SELECTED pasan a PASS, y lo demás sigue bloqueando', async () => {
    await proyectarCuentaGoogleAds(ORG_A, cuenta(), opciones);
    const conexion = await new RepositorioConexiones(pool).buscar(ORG_A, 'GOOGLE_ADS');
    const capacidades = await new RepositorioConexiones(pool).capacidades(ORG_A);

    const escritura = capacidades.some((c) => c.capacidad === 'ESCRITURA_ADS' && c.habilitada);
    const r = evaluarPrerrequisitos({
      perfil: (await new RepositorioNegocios(pool).perfil(ORG_A))!,
      gobierno: { organizationId: ORG_A, externalMutations: false, autonomousSpend: false, automaticSafetyPause: false, campaignExecution: false, updatedAt: AHORA },
      plan: null, corrida: null,
      conexion: conexion === null ? null : { estado: conexion.estado, customerId: (conexion.configuracion as { customerId?: string }).customerId ?? null },
      capacidadEscritura: escritura, modoOperativo: 'PILOT', killSwitchAbierto: true, mandato: null,
      medicion: [], ofertasConMaterial: [], ofertasActivas: 1, geosEjecutables: 0,
      landingsListas: [], claims: null, ahora: AHORA,
    });
    const veredicto = (id: string): string => r.find((x) => x.requisito === id)!.veredicto;

    expect(veredicto('CONNECTION_VALID')).toBe('PASS');
    expect(veredicto('ACCOUNT_SELECTED')).toBe('PASS');
    // Conectar una cuenta no es autorizar nada de lo que cuesta dinero.
    expect(veredicto('WRITE_CAPABILITY_ENABLED')).toBe('ACTION_REQUIRED');
    expect(veredicto('FINANCIAL_MANDATE_VALID')).toBe('ACTION_REQUIRED');
    expect(veredicto('OPERATING_MODE_ALLOWED')).toBe('BLOCKED');
  });

  it('se recalculan las capacidades de LECTURA, y ninguna que autorice gastar', async () => {
    await proyectarCuentaGoogleAds(ORG_A, cuenta(), opciones);
    const caps = await new RepositorioConexiones(pool).capacidades(ORG_A);
    const habilitadas = caps.filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(habilitadas).toContain('MEDICION_REAL');
    expect(habilitadas).not.toContain('ESCRITURA_ADS');
    expect(habilitadas).not.toContain('AUTONOMIA_ADS');

    // Ni mandato, ni gasto autónomo, ni ejecución de campañas: nada de eso lo concede conectar.
    const { rows } = await pool.query('select count(*)::int as n from accion_mandato where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(0);
    expect(await new PgMandatoRepo(pool).actual(ORG_A)).toBeNull();
    const gobierno = await new RepositorioNegocios(pool).gobierno(ORG_A);
    expect(gobierno?.autonomousSpend ?? false).toBe(false);
    expect(gobierno?.campaignExecution ?? false).toBe(false);
  });

  it('queda huella en la auditoría del negocio, con la cuenta y sin secretos', async () => {
    await proyectarCuentaGoogleAds(ORG_A, cuenta(), opciones);
    const { rows } = await pool.query('select action, changed_fields from business_audit where organization_id = $1', [ORG_A]);
    expect(rows.map((r: { action: string }) => r.action)).toContain('GOOGLE_ADS_ACCOUNT_LINKED');
    expect(JSON.stringify(rows)).toContain('1234567890');
    expect(JSON.stringify(rows)).not.toMatch(/token|secret/i);
  });
});

describe('repetir y cambiar de cuenta', () => {
  it('elegir dos veces la misma cuenta no duplica nada', async () => {
    await proyectarCuentaGoogleAds(ORG_A, cuenta(), opciones);
    await proyectarCuentaGoogleAds(ORG_A, cuenta(), opciones);

    const conexiones = await pool.query('select count(*)::int as n from business_connection where organization_id = $1', [ORG_A]);
    expect(conexiones.rows[0].n).toBe(1);
    const caps = await pool.query("select count(*)::int as n from business_capability where organization_id = $1 and capacidad = 'MEDICION_REAL'", [ORG_A]);
    expect(caps.rows[0].n).toBe(1);
  });

  it('cambiar a otra cuenta accesible actualiza la misma fila y lo deja escrito', async () => {
    await proyectarCuentaGoogleAds(ORG_A, cuenta(), opciones);
    await proyectarCuentaGoogleAds(ORG_A, cuenta({ customerId: '5555555555', descriptiveName: 'Otra cuenta' }), opciones);

    const c = await new RepositorioConexiones(pool).buscar(ORG_A, 'GOOGLE_ADS');
    expect(c?.externalAccountId).toBe('5555555555');
    const { rows } = await pool.query('select count(*)::int as n from business_connection where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(1);
    const auditoria = await pool.query('select action, changed_fields from business_audit where organization_id = $1 order by id', [ORG_A]);
    expect(auditoria.rows.map((r: { action: string }) => r.action)).toEqual(['GOOGLE_ADS_ACCOUNT_LINKED', 'GOOGLE_ADS_ACCOUNT_CHANGED']);
    expect(JSON.stringify(auditoria.rows[1].changed_fields)).toContain('1234567890'); // se dice de qué cuenta venía
  });

  it('una capacidad que la empresa apagó a mano no se vuelve a encender al reconectar', async () => {
    const repo = new RepositorioConexiones(pool);
    await repo.fijarCapacidad(pool, {
      organizationId: ORG_A, capacidad: 'MEDICION_REAL', habilitada: false, origen: 'UI',
      nota: 'la apagó el dueño', actor: 'dueña',
    });
    await proyectarCuentaGoogleAds(ORG_A, cuenta(), opciones);
    const cap = (await repo.capacidades(ORG_A)).find((c) => c.capacidad === 'MEDICION_REAL');
    expect(cap?.habilitada).toBe(false);
  });
});

describe('cuentas que no sirven para operar: fail closed', () => {
  it.each([
    ['una cuenta administradora (MCC)', { manager: true }, 'CUENTA_MANAGER'],
    ['una cuenta de prueba', { testAccount: true }, 'CUENTA_DE_PRUEBA'],
    ['sin moneda declarada', { currencyCode: null }, 'SIN_MONEDA'],
    ['con una moneda que no es ISO', { currencyCode: 'pesos' }, 'SIN_MONEDA'],
    ['sin zona horaria', { timeZone: null }, 'SIN_ZONA_HORARIA'],
  ])('%s no se conecta, y se explica por qué', async (_caso, over, motivo) => {
    const r = await proyectarCuentaGoogleAds(ORG_A, cuenta(over as Partial<CuentaSeleccionada>), opciones);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe(motivo);
      expect(r.explicacion.length).toBeGreaterThan(20); // una frase, no un código
    }
    // NADA se escribió: ni conexión, ni capacidad, ni auditoría.
    expect(await new RepositorioConexiones(pool).buscar(ORG_A, 'GOOGLE_ADS')).toBeNull();
    expect(await new RepositorioConexiones(pool).capacidades(ORG_A)).toEqual([]);
    const { rows } = await pool.query('select count(*)::int as n from business_audit where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(0);
  });

  it('una cuenta inválida NO deshace la conexión que ya funcionaba', async () => {
    await proyectarCuentaGoogleAds(ORG_A, cuenta(), opciones);
    const r = await proyectarCuentaGoogleAds(ORG_A, cuenta({ customerId: '7777777777', manager: true }), opciones);
    expect(r.ok).toBe(false);
    const c = await new RepositorioConexiones(pool).buscar(ORG_A, 'GOOGLE_ADS');
    expect(c?.estado).toBe('CONNECTED');
    expect(c?.externalAccountId).toBe('1234567890'); // sigue la buena
  });

  it('la evaluación es pura: se puede preguntar sin tocar la base', () => {
    expect(evaluarCuentaParaOperar(cuenta()).ok).toBe(true);
    const mcc = evaluarCuentaParaOperar(cuenta({ manager: true }));
    expect(mcc.ok).toBe(false);
    if (!mcc.ok) expect(mcc.explicacion).toContain('administradora');
  });
});

describe('aislamiento entre empresas', () => {
  it('la cuenta que eligió una empresa no aparece ni sirve para la otra', async () => {
    await proyectarCuentaGoogleAds(ORG_A, cuenta({ customerId: '1111111111' }), opciones);
    await proyectarCuentaGoogleAds(ORG_B, cuenta({ customerId: '2222222222' }), opciones);

    const repo = new RepositorioConexiones(pool);
    expect((await repo.buscar(ORG_A, 'GOOGLE_ADS'))?.externalAccountId).toBe('1111111111');
    expect((await repo.buscar(ORG_B, 'GOOGLE_ADS'))?.externalAccountId).toBe('2222222222');

    // Ni una fila de la otra empresa en ninguna de las dos tablas que toca el puente.
    for (const [org, ajena] of [[ORG_A, '2222222222'], [ORG_B, '1111111111']] as const) {
      const { rows } = await pool.query(
        'select count(*)::int as n from business_connection where organization_id = $1 and external_account_id = $2',
        [org, ajena],
      );
      expect(rows[0].n).toBe(0);
    }
    const caps = await pool.query('select organization_id, count(*)::int as n from business_capability group by 1 order by 1');
    expect(caps.rows).toEqual([
      { organization_id: ORG_A, n: 1 },
      { organization_id: ORG_B, n: 1 },
    ]);
  });
});
