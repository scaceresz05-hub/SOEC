/**
 * Autonomy Fase I.3 · TAREAS EXTERNAS: «SOEC llegó hasta aquí; ahora Google necesita que hagas una cosa».
 *
 * Lo que estas pruebas fijan no es que exista una tabla, sino tres promesas:
 *
 *   · pedir lo mismo dos veces NO son dos tareas; y si una se cumplió y el problema vuelve, la nueva tiene su
 *     propia historia en vez de resucitar la vieja;
 *   · nadie marca una tarea como hecha diciéndolo: la cierra un verificador que comprueba el mundo;
 *   · completar una tarea desbloquea un paso y NO concede permiso alguno — ni escritura, ni mandato, ni gasto.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { accionMigrations, PgMandatoRepo } from '../src/accion/accion-pg';
import { handoffMigrations, RepositorioHandoff } from '../src/handoff/handoff-pg';
import { HandoffService } from '../src/handoff/handoff-service';
import { handoffDeGoogle } from '../src/handoff/handoff-google';
import { HandoffInvalidoError, metadataSegura, tareaPrincipal, urlDeProveedorValida, type Handoff, type VerificadorHandoff } from '../src/handoff/handoff-tipos';

const pool = makeTestPool();
const AHORA = '2026-09-23T12:00:00.000Z';
const ORG_A = 'org-qa-handoff-a';
const ORG_B = 'org-qa-handoff-b';

const servicio = (verificadores: readonly VerificadorHandoff[] = []): HandoffService =>
  new HandoffService(pool, { ahora: () => AHORA, verificadores });

const intencionAlta = {
  canal: 'GOOGLE_ADS' as const,
  tipo: 'ACCOUNT_PROVISIONING_REQUIRED' as const,
  causa: 'sin-cuenta-de-anuncios',
  instruccion: 'Crea tu cuenta de anuncios en Google',
  motivo: 'Google ya está autorizado, pero todavía no encontramos una cuenta de anuncios.',
  etiquetaAccion: 'Continuar con Google',
  urlProveedor: 'https://ads.google.com/nav/selectaccount',
};

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
  await ejecutarDestructivoDePrueba(pool, 'truncate external_handoff, accion_ledger, accion_mandato, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile cascade');
  await altaDeNegocio(ORG_A);
  await altaDeNegocio(ORG_B);
});
afterAll(async () => { await pool.end(); });

describe('abrir una tarea externa', () => {
  it('se guarda con su instrucción, su motivo y su botón, y queda auditada', async () => {
    const h = await servicio().abrir(ORG_A, intencionAlta);
    expect(h.estado).toBe('OPEN');
    expect(h.instruccion).toContain('Crea tu cuenta de anuncios');
    expect(h.urlProveedor).toBe('https://ads.google.com/nav/selectaccount');

    const { rows } = await pool.query('select action, changed_fields from business_audit where organization_id = $1', [ORG_A]);
    expect(rows.map((r: { action: string }) => r.action)).toContain('EXTERNAL_HANDOFF_OPENED');
    expect(JSON.stringify(rows)).not.toMatch(/token|secret/i);
  });

  it('pedir lo mismo dos veces no crea dos tareas', async () => {
    const s = servicio();
    const a = await s.abrir(ORG_A, intencionAlta);
    const b = await s.abrir(ORG_A, { ...intencionAlta, motivo: 'redacción mejorada del mismo problema' });
    expect(b.id).toBe(a.id);
    expect(b.motivo).toContain('redacción mejorada'); // se refresca el texto, no se duplica la tarea

    const { rows } = await pool.query('select count(*)::int as n from external_handoff where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(1);
    const auditoria = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action = 'EXTERNAL_HANDOFF_OPENED'", [ORG_A]);
    expect(auditoria.rows[0].n).toBe(1); // tampoco se audita dos veces lo mismo
  });

  it('si se completó y el problema vuelve, la nueva tarea es otra fila con su propia historia', async () => {
    const s = servicio();
    const primera = await s.abrir(ORG_A, intencionAlta);
    await new RepositorioHandoff(pool).cambiarEstado(pool, ORG_A, primera.id, 'COMPLETED');
    const segunda = await s.abrir(ORG_A, intencionAlta);

    expect(segunda.id).not.toBe(primera.id);
    expect(segunda.estado).toBe('OPEN');
    const { rows } = await pool.query('select count(*)::int as n from external_handoff where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(2);
  });

  it('una dirección que no es de un proveedor conocido no se abre nunca', async () => {
    for (const url of ['http://ads.google.com/x', 'https://ads-google.com.phishing.example/x', 'https://usuario:clave@ads.google.com/x', 'no-es-una-url']) {
      await expect(servicio().abrir(ORG_A, { ...intencionAlta, urlProveedor: url })).rejects.toThrow(HandoffInvalidoError);
    }
    const { rows } = await pool.query('select count(*)::int as n from external_handoff where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(0); // fail-closed: no se escribió nada
  });

  it('la metadata no admite secretos, ni por nombre ni por contenido', () => {
    expect(() => metadataSegura({ refreshToken: 'x' })).toThrow(HandoffInvalidoError);
    expect(() => metadataSegura({ nota: 'secretstore:org/google-ads-refresh-token' })).toThrow(HandoffInvalidoError);
    expect(metadataSegura({ cuentasAccesibles: 0 })).toEqual({ cuentasAccesibles: 0 });
  });

  it('una dirección válida de un proveedor conocido sí se admite', () => {
    expect(urlDeProveedorValida('https://ads.google.com/nav/selectaccount')).toContain('ads.google.com');
    expect(urlDeProveedorValida(null)).toBeNull();
  });
});

describe('qué se le pide a la empresa AHORA', () => {
  it('con varias tareas abiertas se muestra una sola: la que toca por dependencia', async () => {
    const s = servicio();
    await s.abrir(ORG_A, { ...intencionAlta, tipo: 'PAYMENT_SETUP_REQUIRED', causa: 'sin-medio-de-pago', instruccion: 'Configura tu medio de pago', urlProveedor: 'https://payments.google.com/' });
    await s.abrir(ORG_A, { ...intencionAlta, tipo: 'OAUTH_CONSENT_REQUIRED', causa: 'sin-autorizacion', instruccion: 'Autoriza el acceso con Google', urlProveedor: null });
    await s.abrir(ORG_A, intencionAlta);

    const v = await s.vista(ORG_A);
    expect(v.tarea?.titulo).toContain('Autoriza el acceso');
    expect(v.pendientes).toBe(2); // las otras se cuentan, no se listan como diez bloqueos técnicos
  });

  it('sin tareas abiertas, no se pide nada', async () => {
    expect((await servicio().vista(ORG_A)).tarea).toBeNull();
  });

  it('salir al proveedor deja la tarea esperando al mundo, no a la persona', async () => {
    const s = servicio();
    const h = await s.abrir(ORG_A, intencionAlta);
    await s.marcarEsperandoFuera(ORG_A, h.id);
    const v = await s.vista(ORG_A);
    expect(v.tarea?.esperando).toBe(true);
  });

  it('una tarea vencida deja de pedirse', async () => {
    const s = servicio();
    const h = await s.abrir(ORG_A, intencionAlta, { expiraEn: '2026-09-22T00:00:00.000Z' });
    expect(h.expiraEn).not.toBeNull();
    const v = await s.vista(ORG_A);
    expect(v.tarea).toBeNull();
    const { rows } = await pool.query('select estado from external_handoff where id = $1', [h.id]);
    expect(rows[0].estado).toBe('EXPIRED');
  });
});

describe('el estado de Google se traduce a UNA tarea', () => {
  it.each([
    ['sin autorización', { estadoProveedor: null, cuentasAccesibles: null, cuentaEnElSsot: false }, 'OAUTH_CONSENT_REQUIRED'],
    ['autorización caducada', { estadoProveedor: 'NEEDS_REAUTH', cuentasAccesibles: null, cuentaEnElSsot: false }, 'OAUTH_CONSENT_REQUIRED'],
    ['autorizado y sin cuentas', { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 0, cuentaEnElSsot: false }, 'ACCOUNT_PROVISIONING_REQUIRED'],
    ['autorizado con cuentas', { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 3, cuentaEnElSsot: false }, 'ACCOUNT_SELECTION_REQUIRED'],
    ['autorizado sin haber mirado', { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: null, cuentaEnElSsot: false }, 'ACCOUNT_SELECTION_REQUIRED'],
  ])('%s ⇒ %s', (_caso, estado, tipo) => {
    expect(handoffDeGoogle(estado as never)?.tipo).toBe(tipo);
  });

  it('con la cuenta ya elegida y escrita no queda nada pendiente', () => {
    expect(handoffDeGoogle({ estadoProveedor: 'CONNECTED', cuentasAccesibles: 2, cuentaEnElSsot: true })).toBeNull();
  });

  it('sincronizar abre la tarea del estado actual y cancela la que ya no aplica', async () => {
    const s = servicio();
    await s.sincronizarGoogle(ORG_A, { estadoProveedor: null, cuentasAccesibles: null, cuentaEnElSsot: false });
    expect((await s.vista(ORG_A)).tarea?.titulo).toContain('Autoriza');

    // La empresa autoriza y resulta que no tiene ninguna cuenta: cambia la tarea, no se acumulan.
    await s.sincronizarGoogle(ORG_A, { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 0, cuentaEnElSsot: false });
    const v = await s.vista(ORG_A);
    expect(v.tarea?.titulo).toContain('Crea tu cuenta de anuncios');
    expect(v.pendientes).toBe(0);

    // Y cuando la cuenta queda elegida, no se le pide nada más por este canal.
    await s.sincronizarGoogle(ORG_A, { estadoProveedor: 'CONNECTED', cuentasAccesibles: 2, cuentaEnElSsot: true });
    expect((await s.vista(ORG_A)).tarea).toBeNull();
  });

  it('ninguna tarea de Google menciona un nombre interno', async () => {
    const s = servicio();
    for (const estado of [
      { estadoProveedor: null, cuentasAccesibles: null, cuentaEnElSsot: false },
      { estadoProveedor: 'NEEDS_REAUTH', cuentasAccesibles: null, cuentaEnElSsot: false },
      { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 0, cuentaEnElSsot: false },
      { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 2, cuentaEnElSsot: false },
    ]) {
      await s.sincronizarGoogle(ORG_A, estado);
      const v = await s.vista(ORG_A);
      const texto = `${v.tarea?.titulo} ${v.tarea?.motivo} ${v.tarea?.etiquetaAccion}`;
      for (const interno of ['ACCOUNT_SELECTION_PENDING', 'NEEDS_REAUTH', 'OAuth', 'customerId', 'MCC', 'developer']) {
        expect(texto, `«${interno}» no puede salir a la pantalla`).not.toContain(interno);
      }
    }
  });
});

describe('cerrar una tarea la cierra el MUNDO, no la palabra de nadie', () => {
  const verificador = (cumplida: boolean): VerificadorHandoff => ({
    nombre: 'verificador-de-prueba',
    soporta: (h: Handoff) => h.tipo === 'ACCOUNT_PROVISIONING_REQUIRED',
    verificar: async () => ({ cumplida, detalle: cumplida ? 'la cuenta ya existe' : 'sigue sin haber cuenta', referenciaProveedor: cumplida ? 'cuenta-nueva' : null }),
  });

  it('cuando la condición se cumple, la tarea se cierra sola y queda auditada', async () => {
    const s = servicio([verificador(true)]);
    const h = await s.abrir(ORG_A, intencionAlta);
    const r = await s.verificarPendientes(ORG_A);
    expect(r.completadas).toEqual([h.id]);

    const cerrada = await new RepositorioHandoff(pool).porId(ORG_A, h.id);
    expect(cerrada?.estado).toBe('COMPLETED');
    expect(cerrada?.referenciaProveedor).toBe('cuenta-nueva');
    const { rows } = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action = 'EXTERNAL_HANDOFF_COMPLETED'", [ORG_A]);
    expect(rows[0].n).toBe(1);
  });

  it('si la condición NO se cumple, la tarea sigue abierta', async () => {
    const s = servicio([verificador(false)]);
    await s.abrir(ORG_A, intencionAlta);
    expect((await s.verificarPendientes(ORG_A)).completadas).toEqual([]);
    expect((await s.vista(ORG_A)).tarea).not.toBeNull();
  });

  it('sin verificador para ese tipo, la tarea NO se cierra: el silencio no es una confirmación', async () => {
    const s = servicio([]);
    await s.abrir(ORG_A, intencionAlta);
    expect((await s.verificarPendientes(ORG_A)).completadas).toEqual([]);
    expect((await s.vista(ORG_A)).tarea).not.toBeNull();
  });

  it('un verificador que falla tampoco cierra nada', async () => {
    const roto: VerificadorHandoff = {
      nombre: 'roto', soporta: () => true,
      verificar: async () => { throw new Error('el proveedor no respondió'); },
    };
    const s = servicio([roto]);
    await s.abrir(ORG_A, intencionAlta);
    expect((await s.verificarPendientes(ORG_A)).completadas).toEqual([]);
    expect((await s.vista(ORG_A)).tarea).not.toBeNull();
  });

  it('completar una tarea no concede NINGÚN permiso', async () => {
    const s = servicio([verificador(true)]);
    await s.abrir(ORG_A, intencionAlta);
    await s.verificarPendientes(ORG_A);

    const caps = (await new RepositorioConexiones(pool).capacidades(ORG_A)).filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(caps).not.toContain('ESCRITURA_ADS');
    expect(caps).not.toContain('AUTONOMIA_ADS');
    expect(await new PgMandatoRepo(pool).actual(ORG_A)).toBeNull();
    const gobierno = await new RepositorioNegocios(pool).gobierno(ORG_A);
    expect(gobierno?.autonomousSpend ?? false).toBe(false);
    expect(gobierno?.campaignExecution ?? false).toBe(false);
    const { rows } = await pool.query('select count(*)::int as n from business_connection where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(0); // tampoco se inventa una conexión
  });
});

describe('aislamiento entre empresas', () => {
  it('la tarea de una empresa no existe para la otra', async () => {
    const s = servicio();
    const deA = await s.abrir(ORG_A, intencionAlta);
    await s.abrir(ORG_B, { ...intencionAlta, causa: 'sin-cuenta-de-anuncios' });

    expect((await new RepositorioHandoff(pool).porId(ORG_B, deA.id))).toBeNull();
    expect((await s.vista(ORG_B)).tarea?.id).not.toBe(deA.id);
    // Y ninguna acción de B puede tocar la tarea de A.
    expect(await s.marcarEsperandoFuera(ORG_B, deA.id)).toBeNull();
    expect((await new RepositorioHandoff(pool).porId(ORG_A, deA.id))?.estado).toBe('OPEN');
  });

  it('la misma causa en dos empresas son dos tareas distintas, no un conflicto', async () => {
    const s = servicio();
    await s.abrir(ORG_A, intencionAlta);
    await s.abrir(ORG_B, intencionAlta);
    const { rows } = await pool.query('select organization_id, count(*)::int as n from external_handoff group by 1 order by 1');
    expect(rows).toEqual([{ organization_id: ORG_A, n: 1 }, { organization_id: ORG_B, n: 1 }]);
  });
});

describe('el caso de CP, sin tocar CP', () => {
  it('autorizado y sin ninguna cuenta: una sola tarea, en lenguaje humano, y ningún permiso concedido', async () => {
    const s = servicio();
    // Estado exacto de CP hoy: OAuth válido, cero cuentas accesibles, sin conexión en el SSOT.
    await s.sincronizarGoogle(ORG_A, { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 0, cuentaEnElSsot: false });

    const v = await s.vista(ORG_A);
    expect(v.pendientes).toBe(0);
    expect(v.tarea?.titulo).toBe('Crea tu cuenta de anuncios en Google');
    expect(v.tarea?.motivo).toContain('todavía no encontramos una cuenta de anuncios');
    expect(v.tarea?.etiquetaAccion).toBe('Continuar con Google');
    expect(v.tarea?.urlProveedor).toContain('ads.google.com');

    const abiertas = await new RepositorioHandoff(pool).abiertas(ORG_A);
    expect(abiertas).toHaveLength(1);
    expect(abiertas[0]!.tipo).toBe('ACCOUNT_PROVISIONING_REQUIRED');
    expect(await new PgMandatoRepo(pool).actual(ORG_A)).toBeNull();
  });
});

describe('la prioridad es del dominio, no del reloj', () => {
  it('login va antes que pago aunque se haya creado después', async () => {
    const base = { ...intencionAlta, urlProveedor: null };
    const pago: Handoff = { ...(await servicio().abrir(ORG_A, { ...base, tipo: 'PAYMENT_SETUP_REQUIRED', causa: 'pago' })) };
    const login: Handoff = { ...(await servicio().abrir(ORG_A, { ...base, tipo: 'LOGIN_REQUIRED', causa: 'login' })) };
    expect(tareaPrincipal([pago, login])?.id).toBe(login.id);
  });
});
