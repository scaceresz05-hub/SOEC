/**
 * Autonomy Fase I.6 · LA FORMA DE PAGO como tarea humana, y su cierre automático.
 *
 * El recorrido llega aquí cuando la cuenta ya está elegida: entonces falta decirle a Google cómo se paga. Es
 * una tarea que SOEC no puede hacer —ni quiere: nunca toca un número de tarjeta— y que sí puede COMPROBAR.
 * Eso es lo que estas pruebas fijan:
 *
 *   · a quien todavía no tiene cuenta no se le habla de pagos (el caso real de CP hoy);
 *   · sin forma de pago hay exactamente UNA tarea, con lenguaje humano y una dirección oficial de Google;
 *   · mientras Google la aprueba, no se le pide nada más y la tarea se mantiene;
 *   · cuando Google la refleja aprobada, la tarea se cierra SOLA — nadie pulsa «ya lo hice»;
 *   · y tener tarjeta en Google no es tener mandato en SOEC. Son dos autorizaciones distintas.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { accionMigrations, PgMandatoRepo } from '../src/accion/accion-pg';
import { handoffMigrations, RepositorioHandoff } from '../src/handoff/handoff-pg';
import { HandoffService } from '../src/handoff/handoff-service';
import { verificadorDeFacturacion, verificadoresDeGoogle, VERIFICADORES_PENDIENTES } from '../src/handoff/handoff-verificadores';
import { correrTickDeHandoffs } from '../src/handoff/handoff-scheduler';
import { FacturacionGoogleAds } from '../src/facturacion/facturacion-google';
import { facturacionMigrations, RepositorioConfirmacionDePago } from '../src/facturacion/facturacion-pg';
import { FacturacionService, NoHayCuentaQueConfirmarError } from '../src/facturacion/facturacion-service';
import type { EstadoFacturacion } from '../src/facturacion/facturacion-tipos';
import type { EstadoGoogleParaHandoff } from '../src/handoff/handoff-google';

const pool = makeTestPool();
const ORG_A = 'org-qa-billing-a';
const ORG_B = 'org-qa-billing-b';

/** Cuenta elegida y conectada: el punto del recorrido en el que la facturación pasa a importar. */
const CONECTADA = (facturacion?: EstadoFacturacion): EstadoGoogleParaHandoff => ({
  estadoProveedor: 'CONNECTED', cuentasAccesibles: 2, cuentaEnElSsot: true,
  ...(facturacion === undefined ? {} : { facturacion }),
});

/** El estado real de CP hoy: autorizado, sin ninguna cuenta accesible. */
const CP_HOY: EstadoGoogleParaHandoff = {
  estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 0, cuentaEnElSsot: false,
  capacidadProvisionamiento: 'HUMAN_PROVIDER_STEP_REQUIRED',
};

function servicio(estado: () => EstadoGoogleParaHandoff, facturacion?: () => Promise<EstadoFacturacion | null>): HandoffService {
  const leer = async (): Promise<EstadoGoogleParaHandoff> => estado();
  return new HandoffService(pool, {
    leerEstadoGoogle: leer,
    verificadores: [
      ...verificadoresDeGoogle(leer),
      ...(facturacion ? [verificadorDeFacturacion(facturacion)] : []),
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

const abiertas = async (org: string): Promise<readonly { tipo: string; estado: string }[]> =>
  (await new RepositorioHandoff(pool).abiertas(org)).map((h) => ({ tipo: h.tipo, estado: h.estado }));

describe('sin cuenta elegida no se habla de pagos', () => {
  /** CP hoy: su tarea es crear la cuenta. Hablarle de tarjetas sería adelantarse dos pasos. */
  it('el caso real de CP no genera ninguna tarea de forma de pago', async () => {
    const s = servicio(() => CP_HOY);
    await s.sincronizarGoogle(ORG_A, CP_HOY);
    const t = await abiertas(ORG_A);
    expect(t).toHaveLength(1);
    expect(t[0]!.tipo).toBe('ACCOUNT_PROVISIONING_REQUIRED');
    expect(t.some((x) => x.tipo === 'PAYMENT_SETUP_REQUIRED')).toBe(false);
  });

  it('sin conexión de Google tampoco aparece nada de pagos', async () => {
    const sinNada: EstadoGoogleParaHandoff = { estadoProveedor: null, cuentasAccesibles: null, cuentaEnElSsot: false };
    await servicio(() => sinNada).sincronizarGoogle(ORG_A, sinNada);
    expect((await abiertas(ORG_A)).some((x) => x.tipo === 'PAYMENT_SETUP_REQUIRED')).toBe(false);
  });
});

describe('con cuenta elegida, la forma de pago es la única cosa que falta', () => {
  it('sin forma de pago: UNA tarea, en lenguaje humano y hacia una dirección oficial de Google', async () => {
    const s = servicio(() => CONECTADA('PAYMENT_SETUP_REQUIRED'));
    await s.sincronizarGoogle(ORG_A, CONECTADA('PAYMENT_SETUP_REQUIRED'));

    const t = await abiertas(ORG_A);
    expect(t).toHaveLength(1);
    expect(t[0]!.tipo).toBe('PAYMENT_SETUP_REQUIRED');

    const v = await s.vista(ORG_A);
    expect(v.tarea?.titulo).toBe('Revisa el pago de tus anuncios en Google');
    expect(v.tarea?.motivo).toMatch(/no permite que SOEC compruebe tu tarjeta/i);
    expect(v.tarea?.motivo).toMatch(/SOEC no guarda números de tarjeta ni datos bancarios/i);
    expect(v.tarea?.etiquetaAccion).toBe('Abrir Google');
    expect(v.tarea?.urlProveedor).toBe('https://ads.google.com/aw/billing/summary');
    expect(v.pendientes).toBe(0);
    // Y se ofrece la atestación, que es lo único que puede cerrar este paso.
    expect(v.tarea?.confirmacion?.etiqueta).toBe('Confirmo que el pago está configurado');
    for (const jerga of ['billing_setup', 'PAYMENT_SETUP_REQUIRED', 'customer.status', 'APPROVED', 'PAN', 'CVV']) {
      expect(`${v.tarea?.titulo} ${v.tarea?.motivo} ${v.tarea?.etiquetaAccion}`).not.toContain(jerga);
    }
  });

  /** El defecto de I.6, fijado para que no vuelva: no se acusa a nadie de no haber hecho algo. */
  it('la tarea NO afirma que falte un método de pago: afirma que no podemos verlo', async () => {
    const s = servicio(() => CONECTADA('PAYMENT_SETUP_REQUIRED'));
    await s.sincronizarGoogle(ORG_A, CONECTADA('PAYMENT_SETUP_REQUIRED'));
    const t = `${(await s.vista(ORG_A)).tarea?.titulo} ${(await s.vista(ORG_A)).tarea?.motivo}`;
    expect(t).not.toMatch(/falta (el|la|tu) (método|forma) de pago/i);
    expect(t).not.toMatch(/no has configurado/i);
    expect(t).toMatch(/revisa/i);
  });

  it('con la forma de pago lista, no queda nada pendiente', async () => {
    const s = servicio(() => CONECTADA('READY'));
    await s.sincronizarGoogle(ORG_A, CONECTADA('READY'));
    expect(await abiertas(ORG_A)).toHaveLength(0);
  });

  it('mientras Google aprueba, la tarea se mantiene tal cual', async () => {
    const s = servicio(() => CONECTADA('PAYMENT_SETUP_REQUIRED'));
    await s.sincronizarGoogle(ORG_A, CONECTADA('PAYMENT_SETUP_REQUIRED'));
    const antes = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);

    await s.sincronizarGoogle(ORG_A, CONECTADA('PENDING_PROVIDER'));
    const despues = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);
    expect(despues.rows).toEqual(antes.rows); // NOOP real: ni un cambio, ni una auditoría
  });

  it('si no se sabe, no se inventa ni se borra nada', async () => {
    const s = servicio(() => CONECTADA('PAYMENT_SETUP_REQUIRED'));
    await s.sincronizarGoogle(ORG_A, CONECTADA('PAYMENT_SETUP_REQUIRED'));
    const antes = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);

    for (const estado of ['UNKNOWN', 'RETRY_LATER'] as const) {
      await s.sincronizarGoogle(ORG_A, CONECTADA(estado));
      const despues = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);
      expect(despues.rows, estado).toEqual(antes.rows);
    }
  });

  it('si la cuenta no está operativa, se dice y no se ofrece un botón inútil', async () => {
    const s = servicio(() => CONECTADA('BLOCKED_EXTERNAL'));
    await s.sincronizarGoogle(ORG_A, CONECTADA('BLOCKED_EXTERNAL'));
    const v = await s.vista(ORG_A);
    expect(v.tarea?.bloqueadaFuera).toBe(true);
    expect(v.tarea?.urlProveedor).toBeNull();
    expect(v.tarea?.motivo).toMatch(/sólo su soporte puede reactivarla/i);
  });
});

describe('el cierre ocurre solo, sin que nadie diga «ya lo hice»', () => {
  it('cuando Google refleja la forma de pago, el scheduler cierra la tarea y sigue', async () => {
    const mundo = { estado: CONECTADA('PAYMENT_SETUP_REQUIRED'), facturacion: 'PAYMENT_SETUP_REQUIRED' as EstadoFacturacion };
    const s = servicio(() => mundo.estado, async () => mundo.facturacion);
    const elegibles = async (): Promise<readonly string[]> => [ORG_A];

    await correrTickDeHandoffs({ reanudador: s, elegibles });
    const pago = (await new RepositorioHandoff(pool).abiertas(ORG_A))[0]!;
    expect(pago.tipo).toBe('PAYMENT_SETUP_REQUIRED');

    // La persona configura el pago en Google. No vuelve a SOEC ni pulsa nada.
    mundo.estado = CONECTADA('READY');
    mundo.facturacion = 'READY';
    const r = await correrTickDeHandoffs({ reanudador: s, elegibles });

    expect(r.completados).toBe(1);
    expect((await new RepositorioHandoff(pool).porId(ORG_A, pago.id))?.estado).toBe('COMPLETED');
    expect(await abiertas(ORG_A)).toHaveLength(0);
  });

  it('mientras sigue pendiente, el tick no cambia nada ni audita de más', async () => {
    const mundo = { estado: CONECTADA('PAYMENT_SETUP_REQUIRED'), facturacion: 'PAYMENT_SETUP_REQUIRED' as EstadoFacturacion };
    const s = servicio(() => mundo.estado, async () => mundo.facturacion);
    const elegibles = async (): Promise<readonly string[]> => [ORG_A];
    await correrTickDeHandoffs({ reanudador: s, elegibles });

    const antes = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);
    const auditAntes = (await pool.query('select count(*)::int as n from business_audit where organization_id = $1', [ORG_A])).rows[0].n;
    for (let i = 0; i < 3; i += 1) await correrTickDeHandoffs({ reanudador: s, elegibles });

    const despues = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);
    expect(despues.rows).toEqual(antes.rows);
    expect((await pool.query('select count(*)::int as n from business_audit where organization_id = $1', [ORG_A])).rows[0].n).toBe(auditAntes);
  });

  it('si el proveedor no responde, la tarea se preserva exactamente', async () => {
    const mundo = { estado: CONECTADA('PAYMENT_SETUP_REQUIRED'), falla: false };
    const s = servicio(() => mundo.estado, async () => {
      if (mundo.falla) throw new Error('429 Too Many Requests');
      return 'PAYMENT_SETUP_REQUIRED';
    });
    const elegibles = async (): Promise<readonly string[]> => [ORG_A];
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    const antes = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);

    mundo.falla = true;
    mundo.estado = CONECTADA('RETRY_LATER');
    const r = await correrTickDeHandoffs({ reanudador: s, elegibles });

    expect(r.completados).toBe(0);
    expect(r.retryLater).toBeGreaterThan(0);
    const despues = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);
    expect(despues.rows).toEqual(antes.rows);
  });

  it('cambiar de cuenta vuelve a evaluar la facturación de la NUEVA', async () => {
    const cuentas = { actual: '1111111111', consultadas: [] as string[] };
    const adaptador = new FacturacionGoogleAds({
      cliente: async () => ({
        buscar: async (customerId: string, query: string) => {
          if (query.includes('billing_setup')) cuentas.consultadas.push(customerId);
          // Una configuración aprobada: en una cuenta autoservicio real esto NO prueba nada, y por eso
          // ninguna de las dos cuentas queda «lista» sin que una persona lo confirme.
          return query.includes('billing_setup') ? [{ 'billingSetup.status': 'APPROVED' }] : [{ 'customer.status': 'ENABLED' }];
        },
      }),
      cuenta: async () => cuentas.actual,
      // La confirmación vale sólo para la primera cuenta.
      confirmacionVigente: async (_org, customerId) => customerId === '1111111111',
    });

    expect((await adaptador.inspeccionar(ORG_A)).estado).toBe('READY'); // atestada
    cuentas.actual = '2222222222'; // la empresa cambió de cuenta
    expect((await adaptador.inspeccionar(ORG_A)).estado).toBe('PAYMENT_SETUP_REQUIRED');
    expect(cuentas.consultadas).toEqual(['1111111111', '2222222222']); // se preguntó por la nueva, no por la vieja
  });
});

describe('la confirmación humana: lo único que cierra lo que no se puede ver', () => {
  const adaptador = (cuenta: () => string | null, filasPago: () => Array<Record<string, unknown>>): FacturacionGoogleAds =>
    new FacturacionGoogleAds({
      cliente: async () => ({
        buscar: async (_c: string, query: string) => (query.includes('billing_setup') ? filasPago() : [{ 'customer.status': 'ENABLED' }]),
      }),
      cuenta: async () => cuenta(),
      confirmacionVigente: async (org, customerId) =>
        (await new RepositorioConfirmacionDePago(pool).vigente(org, customerId)) !== null,
    });

  const servicioDe = (cuenta: () => string | null): FacturacionService => new FacturacionService(pool, {
    puerto: adaptador(cuenta, () => []),
    cuentaElegida: async () => cuenta(),
  });

  it('confirmar deja huella de quién y cuándo, y ni un dato financiero', async () => {
    const f = servicioDe(() => '1111111111');
    expect((await f.estado(ORG_A)).estado).toBe('PAYMENT_SETUP_REQUIRED');

    const c = await f.confirmar(ORG_A, 'persona-qa');
    expect(c.customerId).toBe('1111111111');
    expect((await f.estado(ORG_A)).estado).toBe('READY');

    const filas = await pool.query('select * from payment_attestation where organization_id = $1', [ORG_A]);
    expect(filas.rows).toHaveLength(1);
    const columnas = Object.keys(filas.rows[0] as Record<string, unknown>);
    expect(columnas.sort()).toEqual(['actor', 'confirmado_en', 'customer_id', 'id', 'organization_id', 'proveedor']);
    const audit = await pool.query("select action, changed_fields from business_audit where organization_id = $1 and action = 'PAYMENT_CONFIRMED_BY_HUMAN'", [ORG_A]);
    expect(audit.rows).toHaveLength(1);
    const texto = `${JSON.stringify(filas.rows)} ${JSON.stringify(audit.rows)}`.toLowerCase();
    for (const prohibido of ['pan', 'cvv', 'card', 'iban', 'tarjeta', 'token', 'secret']) {
      expect(texto, `«${prohibido}» no puede guardarse`).not.toContain(prohibido);
    }
  });

  it('confirmar dos veces no son dos hechos', async () => {
    const f = servicioDe(() => '1111111111');
    await f.confirmar(ORG_A, 'persona-qa');
    await f.confirmar(ORG_A, 'persona-qa');
    const { rows } = await pool.query('select count(*)::int as n from payment_attestation where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(1);
  });

  it('la confirmación vale para ESA cuenta: cambiar de cuenta la invalida', async () => {
    const cuenta = { actual: '1111111111' as string | null };
    const f = servicioDe(() => cuenta.actual);
    await f.confirmar(ORG_A, 'persona-qa');
    expect((await f.estado(ORG_A)).estado).toBe('READY');

    cuenta.actual = '2222222222'; // la empresa elige otra cuenta
    expect((await f.estado(ORG_A)).estado).toBe('PAYMENT_SETUP_REQUIRED');
    expect(await f.confirmacionVigente(ORG_A)).toBeNull();

    // Y volver a la anterior recupera lo ya confirmado: era un hecho sobre esa cuenta.
    cuenta.actual = '1111111111';
    expect((await f.estado(ORG_A)).estado).toBe('READY');
  });

  it('sin cuenta elegida no hay nada que confirmar', async () => {
    await expect(servicioDe(() => null).confirmar(ORG_A, 'persona-qa')).rejects.toThrow(NoHayCuentaQueConfirmarError);
    const { rows } = await pool.query('select count(*)::int as n from payment_attestation where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(0);
  });

  it('la confirmación de una empresa no vale para otra', async () => {
    await servicioDe(() => '1111111111').confirmar(ORG_A, 'persona-qa');
    const otra = new FacturacionService(pool, {
      puerto: adaptador(() => '1111111111', () => []),
      cuentaElegida: async () => '1111111111',
    });
    expect(await otra.confirmacionVigente(ORG_B)).toBeNull();
    expect((await otra.estado(ORG_B)).estado).toBe('PAYMENT_SETUP_REQUIRED');
  });

  it('con la tarea abierta, la confirmación la cierra en el tick siguiente', async () => {
    const cuenta = { actual: '1111111111' };
    const f = servicioDe(() => cuenta.actual);
    // UNA sola fuente para las dos mitades —la que abre la tarea y la que la cierra—, igual que en producción:
    // si cada una mirara a un sitio distinto, el recorrido se pelearía consigo mismo.
    const estadoDelCanal = async (): Promise<EstadoFacturacion> => (await f.estado(ORG_A)).estado;
    const leer = async (): Promise<EstadoGoogleParaHandoff> => ({ ...CONECTADA(), facturacion: await estadoDelCanal() });
    const s = new HandoffService(pool, {
      leerEstadoGoogle: leer,
      verificadores: [...verificadoresDeGoogle(leer), verificadorDeFacturacion(estadoDelCanal), ...VERIFICADORES_PENDIENTES],
    });

    await correrTickDeHandoffs({ reanudador: s, elegibles: async () => [ORG_A] });
    const tarea = (await new RepositorioHandoff(pool).abiertas(ORG_A))[0]!;
    expect(tarea.tipo).toBe('PAYMENT_SETUP_REQUIRED');

    // La persona revisa en Google y confirma. Nadie pulsa «comprobar».
    await f.confirmar(ORG_A, 'persona-qa');
    const r = await correrTickDeHandoffs({ reanudador: s, elegibles: async () => [ORG_A] });
    expect(r.completados).toBe(1);
    expect((await new RepositorioHandoff(pool).porId(ORG_A, tarea.id))?.estado).toBe('COMPLETED');
    expect(await abiertas(ORG_A)).toHaveLength(0);
  });

  it('confirmar el pago no concede NINGÚN permiso', async () => {
    await servicioDe(() => '1111111111').confirmar(ORG_A, 'persona-qa');

    const caps = (await new RepositorioConexiones(pool).capacidades(ORG_A)).filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(caps).not.toContain('ESCRITURA_ADS');
    expect(caps).not.toContain('AUTONOMIA_ADS');
    expect(await new PgMandatoRepo(pool).actual(ORG_A)).toBeNull();
    const g = await new RepositorioNegocios(pool).gobierno(ORG_A);
    expect(g?.autonomousSpend ?? false).toBe(false);
    expect(g?.campaignExecution ?? false).toBe(false);
    const { rows } = await pool.query('select count(*)::int as n from campaign_plan where organization_id = $1', [ORG_A]).catch(() => ({ rows: [{ n: 0 }] }));
    expect(rows[0].n).toBe(0);
  });
});

describe('facturación no es mandato, y nada de esto guarda datos de pago', () => {
  it('tener forma de pago en Google no concede ningún permiso en SOEC', async () => {
    const mundo = { estado: CONECTADA('PAYMENT_SETUP_REQUIRED'), facturacion: 'PAYMENT_SETUP_REQUIRED' as EstadoFacturacion };
    const s = servicio(() => mundo.estado, async () => mundo.facturacion);
    await correrTickDeHandoffs({ reanudador: s, elegibles: async () => [ORG_A] });
    mundo.estado = CONECTADA('READY');
    mundo.facturacion = 'READY';
    await correrTickDeHandoffs({ reanudador: s, elegibles: async () => [ORG_A] });

    const caps = (await new RepositorioConexiones(pool).capacidades(ORG_A)).filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(caps).not.toContain('ESCRITURA_ADS');
    expect(caps).not.toContain('AUTONOMIA_ADS');
    expect(await new PgMandatoRepo(pool).actual(ORG_A)).toBeNull();
    const g = await new RepositorioNegocios(pool).gobierno(ORG_A);
    expect(g?.autonomousSpend ?? false).toBe(false);
    expect(g?.campaignExecution ?? false).toBe(false);
  });

  it('ni una fila ni una auditoría contienen datos de pago', async () => {
    const s = servicio(() => CONECTADA('PAYMENT_SETUP_REQUIRED'));
    await s.sincronizarGoogle(ORG_A, CONECTADA('PAYMENT_SETUP_REQUIRED'));
    const filas = await pool.query('select * from external_handoff where organization_id = $1', [ORG_A]);
    const audit = await pool.query('select * from business_audit where organization_id = $1', [ORG_A]);
    const texto = `${JSON.stringify(filas.rows)} ${JSON.stringify(audit.rows)}`.toLowerCase();
    for (const prohibido of ['pan', 'cvv', 'card_number', 'iban', 'tarjeta:', 'token', 'secret', 'payments_account_id']) {
      expect(texto, `«${prohibido}» no puede guardarse`).not.toContain(prohibido);
    }
  });

  it('la tarea de una empresa no se mezcla con la de otra', async () => {
    const s = servicio(() => CONECTADA('PAYMENT_SETUP_REQUIRED'));
    await s.sincronizarGoogle(ORG_A, CONECTADA('PAYMENT_SETUP_REQUIRED'));
    await s.sincronizarGoogle(ORG_B, CONECTADA('READY'));
    expect(await abiertas(ORG_A)).toHaveLength(1);
    expect(await abiertas(ORG_B)).toHaveLength(0);
  });
});
