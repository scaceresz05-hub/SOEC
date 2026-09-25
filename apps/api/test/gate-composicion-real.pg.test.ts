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
import { verificacionMigrations } from '../src/verificacion/verificacion-pg';
import { VerificacionService } from '../src/verificacion/verificacion-service';
import { HandoffService } from '../src/handoff/handoff-service';
import { depsDeHandoff, estadoGoogleParaHandoff } from '../src/handoff/composicion';
import { correrTickDeHandoffs } from '../src/handoff/handoff-scheduler';
import { lectorFacturacionGoogle } from '../src/facturacion/composicion';
import { lectorVerificacionGoogle, puertoVerificacionGoogle } from '../src/verificacion/composicion';
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
  /** Cuando no es null, la llamada de identidad responde ese estado HTTP en vez de programas. */
  identidadHttp: null as number | null,
  /** Código de error de Google para la llamada de identidad. */
  identidadErrorCode: 'PERMISSION_DENIED',
  /** Cuántas veces se llamó de verdad al proveedor de identidad. */
  llamadasIdentidad: 0,
  llamadas: [] as string[],
};

/** Transporte de mentira: responde a las dos consultas GAQL y a la de verificación. */
const fetchFalso: typeof fetch = (async (url: unknown, init?: { body?: string }) => {
  const u = String(url);
  const cuerpo = String(init?.body ?? '');
  mundo.llamadas.push(u.includes('searchStream') ? `GAQL:${cuerpo.includes('billing_setup') ? 'billing' : 'customer'}` : 'identidad');

  if (u.includes('getIdentityVerification')) {
    mundo.llamadasIdentidad += 1;
    if (mundo.identidadHttp !== null) {
      return new Response(JSON.stringify({
        error: {
          code: mundo.identidadHttp, status: 'INVALID_ARGUMENT',
          details: [{ errors: [{ errorCode: { identityVerificationError: mundo.identidadErrorCode }, message: 'no disponible' }] }],
        },
      }), { status: mundo.identidadHttp, headers: { 'content-type': 'application/json' } });
    }
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
  await runMigrations(pool, verificacionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate verification_attestation, verification_observability, payment_attestation, external_handoff, accion_ledger, accion_mandato, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile cascade');
  await altaDeNegocioYCuenta();
  mundo.configuracionAprobada = true;
  mundo.programas = [];
  mundo.estadoCuenta = 'ENABLED';
  mundo.identidadHttp = null;
  mundo.identidadErrorCode = 'PERMISSION_DENIED';
  mundo.llamadasIdentidad = 0;
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
    // Identidad resuelta: sólo entonces el recorrido llega al paso del pago.
    mundo.programas = [{ verificationProgress: { programStatus: 'SUCCESS' } }];
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
  it('si Google no informa de ninguna verificación, NO se da por verificada ni se avanza', async () => {
    mundo.programas = [];
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    // Ni visto bueno ni paso siguiente: el recorrido se queda quieto hasta saber.
    expect(await abiertas()).toEqual([]);
  });

  it('con la identidad superada sí hay tarea mientras no haya atestación', async () => {
    mundo.programas = [{ verificationProgress: { programStatus: 'SUCCESS' } }];
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    expect(await abiertas()).toEqual(['PAYMENT_SETUP_REQUIRED']);
  });
});

describe('una observación fallida no es un avance', () => {
  const puerto = () => puertoVerificacionGoogle(pool, { env: ENV, composicionGoogleAds: composicionGoogle(), fetchFn: fetchFalso, ttlMs: 0 });

  it('lista vacía ⇒ UNKNOWN con su diagnóstico, y NO se adelanta el pago', async () => {
    mundo.programas = [];
    const v = await puerto().inspeccionar(ORG);
    expect(v.estado).toBe('UNKNOWN');
    expect(v.diagnostico).toBe('EMPTY_PROGRAM_LIST');
    expect(v.programas).toBe(0);

    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    expect(await abiertas(), 'con identidad indeterminada el recorrido se detiene').toEqual([]);
  });

  it('error del proveedor ⇒ RETRY_LATER con http y diagnóstico, y tampoco avanza', async () => {
    mundo.identidadHttp = 403;
    const v = await puerto().inspeccionar(ORG);
    expect(v.estado).toBe('RETRY_LATER');
    expect(v.diagnostico).toBe('PERMISSION_DENIED');
    expect(v.httpProveedor).toBe(403);

    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    expect(await abiertas()).toEqual([]);
  });

  it('429 se distingue de un error cualquiera', async () => {
    mundo.identidadHttp = 429;
    const v = await puerto().inspeccionar(ORG);
    expect(v.diagnostico).toBe('RATE_LIMITED');
    expect(v.estado).toBe('RETRY_LATER');
  });

  it('pendiente y superada tienen cada una su diagnóstico', async () => {
    mundo.programas = [{ verificationProgress: { programStatus: 'PENDING_USER_ACTION' } }];
    expect((await puerto().inspeccionar(ORG)).diagnostico).toBe('PROGRAM_PENDING_USER_ACTION');
    mundo.programas = [{ verificationProgress: { programStatus: 'SUCCESS' } }];
    expect((await puerto().inspeccionar(ORG)).diagnostico).toBe('PROGRAM_SUCCESS');
  });

  it('ningún registro lleva credenciales', async () => {
    const eventos: Record<string, unknown>[] = [];
    mundo.identidadHttp = 403;
    await puertoVerificacionGoogle(pool, {
      env: ENV, composicionGoogleAds: composicionGoogle(), fetchFn: fetchFalso, ttlMs: 0,
      log: (i) => eventos.push(i),
    }).inspeccionar(ORG);
    const texto = JSON.stringify(eventos).toLowerCase();
    expect(eventos.length).toBeGreaterThan(0);
    for (const prohibido of ['token', 'bearer', 'authorization', 'developer', 'secret', 'password', 'refresh']) {
      expect(texto, `«${prohibido}» no puede aparecer en un log`).not.toContain(prohibido);
    }
  });
});

describe('Fase I.7 · cuando Google no deja mirar, lo confirma una persona', () => {
  const puerto = () => puertoVerificacionGoogle(pool, { env: ENV, composicionGoogleAds: composicionGoogle(), fetchFn: fetchFalso, ttlMs: 0 });
  const servicioVerificacion = () => new VerificacionService(pool, {
    puerto: puerto(), cuentaElegida: (org) => cuentaElegidaDe(pool, org),
  });

  /** La respuesta REAL de Google para una cuenta autoservicio, tal como la devolvió la de CP. */
  const comoCP = (): void => { mundo.identidadHttp = 400; mundo.identidadErrorCode = 'BILLING_NOT_ON_MONTHLY_INVOICING'; };

  it('BILLING_NOT_ON_MONTHLY_INVOICING se clasifica como «no observable», no como error pasajero', async () => {
    comoCP();
    const v = await puerto().inspeccionar(ORG);
    expect(v.estado).toBe('SELF_SERVICE_VERIFICATION_UNOBSERVABLE');
    expect(v.diagnostico).toBe('SELF_SERVICE_VERIFICATION_UNOBSERVABLE');
    expect(v.estado).not.toBe('RETRY_LATER');
    expect(v.estado).not.toBe('ADVERTISER_VERIFICATION_READY');
  });

  it('y NO se vuelve a preguntar al proveedor en los ticks siguientes', async () => {
    comoCP();
    await puerto().inspeccionar(ORG);
    expect(mundo.llamadasIdentidad).toBe(1);

    for (let i = 0; i < 4; i += 1) await puerto().inspeccionar(ORG);
    expect(mundo.llamadasIdentidad, 'una puerta cerrada no se empuja cada cinco minutos').toBe(1);
  });

  it('un 429 sigue siendo temporal: no se confunde con el régimen de la cuenta', async () => {
    mundo.identidadHttp = 429;
    mundo.identidadErrorCode = 'QUOTA_ERROR';
    expect((await puerto().inspeccionar(ORG)).estado).toBe('RETRY_LATER');
    expect((await puerto().inspeccionar(ORG)).diagnostico).toBe('RATE_LIMITED');
    // No se recuerda como «no observable»: mañana puede responder, así que se vuelve a preguntar.
    expect(mundo.llamadasIdentidad).toBe(2);
  });

  it('el recorrido de CP: identidad primero, pago después, y nada al final', async () => {
    comoCP();
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    expect(await abiertas()).toEqual(['IDENTITY_VERIFICATION_REQUIRED']);

    const v = await servicioComoEnProduccion().vista(ORG);
    expect(v.tarea?.titulo).toBe('Verifica tu empresa en Google');
    expect(v.tarea?.confirmacion).toEqual({ etiqueta: 'Confirmo que completé la verificación', recurso: 'VERIFICACION' });
    expect(v.tarea?.motivo).not.toMatch(/Google aprobó/i);
    expect(v.pendientes).toBe(0); // el pago todavía NO está abierto: una cosa a la vez

    await servicioVerificacion().confirmar(ORG, 'persona-qa');
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    expect(await abiertas()).toEqual(['PAYMENT_SETUP_REQUIRED']);

    await new FacturacionService(pool, {
      puerto: puertoFacturacionGoogle(pool, { env: ENV, composicionGoogleAds: composicionGoogle(), fetchFn: fetchFalso }),
      cuentaElegida: (org) => cuentaElegidaDe(pool, org),
    }).confirmar(ORG, 'persona-qa');
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    expect(await abiertas()).toEqual([]);
  });

  it('cambiar de cuenta deja sin efecto la confirmación anterior', async () => {
    comoCP();
    await servicioVerificacion().confirmar(ORG, 'persona-qa');
    expect((await puerto().inspeccionar(ORG)).estado).toBe('CONFIRMED_BY_USER');

    await pool.query("update business_connection set configuracion = jsonb_set(configuracion, '{customerId}', to_jsonb('9999999999'::text)) where organization_id = $1", [ORG]);
    expect((await puerto().inspeccionar(ORG)).estado).toBe('SELF_SERVICE_VERIFICATION_UNOBSERVABLE');
  });

  it('confirmar no registra que Google aprobó nada, y no guarda documentos', async () => {
    comoCP();
    await servicioVerificacion().confirmar(ORG, 'persona-qa');
    const filas = await pool.query('select * from verification_attestation where organization_id = $1', [ORG]);
    expect(Object.keys(filas.rows[0] as Record<string, unknown>).sort())
      .toEqual(['actor', 'confirmado_por_persona_en', 'customer_id', 'id', 'organization_id', 'proveedor']);
    const audit = await pool.query('select action, changed_fields from business_audit where organization_id = $1', [ORG]);
    expect(audit.rows.map((r: { action: string }) => r.action)).toContain('ADVERTISER_VERIFICATION_CONFIRMED_BY_HUMAN');
    const texto = `${JSON.stringify(filas.rows)} ${JSON.stringify(audit.rows)}`.toLowerCase();
    for (const prohibido of ['verified', 'approved', 'rut', 'documento', 'provider_verified']) {
      expect(texto, `«${prohibido}» no puede aparecer`).not.toContain(prohibido);
    }
  });

  it('confirmar no concede ningún permiso', async () => {
    comoCP();
    await servicioVerificacion().confirmar(ORG, 'persona-qa');
    const caps = (await new RepositorioConexiones(pool).capacidades(ORG)).filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(caps).not.toContain('ESCRITURA_ADS');
    expect(caps).not.toContain('AUTONOMIA_ADS');
    expect(await new PgMandatoRepo(pool).actual(ORG)).toBeNull();
    const g = await new RepositorioNegocios(pool).gobierno(ORG);
    expect(g?.autonomousSpend ?? false).toBe(false);
    expect(g?.campaignExecution ?? false).toBe(false);
  });

  it('si Google SÍ responde (facturación mensual), no se pide ninguna confirmación', async () => {
    mundo.programas = [{ verificationProgress: { programStatus: 'SUCCESS' } }];
    expect((await puerto().inspeccionar(ORG)).estado).toBe('ADVERTISER_VERIFICATION_READY');
    await correrTickDeHandoffs({ reanudador: servicioComoEnProduccion(), elegibles });
    expect(await abiertas()).toEqual(['PAYMENT_SETUP_REQUIRED']);
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
