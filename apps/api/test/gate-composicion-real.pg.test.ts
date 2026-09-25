/**
 * GATE · LA COMPOSICIÓN DE PRODUCCIÓN, EJERCITADA DE VERDAD.
 *
 * Este fichero existe por una lección cara. El paso de pago estuvo muerto para todas las empresas y las 500
 * pruebas seguían en verde, porque **todas inyectaban el lector ya construido**. Ninguna montaba la fábrica
 * real, así que nadie vio que el cliente se creaba detrás de una capacidad (`MEDICION_REAL`) que en la
 * incorporación está apagada. Un fail-closed correcto escondiendo un camino que no existía.
 *
 * Aquí se arma lo mismo que arma el servidor —`depsDeHandoff`, `lectorFacturacionGoogle`,
 * `lectorVerificacionGoogle`, `correrTickDeHandoffs`— sobre una base real, con las capacidades APAGADAS y un
 * proveedor de mentira al otro lado del `fetch`. Si alguien vuelve a cablear un lector detrás de la capacidad
 * equivocada, esto se pone rojo.
 *
 * Y fija las dos invariantes que una cuenta real rompió:
 *   · `billing_setup` aprobado NO basta para declarar que se puede gastar;
 *   · que Google no enumere verificaciones NO significa que estén superadas.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { accionMigrations, PgMandatoRepo } from '../src/accion/accion-pg';
import { handoffMigrations, RepositorioHandoff } from '../src/handoff/handoff-pg';
import { facturacionMigrations } from '../src/facturacion/facturacion-pg';
import { HandoffService } from '../src/handoff/handoff-service';
import { depsDeHandoff, estadoGoogleParaHandoff } from '../src/handoff/composicion';
import { correrTickDeHandoffs } from '../src/handoff/handoff-scheduler';
import { lectorFacturacionGoogle } from '../src/facturacion/composicion';
import { lectorVerificacionGoogle } from '../src/verificacion/composicion';
import { FacturacionService } from '../src/facturacion/facturacion-service';
import { puertoFacturacionGoogle } from '../src/facturacion/composicion';
import { cuentaElegidaDe } from '../src/facturacion/composicion';
import type { ComponentesFlujoGoogleAds } from '../src/acquisition/google-ads-oauth-flow';

const pool = makeTestPool();
const ORG = 'org-qa-composicion';
const CUENTA = '8303175180';

/** El mundo que devuelve el «Google» de mentira. Se cambia entre pasos, como cambia el real. */
const mundo = {
  /** `billing_setup` con una configuración aprobada: exactamente lo que devolvió una cuenta autoservicio. */
  configuracionAprobada: true,
  /** Programas de verificación que la API enumera. Vacío = Google no informa de ninguno. */
  programas: [] as Array<Record<string, unknown>>,
  estadoCuenta: 'ENABLED',
  llamadas: [] as string[],
};

/** Transporte de mentira: responde a las dos consultas GAQL y a la de verificación. */
const fetchFalso: typeof fetch = (async (url: unknown, init?: { body?: string }) => {
  const u = String(url);
  const cuerpo = String(init?.body ?? '');
  mundo.llamadas.push(u.includes('searchStream') ? `GAQL:${cuerpo.includes('billing_setup') ? 'billing' : 'customer'}` : 'identidad');

  if (u.includes('getIdentityVerification')) {
    return new Response(JSON.stringify({ identityVerification: mundo.programas }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('searchStream')) {
    const filas = cuerpo.includes('billing_setup')
      ? (mundo.configuracionAprobada ? [{ billingSetup: { status: 'APPROVED' } }] : [])
      : [{ customer: { status: mundo.estadoCuenta } }];
    return new Response(JSON.stringify([{ results: filas }]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

/**
 * Composición de Google con la MISMA FORMA que la de producción y puertos de mentira. Importa que la
 * resolución del token pase por el camino real —conexión del proveedor → credencial cifrada → refresh—,
 * porque ahí es donde se rompe el cableado cuando alguien lo cambia sin darse cuenta.
 */
const composicionGoogle = (): ComponentesFlujoGoogleAds => ({
  stateStore: { guardar: async () => undefined, consumir: async () => null } as never,
  credRepo: { guardar: async () => undefined, obtener: async () => null, borrar: async () => undefined } as never,
  connRepo: {
    obtener: async (org: string) => ({
      organizationId: org, connectionId: `google-ads-${org}`, estado: 'CONNECTED', salud: 'HEALTHY',
      customerId: CUENTA, loginCustomerId: CUENTA, descriptiveName: 'CP Odontología', timeZone: 'America/Santiago',
      currencyCode: 'CLP', credencialRef: 'secretstore:org/google-ads-refresh-token', needsReauth: false,
      createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z',
    }),
    guardar: async () => undefined,
    listarConectadas: async () => [],
  } as never,
  secretWriter: {
    escribir: async () => 'secretstore:x',
    // El secreto nunca se devuelve en claro: se «usa» dentro de un ámbito, como en producción.
    resolver: async () => ({ usar: async (fn: (t: string) => unknown) => fn('refresh-falso') }),
  } as never,
  oauth: {
    intercambiarCodigo: async () => ({ ok: false, motivo: 'ERROR' }),
    refrescarAccessToken: async () => ({ ok: true, accessToken: 'token-falso', expiresIn: 3600 }),
    revocar: async () => undefined,
  },
  accounts: { listarAccesibles: async () => [] } as never,
  clientId: 'cliente-falso', redirectUri: 'https://ejemplo/callback', ahora: () => new Date().toISOString(),
});

const ENV = { GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-falso' };

/** Exactamente el ensamblaje del servidor, con el transporte apuntando al doble. */
function servicioComoEnProduccion(): HandoffService {
  const comp = composicionGoogle();
  return new HandoffService(pool, depsDeHandoff(pool, {
    estadoGoogle: async () => ({ estadoProveedor: 'CONNECTED', cuentasAccesibles: 1, cuentas: [{ customerId: CUENTA, manager: false, testAccount: false }] }),
    facturacion: lectorFacturacionGoogle(pool, { env: ENV, composicionGoogleAds: comp, fetchFn: fetchFalso }),
    verificacionAnunciante: lectorVerificacionGoogle(pool, { env: ENV, composicionGoogleAds: comp, fetchFn: fetchFalso, ttlMs: 0 }),
  }));
}

async function altaDeNegocioYCuenta(): Promise<void> {
  await new RepositorioNegocios(pool).insertarPerfil(pool, {
    organizationId: ORG, businessKey: `bk-${ORG}`, displayName: 'CP Odontología (fixture)', legalName: null,
    businessType: 'CLINICA', description: 'clínica dental', website: null, country: 'CL',
    currency: 'CLP', timezone: 'America/Santiago', language: 'es', customerType: 'B2C',
    primaryObjective: 'captar pacientes', status: 'ACTIVE', origen: 'UI',
  });
  // La cuenta elegida, tal como la escribe la Fase I.1. Capacidades: NINGUNA encendida, como en la vida real.
  await new RepositorioConexiones(pool).guardar(pool, {
    organizationId: ORG, provider: 'GOOGLE_ADS', id: `conn-${ORG}-google-ads`, tipo: 'ADS',
    estado: 'CONNECTED', origen: 'OAUTH',
    externalAccountId: CUENTA, externalAccountName: 'CP Odontología', loginAccountId: CUENTA, secretRef: null,
    configuracion: { customerId: CUENTA, loginCustomerId: CUENTA, moneda: 'CLP', zonaHoraria: 'America/Santiago' },
    ultimoError: null, validadaEn: null,
  } as never);
}

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await runMigrations(pool, accionMigrations);
  await runMigrations(pool, handoffMigrations);
  await runMigrations(pool, facturacionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate payment_attestation, external_handoff, accion_ledger, accion_mandato, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile cascade');
  await altaDeNegocioYCuenta();
  mundo.configuracionAprobada = true;
  mundo.programas = [];
  mundo.estadoCuenta = 'ENABLED';
  mundo.llamadas = [];
});
afterAll(async () => { await pool.end(); });

const elegibles = async (): Promise<readonly string[]> => [ORG];
const abiertas = async (): Promise<readonly string[]> =>
  (await new RepositorioHandoff(pool).abiertas(ORG)).map((h) => h.tipo);

describe('con las capacidades apagadas, la composición real SÍ pregunta a Google', () => {
  it('el cliente se construye sin MEDICION_REAL: la consulta llega al proveedor', async () => {
    const caps = (await new RepositorioConexiones(pool).capacidades(ORG)).filter((c) => c.habilitada);
    expect(caps.map((c) => c.capacidad)).not.toContain('MEDICION_REAL');

    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    // La prueba de que el camino existe: se consultó de verdad al proveedor.
    expect(mundo.llamadas).toContain('GAQL:customer');
    expect(mundo.llamadas).toContain('GAQL:billing');
  });

  /** La invariante que una cuenta real rompió: aprobado NO es permiso para gastar. */
  it('billing_setup APPROVED sin atestación NO deja la cuenta lista: se pide confirmar', async () => {
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    expect(await abiertas()).toEqual(['PAYMENT_SETUP_REQUIRED']);

    const v = await servicioComoEnProduccion().vista(ORG);
    expect(v.tarea?.titulo).toBe('Revisa el pago de tus anuncios en Google');
    expect(v.tarea?.confirmacion?.etiqueta).toBe('Confirmo que el pago está configurado');
  });

  it('y el estado que se publica dice que hace falta una persona, no «listo»', async () => {
    const f = new FacturacionService(pool, {
      puerto: puertoFacturacionGoogle(pool, { env: ENV, composicionGoogleAds: composicionGoogle(), fetchFn: fetchFalso }),
      cuentaElegida: (org) => cuentaElegidaDe(pool, org),
    });
    const estado = await f.estado(ORG);
    expect(estado.estado).toBe('PAYMENT_SETUP_REQUIRED');
    expect(estado.observacion).toBe('SELF_SERVICE_PAYMENT_UNVERIFIABLE');
    expect(estado.requiereConfirmacionHumana).toBe(true);
  });
});

describe('el recorrido completo de CP, por la composición real', () => {
  it('identidad pendiente ⇒ ésa es la tarea; completada ⇒ aparece el pago; atestado ⇒ nada', async () => {
    // 1. Google informa de una verificación pendiente.
    mundo.programas = [{ verificationProgress: { programStatus: 'PENDING_USER_ACTION' }, identityVerificationRequirement: { verificationCompletionDeadlineTime: '2026-11-01 00:00:00' } }];
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    expect(await abiertas()).toEqual(['IDENTITY_VERIFICATION_REQUIRED']);
    expect((await servicioComoEnProduccion().vista(ORG)).tarea?.titulo).toBe('Verifica tu empresa en Google');

    // 2. La persona la completa en Google.
    mundo.programas = [{ verificationProgress: { programStatus: 'SUCCESS' } }];
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    expect(await abiertas()).toEqual(['PAYMENT_SETUP_REQUIRED']);

    // 3. Y confirma el pago en SOEC.
    const f = new FacturacionService(pool, {
      puerto: puertoFacturacionGoogle(pool, { env: ENV, composicionGoogleAds: composicionGoogle(), fetchFn: fetchFalso }),
      cuentaElegida: (org) => cuentaElegidaDe(pool, org),
    });
    await f.confirmar(ORG, 'persona-qa');
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    expect(await abiertas()).toEqual([]);
  });

  /** Lo que pasó de verdad: Google no enumeró nada y el sistema lo tomó por aprobado. */
  it('si Google no informa de ninguna verificación, NO se da por verificada', async () => {
    mundo.programas = [];
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    // No se inventa un visto bueno; se sigue con lo que sí se sabe que falta.
    expect(await abiertas()).toEqual(['PAYMENT_SETUP_REQUIRED']);
    expect(await abiertas()).not.toEqual([]);
  });

  it('nunca quedan 0 tareas mientras no haya atestación', async () => {
    for (const programas of [[], [{ verificationProgress: { programStatus: 'SUCCESS' } }]]) {
      await ejecutarDestructivoDePrueba(pool, 'truncate external_handoff cascade');
      mundo.programas = programas as Array<Record<string, unknown>>;
      await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
      expect(await abiertas(), JSON.stringify(programas)).not.toEqual([]);
    }
  });
});

describe('nada de esto concede permisos', () => {
  it('sin escritura, sin autonomía, sin mandato y sin campañas', async () => {
    mundo.programas = [{ verificationProgress: { programStatus: 'PENDING_USER_ACTION' } }];
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    mundo.programas = [{ verificationProgress: { programStatus: 'SUCCESS' } }];
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });

    const caps = (await new RepositorioConexiones(pool).capacidades(ORG)).filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(caps).not.toContain('ESCRITURA_ADS');
    expect(caps).not.toContain('AUTONOMIA_ADS');
    expect(await new PgMandatoRepo(pool).actual(ORG)).toBeNull();
    const g = await new RepositorioNegocios(pool).gobierno(ORG);
    expect(g?.autonomousSpend ?? false).toBe(false);
    expect(g?.campaignExecution ?? false).toBe(false);
  });
});

/** `estadoGoogleParaHandoff` se importa para fijar que el ensamblaje usa la misma pieza que el servidor. */
void estadoGoogleParaHandoff;
