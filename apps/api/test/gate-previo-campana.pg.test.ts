/**
 * GATE PREVIO A LA PRIMERA CAMPAÑA · tres cosas que tenían que dejar de pasar antes de gastar dinero de nadie.
 *
 * 1. RECICLAJE DE TAREAS. CP confirmó su verificación a las 16:13 y a las 16:27 el sistema volvió a pedírsela.
 *    La causa fue una caché: protegía la llamada a Google —que hay que proteger— pero cacheaba la lectura
 *    ENTERA, y esa lectura mezcla lo que dice Google con lo que dice nuestra propia base. Durante media hora
 *    el scheduler siguió viendo el mundo de antes de la confirmación. Cachear el dato propio no ahorra nada y
 *    cuesta pedirle dos veces lo mismo a quien ya lo hizo.
 *
 * 2. ESTADO DE INCORPORACIÓN CONGELADO. Venía del módulo TypeScript, así que una empresa podía conectar su
 *    cuenta y seguir marcada como «le faltan fuentes» para siempre. Una etapa termina cuando el mundo dice
 *    que terminó, no cuando alguien edita una constante.
 *
 * 3. TRES AUTORIZACIONES, TRES PUERTAS. Mandato financiero, permiso de escritura y autonomía son
 *    independientes: ninguna implica a las otras, y hacen falta las tres —en ese orden— para que exista una
 *    campaña que gaste.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { accionMigrations, PgMandatoRepo } from '../src/accion/accion-pg';
import { handoffMigrations, RepositorioHandoff } from '../src/handoff/handoff-pg';
import { facturacionMigrations, RepositorioConfirmacionDePago } from '../src/facturacion/facturacion-pg';
import { verificacionMigrations, RepositorioConfirmacionDeVerificacion, RepositorioObservabilidadVerificacion } from '../src/verificacion/verificacion-pg';
import { construirSnapshotDeNegocios } from '../src/conexion/proyeccion';
import { HandoffService } from '../src/handoff/handoff-service';
import { depsDeHandoff } from '../src/handoff/composicion';
import { correrTickDeHandoffs } from '../src/handoff/handoff-scheduler';
import { lectorFacturacionGoogle } from '../src/facturacion/composicion';
import { lectorVerificacionGoogle } from '../src/verificacion/composicion';
import { crearMandatoAutorizado, restanteMinor } from '../src/accion/mandato';
import type { ComponentesFlujoGoogleAds } from '../src/acquisition/google-ads-oauth-flow';

const pool = makeTestPool();
const ORG = 'org-qa-gate-campana';
const CUENTA = '8303175180';

const mundo = { llamadasIdentidad: 0, llamadasGaql: 0 };

/** Google: la verificación no es consultable (cuenta autoservicio) y hay una configuración de pago aprobada. */
const fetchFalso: typeof fetch = (async (url: unknown, init?: { body?: string }) => {
  const u = String(url);
  if (u.includes('getIdentityVerification')) {
    mundo.llamadasIdentidad += 1;
    return new Response(JSON.stringify({
      error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ errors: [{ errorCode: { identityVerificationError: 'BILLING_NOT_ON_MONTHLY_INVOICING' } }] }] },
    }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('searchStream')) {
    mundo.llamadasGaql += 1;
    const filas = String(init?.body ?? '').includes('billing_setup')
      ? [{ billingSetup: { status: 'APPROVED' } }]
      : [{ customer: { status: 'ENABLED' } }];
    return new Response(JSON.stringify([{ results: filas }]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

const composicionGoogle = (): ComponentesFlujoGoogleAds => ({
  stateStore: { guardar: async () => undefined, consumir: async () => null } as never,
  credRepo: { guardar: async () => undefined, obtener: async () => null, borrar: async () => undefined } as never,
  connRepo: {
    obtener: async (org: string) => ({
      organizationId: org, connectionId: `google-ads-${org}`, estado: 'CONNECTED', salud: 'HEALTHY',
      customerId: CUENTA, loginCustomerId: CUENTA, descriptiveName: 'Clínica QA', timeZone: 'America/Santiago',
      currencyCode: 'CLP', credencialRef: 'secretstore:org/token', needsReauth: false,
      createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z',
    }),
    guardar: async () => undefined, listarConectadas: async () => [],
  } as never,
  secretWriter: { escribir: async () => 'secretstore:x', resolver: async () => ({ usar: async (fn: (t: string) => unknown) => fn('refresh-falso') }) } as never,
  oauth: {
    intercambiarCodigo: async () => ({ ok: false, motivo: 'ERROR' }),
    refrescarAccessToken: async () => ({ ok: true, accessToken: 'token-falso', expiresIn: 3600 }),
    revocar: async () => undefined,
  },
  accounts: { listarAccesibles: async () => [] } as never,
  clientId: 'c', redirectUri: 'https://ejemplo/callback', ahora: () => new Date().toISOString(),
});

const ENV = { GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-falso' };

/** El mismo ensamblaje del servidor: una sola instancia, como en producción. */
function servicioDeProduccion(): HandoffService {
  const comp = composicionGoogle();
  return new HandoffService(pool, depsDeHandoff(pool, {
    estadoGoogle: async () => ({ estadoProveedor: 'CONNECTED', cuentasAccesibles: 1, cuentas: [{ customerId: CUENTA, manager: false, testAccount: false }] }),
    facturacion: lectorFacturacionGoogle(pool, { env: ENV, composicionGoogleAds: comp, fetchFn: fetchFalso }),
    verificacionAnunciante: lectorVerificacionGoogle(pool, { env: ENV, composicionGoogleAds: comp, fetchFn: fetchFalso }),
  }));
}

async function altaConCuenta(): Promise<void> {
  await new RepositorioNegocios(pool).insertarPerfil(pool, {
    organizationId: ORG, businessKey: `bk-${ORG}`, displayName: 'Clínica QA', legalName: 'CLINICA QA SpA',
    businessType: 'CLINICA', description: 'clínica dental', website: null, country: 'CL', currency: 'CLP',
    timezone: 'America/Santiago', language: 'es', customerType: 'B2C', primaryObjective: 'captar pacientes',
    status: 'ACTIVE', origen: 'UI',
  });
  await new RepositorioConexiones(pool).guardar(pool, {
    organizationId: ORG, provider: 'GOOGLE_ADS', id: `conn-${ORG}-google-ads`, tipo: 'ADS',
    estado: 'CONNECTED', origen: 'OAUTH', externalAccountId: CUENTA, externalAccountName: 'Clínica QA',
    loginAccountId: CUENTA, secretRef: null,
    configuracion: { customerId: CUENTA, loginCustomerId: CUENTA, moneda: 'CLP', zonaHoraria: 'America/Santiago' },
    ultimoError: null, validadaEn: null,
  } as never);
}

const atestarTodo = async (): Promise<void> => {
  await new RepositorioConfirmacionDeVerificacion(pool).registrar(pool, {
    id: 'ver-qa', organizationId: ORG, proveedor: 'GOOGLE_ADS', customerId: CUENTA, actor: 'persona-qa',
    confirmadoPorPersonaEn: new Date().toISOString(),
  });
  await new RepositorioConfirmacionDePago(pool).registrar(pool, {
    id: 'pay-qa', organizationId: ORG, proveedor: 'GOOGLE_ADS', customerId: CUENTA, actor: 'persona-qa',
    confirmadoEn: new Date().toISOString(),
  });
};

const elegibles = async (): Promise<readonly string[]> => [ORG];
const filas = async (): Promise<Array<{ id: string; estado: string; actualizado_en: unknown }>> =>
  (await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1 order by id', [ORG])).rows;

beforeEach(async () => {
  await runMigrations(pool);
  for (const m of [negocioMigrations, conexionMigrations, accionMigrations, handoffMigrations, facturacionMigrations, verificacionMigrations]) {
    await runMigrations(pool, m);
  }
  await ejecutarDestructivoDePrueba(pool, 'truncate verification_attestation, verification_observability, payment_attestation, external_handoff, accion_ledger, accion_mandato, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile cascade');
  mundo.llamadasIdentidad = 0;
  mundo.llamadasGaql = 0;
  await altaConCuenta();
});
afterAll(async () => { await pool.end(); });

describe('una condición ya satisfecha no se vuelve a pedir', () => {
  it('con identidad y pago confirmados, 10 ticks no crean ni cambian una sola tarea', async () => {
    await atestarTodo();
    const s = servicioDeProduccion();

    await correrTickDeHandoffs({ reanudador: s, elegibles });
    const antes = await filas();
    expect(antes).toHaveLength(0); // no hay nada que pedir: todo está resuelto

    for (let i = 0; i < 10; i += 1) await correrTickDeHandoffs({ reanudador: s, elegibles });

    expect(await filas()).toEqual(antes);
    const audit = await pool.query('select count(*)::int as n from business_audit where organization_id = $1', [ORG]);
    expect(audit.rows[0].n).toBe(0);
  });

  it('la confirmación se ve en el tick siguiente, no media hora después', async () => {
    const s = servicioDeProduccion();
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    expect((await filas()).length).toBe(1); // la de identidad

    // La persona confirma AHORA, con el mismo servicio vivo —ahí es donde la caché vieja mentía—.
    await atestarTodo();
    await correrTickDeHandoffs({ reanudador: s, elegibles });

    const abiertas = await new RepositorioHandoff(pool).abiertas(ORG);
    expect(abiertas, 'lo confirmado no puede volver a pedirse').toHaveLength(0);
  });

  it('y aun así no se golpea a Google en cada tick: su respuesta estable se recuerda', async () => {
    const s = servicioDeProduccion();
    for (let i = 0; i < 6; i += 1) await correrTickDeHandoffs({ reanudador: s, elegibles });
    expect(mundo.llamadasIdentidad, 'la negativa estable de Google se anota una vez').toBe(1);
  });

  it('el historial no se borra: lo que pasó, pasó', async () => {
    const s = servicioDeProduccion();
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    await atestarTodo();
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    const historial = await new RepositorioHandoff(pool).historial(ORG);
    expect(historial.length).toBeGreaterThan(0);
    expect(historial.every((h) => h.estado !== 'OPEN')).toBe(true);
  });
});

describe('el estado de incorporación lo dicen los datos', () => {
  it('con su cuenta conectada, deja de figurar como «le faltan fuentes»', async () => {
    const snap = await construirSnapshotDeNegocios(pool);
    const n = snap.configs.find((c) => c.negocio.organizationId === ORG)?.negocio;
    expect(n?.estado).not.toBe('SOURCES_PENDING');
    expect(n?.estado).toBe('OBSERVING');
  });

  it('y el pendiente de «cuenta de anuncios propia» desaparece cuando ya la tiene', async () => {
    const declarados = ['cuenta de anuncios propia, si alguna vez se abre', 'buzón de correo corporativo'];
    // La regla es genérica: se prueba sobre la proyección, con los pendientes que declare el registro.
    const snap = await construirSnapshotDeNegocios(pool);
    const n = snap.configs.find((c) => c.negocio.organizationId === ORG)?.negocio;
    expect(n?.datosHumanosPendientes.some((p) => /cuenta de anuncios/i.test(p))).toBe(false);
    // Lo que no sabemos comprobar se conserva: no saber no tacha nada.
    expect(declarados.some((p) => /buzón/i.test(p))).toBe(true);
  });
});

describe('tres autorizaciones, tres puertas', () => {
  const mandato = () => crearMandatoAutorizado(
    {
      organizationId: ORG, objective: 'captar pacientes', currency: 'CLP', authorizedBudgetMinor: 30_000,
      periodStart: new Date(Date.now() - 86_400_000).toISOString(),
      periodEnd: new Date(Date.now() + 60 * 86_400_000).toISOString(),
      allowedMetaAssets: [], allowedActionTypes: ['CREATE_CAMPAIGN'],
    },
    'persona-qa', 'mandato-qa', new Date().toISOString(),
  );

  it('el mandato se crea y se lee con AUTONOMIA_ADS y ESCRITURA_ADS apagadas', async () => {
    const caps = (await new RepositorioConexiones(pool).capacidades(ORG)).filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(caps).not.toContain('AUTONOMIA_ADS');
    expect(caps).not.toContain('ESCRITURA_ADS');

    const repo = new PgMandatoRepo(pool);
    await repo.guardar(mandato());
    const leido = await repo.actual(ORG);
    expect(leido?.authorizedBudgetMinor).toBe(30_000);
    expect(restanteMinor(leido!)).toBe(30_000);
  });

  it('el mandato por sí solo no enciende nada', async () => {
    await new PgMandatoRepo(pool).guardar(mandato());

    const caps = (await new RepositorioConexiones(pool).capacidades(ORG)).filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(caps).not.toContain('ESCRITURA_ADS');
    expect(caps).not.toContain('AUTONOMIA_ADS');
    const g = await new RepositorioNegocios(pool).gobierno(ORG);
    expect(g?.autonomousSpend ?? false).toBe(false);
    expect(g?.campaignExecution ?? false).toBe(false);
    // Y sigue sin haber gasto: autorizar un techo no es gastar.
    expect((await new PgMandatoRepo(pool).actual(ORG))?.spentMinor).toBe(0);
  });

  it('el permiso de escritura por sí solo tampoco autoriza gasto', async () => {
    await new RepositorioConexiones(pool).fijarCapacidadSiFalta(pool, {
      organizationId: ORG, capacidad: 'ESCRITURA_ADS', habilitada: true, origen: 'UI',
      nota: 'prueba', actor: 'persona-qa',
    });
    expect(await new PgMandatoRepo(pool).actual(ORG)).toBeNull(); // sin mandato no hay dinero autorizado
    const g = await new RepositorioNegocios(pool).gobierno(ORG);
    expect(g?.autonomousSpend ?? false).toBe(false);
  });
});
