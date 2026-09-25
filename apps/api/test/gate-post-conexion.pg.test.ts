/**
 * GATE POST-CONEXIÓN · qué falta DESPUÉS de elegir la cuenta de Google Ads.
 *
 * Este fichero nace de una observación en producción que no cuadraba: CP terminó de elegir su cuenta, tenía
 * la tarjeta puesta en Google y la verificación de empresa pendiente… y SOEC no le pedía nada. Cero tareas.
 * Un sistema que no pide nada cuando falta algo es peor que uno que pide de más: parece que todo va bien.
 *
 * La causa era mía y está corregida aquí: el lector de facturación se construía con un cliente que exige la
 * capacidad `MEDICION_REAL`, que en la incorporación está apagada. El cliente salía `null`, la lectura decía
 * «no se pudo consultar», y `RETRY_LATER` —que por diseño no toca nada— dejaba el paso invisible. Un
 * fail-closed correcto escondiendo un camino muerto.
 *
 * Lo que se fija:
 *   · con cuenta conectada y sin atestación, aparece la tarea de pago;
 *   · si además Google pide verificar la empresa, esa va PRIMERO y es la única visible;
 *   · al completarse la identidad, el pago aparece solo;
 *   · nada de esto concede permisos.
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
import { verificadorDeAnunciante, verificadorDeFacturacion, verificadoresDeGoogle, VERIFICADORES_PENDIENTES } from '../src/handoff/handoff-verificadores';
import { correrTickDeHandoffs } from '../src/handoff/handoff-scheduler';
import { FacturacionGoogleAds } from '../src/facturacion/facturacion-google';
import type { EstadoFacturacion } from '../src/facturacion/facturacion-tipos';
import type { EstadoVerificacionAnunciante } from '../src/verificacion/verificacion-tipos';
import type { EstadoGoogleParaHandoff } from '../src/handoff/handoff-google';

const pool = makeTestPool();
const ORG_A = 'org-qa-gate-a';
const ORG_B = 'org-qa-gate-b';

/** El mundo de CP el día de la auditoría: cuenta elegida, identidad pendiente, pago no verificable. */
const mundoCP = () => ({
  facturacion: 'PAYMENT_SETUP_REQUIRED' as EstadoFacturacion,
  verificacion: 'ADVERTISER_VERIFICATION_REQUIRED' as EstadoVerificacionAnunciante,
});

function servicioDe(mundo: { facturacion: EstadoFacturacion; verificacion: EstadoVerificacionAnunciante }): HandoffService {
  const leer = async (): Promise<EstadoGoogleParaHandoff> => ({
    estadoProveedor: 'CONNECTED', cuentasAccesibles: 1, cuentaEnElSsot: true,
    facturacion: mundo.facturacion, verificacionAnunciante: mundo.verificacion,
  });
  return new HandoffService(pool, {
    leerEstadoGoogle: leer,
    verificadores: [
      ...verificadoresDeGoogle(leer),
      verificadorDeAnunciante(async () => mundo.verificacion),
      verificadorDeFacturacion(async () => mundo.facturacion),
      ...VERIFICADORES_PENDIENTES,
    ],
  });
}

async function altaDeNegocio(org: string): Promise<void> {
  await new RepositorioNegocios(pool).insertarPerfil(pool, {
    organizationId: org, businessKey: `bk-${org}`, displayName: `Empresa ${org}`, legalName: null,
    businessType: 'CLINICA', description: 'clínica dental', website: null, country: 'CL',
    currency: 'CLP', timezone: 'America/Santiago', language: 'es', customerType: 'B2C',
    primaryObjective: 'captar pacientes', status: 'ACTIVE', origen: 'UI',
  });
}

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await runMigrations(pool, accionMigrations);
  await runMigrations(pool, handoffMigrations);
  await runMigrations(pool, facturacionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate payment_attestation, external_handoff, accion_ledger, accion_mandato, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile cascade');
  await altaDeNegocio(ORG_A);
  await altaDeNegocio(ORG_B);
});
afterAll(async () => { await pool.end(); });

const elegibles = async (): Promise<readonly string[]> => [ORG_A];
const abiertas = async (org: string): Promise<readonly string[]> =>
  (await new RepositorioHandoff(pool).abiertas(org)).map((h) => h.tipo);

describe('el caso exacto de CP', () => {
  it('identidad pendiente + pago sin atestar ⇒ UNA sola tarea, y es la de verificar', async () => {
    const mundo = mundoCP();
    const s = servicioDe(mundo);
    await correrTickDeHandoffs({ reanudador: s, elegibles });

    expect(await abiertas(ORG_A)).toEqual(['IDENTITY_VERIFICATION_REQUIRED']);
    const v = await s.vista(ORG_A);
    expect(v.tarea?.titulo).toBe('Verifica tu empresa en Google');
    expect(v.tarea?.motivo).toMatch(/verificar quién está detrás de los anuncios/i);
    expect(v.tarea?.etiquetaAccion).toBe('Continuar con Google');
    expect(v.tarea?.urlProveedor).toContain('ads.google.com');
    expect(v.pendientes).toBe(0); // una cosa a la vez, de verdad: la de pago ni se abre todavía
    for (const jerga of ['IDENTITY_VERIFICATION_REQUIRED', 'PENDING_USER_ACTION', 'customerId', 'API']) {
      expect(`${v.tarea?.titulo} ${v.tarea?.motivo} ${v.tarea?.etiquetaAccion}`).not.toContain(jerga);
    }
  });

  it('al completarse la identidad, el pago aparece solo: nadie pulsa nada', async () => {
    const mundo = mundoCP();
    const s = servicioDe(mundo);
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    const identidad = (await new RepositorioHandoff(pool).abiertas(ORG_A))[0]!;

    // La persona presenta sus documentos en Google y Google la aprueba.
    mundo.verificacion = 'ADVERTISER_VERIFICATION_READY';
    const r = await correrTickDeHandoffs({ reanudador: s, elegibles });

    expect(r.completados).toBe(1);
    expect((await new RepositorioHandoff(pool).porId(ORG_A, identidad.id))?.estado).toBe('COMPLETED');
    expect(await abiertas(ORG_A)).toEqual(['PAYMENT_SETUP_REQUIRED']);
    expect((await s.vista(ORG_A)).tarea?.titulo).toBe('Revisa el pago de tus anuncios en Google');
  });

  it('y cuando el pago queda atestado, no queda nada pendiente', async () => {
    const mundo = mundoCP();
    mundo.verificacion = 'ADVERTISER_VERIFICATION_READY';
    const s = servicioDe(mundo);
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    expect(await abiertas(ORG_A)).toEqual(['PAYMENT_SETUP_REQUIRED']);

    mundo.facturacion = 'READY'; // la persona confirmó en SOEC
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    expect(await abiertas(ORG_A)).toEqual([]);
  });
});

describe('sin identidad pendiente, el pago es la tarea', () => {
  it('cuenta conectada y sin atestación ⇒ tarea de pago (el camino que estaba muerto)', async () => {
    const mundo = { facturacion: 'PAYMENT_SETUP_REQUIRED' as EstadoFacturacion, verificacion: 'ADVERTISER_VERIFICATION_READY' as EstadoVerificacionAnunciante };
    await correrTickDeHandoffs({ reanudador: servicioDe(mundo), elegibles });
    expect(await abiertas(ORG_A)).toEqual(['PAYMENT_SETUP_REQUIRED']);
  });

  it('si no se pudo consultar ninguna de las dos, no se inventa ni se borra nada', async () => {
    const mundo = mundoCP();
    const s = servicioDe(mundo);
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    const antes = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);

    mundo.verificacion = 'RETRY_LATER';
    mundo.facturacion = 'RETRY_LATER';
    const r = await correrTickDeHandoffs({ reanudador: s, elegibles });
    expect(r.completados).toBe(0);
    const despues = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);
    expect(despues.rows).toEqual(antes.rows);
  });

  it('repetir ticks no duplica tareas ni auditoría', async () => {
    const mundo = mundoCP();
    const s = servicioDe(mundo);
    for (let i = 0; i < 4; i += 1) await correrTickDeHandoffs({ reanudador: s, elegibles });
    const { rows } = await pool.query('select count(*)::int as n from external_handoff where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(1);
    const audit = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action = 'HANDOFF_CREATED'", [ORG_A]);
    expect(audit.rows[0].n).toBe(1);
  });

  it('tras un «reinicio», se retoma la tarea existente', async () => {
    const mundo = mundoCP();
    await correrTickDeHandoffs({ reanudador: servicioDe(mundo), elegibles });
    const original = (await new RepositorioHandoff(pool).abiertas(ORG_A))[0]!;
    await correrTickDeHandoffs({ reanudador: servicioDe(mundoCP()), elegibles });
    const ahora = await new RepositorioHandoff(pool).abiertas(ORG_A);
    expect(ahora).toHaveLength(1);
    expect(ahora[0]!.id).toBe(original.id);
  });

  it('la tarea de una empresa no aparece en la otra', async () => {
    await correrTickDeHandoffs({ reanudador: servicioDe(mundoCP()), elegibles });
    expect(await abiertas(ORG_B)).toEqual([]);
  });
});

describe('la facturación vuelve a ser alcanzable aunque no haya medición', () => {
  /**
   * La regresión de la causa raíz, al nivel del adaptador: con el proveedor alcanzable y sin facturación
   * mensual legible, el estado es «no verificable» —que pide confirmación humana— y NO «no se pudo consultar».
   */
  it('proveedor alcanzable + sin facturación mensual ⇒ se pide confirmación, no silencio', async () => {
    const adaptador = new FacturacionGoogleAds({
      cliente: async () => ({
        buscar: async (_c: string, query: string) => {
          if (query.includes('billing_setup')) throw new Error('no hay facturación mensual en esta cuenta');
          return [{ 'customer.status': 'ENABLED' }];
        },
      }),
      cuenta: async () => '8303175180',
      confirmacionVigente: async () => false,
    });
    const r = await adaptador.inspeccionar(ORG_A);
    expect(r.estado).toBe('PAYMENT_SETUP_REQUIRED');
    expect(r.observacion).toBe('SELF_SERVICE_PAYMENT_UNVERIFIABLE');
    expect(r.requiereConfirmacionHumana).toBe(true);
  });

  it('proveedor INALCANZABLE sigue siendo «no se pudo consultar»', async () => {
    const adaptador = new FacturacionGoogleAds({
      cliente: async () => ({ buscar: async () => { throw new Error('429'); } }),
      cuenta: async () => '8303175180',
      confirmacionVigente: async () => false,
    });
    expect((await adaptador.inspeccionar(ORG_A)).estado).toBe('RETRY_LATER');
  });
});

describe('ninguno de estos pasos concede nada', () => {
  it('ni escritura, ni autonomía, ni mandato, ni campañas, ni gasto', async () => {
    const mundo = mundoCP();
    const s = servicioDe(mundo);
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    mundo.verificacion = 'ADVERTISER_VERIFICATION_READY';
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    mundo.facturacion = 'READY';
    await correrTickDeHandoffs({ reanudador: s, elegibles });

    const caps = (await new RepositorioConexiones(pool).capacidades(ORG_A)).filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(caps).not.toContain('ESCRITURA_ADS');
    expect(caps).not.toContain('AUTONOMIA_ADS');
    expect(await new PgMandatoRepo(pool).actual(ORG_A)).toBeNull();
    const g = await new RepositorioNegocios(pool).gobierno(ORG_A);
    expect(g?.autonomousSpend ?? false).toBe(false);
    expect(g?.campaignExecution ?? false).toBe(false);
  });
});
