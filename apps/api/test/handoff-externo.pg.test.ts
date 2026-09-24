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
import {
  HandoffInvalidoError, metadataSegura, prioridadDe, proveedorDeCanal, tareaPrincipal, urlDeProveedorValida,
  type Handoff, type ResultadoVerificacion, type VerificadorHandoff,
} from '../src/handoff/handoff-tipos';
import { verificadoresDeGoogle, VERIFICADORES_PENDIENTES } from '../src/handoff/handoff-verificadores';
import type { EstadoGoogleParaHandoff } from '../src/handoff/handoff-google';

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
    expect(rows.map((r: { action: string }) => r.action)).toContain('HANDOFF_CREATED');
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
    const auditoria = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action = 'HANDOFF_CREATED'", [ORG_A]);
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
    ['autorización revocada', { estadoProveedor: 'DISCONNECTED', cuentasAccesibles: null, cuentaEnElSsot: false }, 'OAUTH_CONSENT_REQUIRED'],
    ['nunca conectado', { estadoProveedor: 'NOT_CONNECTED', cuentasAccesibles: null, cuentaEnElSsot: false }, 'OAUTH_CONSENT_REQUIRED'],
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
  const verificador = (resultado: ResultadoVerificacion): VerificadorHandoff => ({
    nombre: 'verificador-de-prueba',
    soporta: (h: Handoff) => h.tipo === 'ACCOUNT_PROVISIONING_REQUIRED',
    verificar: async () => ({
      resultado,
      detalle: `veredicto de prueba: ${resultado}`,
      referenciaProveedor: resultado === 'COMPLETED' ? 'cuenta-nueva' : null,
    }),
  });

  it('cuando la condición se cumple, la tarea se cierra sola y queda auditada', async () => {
    const s = servicio([verificador('COMPLETED')]);
    const h = await s.abrir(ORG_A, intencionAlta);
    const r = await s.verificarPendientes(ORG_A);
    expect(r.completadas).toEqual([h.id]);

    const cerrada = await new RepositorioHandoff(pool).porId(ORG_A, h.id);
    expect(cerrada?.estado).toBe('COMPLETED');
    expect(cerrada?.referenciaProveedor).toBe('cuenta-nueva');
    const { rows } = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action = 'HANDOFF_COMPLETED'", [ORG_A]);
    expect(rows[0].n).toBe(1);
  });

  it('si la condición NO se cumple, la tarea sigue abierta', async () => {
    const s = servicio([verificador('STILL_REQUIRED')]);
    await s.abrir(ORG_A, intencionAlta);
    expect((await s.verificarPendientes(ORG_A)).completadas).toEqual([]);
    expect((await s.vista(ORG_A)).tarea).not.toBeNull();
  });

  /** «No pude preguntar» no es «no está hecho»: no se concluye nada y no se toca la fila. */
  it('si no se pudo comprobar, la tarea se queda como estaba y nada se escribe', async () => {
    const s = servicio([verificador('RETRY_LATER')]);
    const h = await s.abrir(ORG_A, intencionAlta);
    expect((await s.verificarPendientes(ORG_A)).completadas).toEqual([]);

    const igual = await new RepositorioHandoff(pool).porId(ORG_A, h.id);
    expect(igual?.estado).toBe('OPEN');
    const { rows } = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action in ('HANDOFF_COMPLETED','HANDOFF_UPDATED')", [ORG_A]);
    expect(rows[0].n).toBe(0);
  });

  it('si el proveedor no deja avanzar, la tarea lo dice y se audita el cambio', async () => {
    const s = servicio([verificador('BLOCKED_EXTERNAL')]);
    const h = await s.abrir(ORG_A, intencionAlta);
    await s.verificarPendientes(ORG_A);

    expect((await new RepositorioHandoff(pool).porId(ORG_A, h.id))?.estado).toBe('BLOCKED_EXTERNAL');
    const v = await s.vista(ORG_A);
    expect(v.tarea?.bloqueadaFuera).toBe(true); // se sigue pidiendo, pero diciendo que hoy no se puede
    const { rows } = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action = 'HANDOFF_UPDATED'", [ORG_A]);
    expect(rows[0].n).toBe(1);

    // Y no se vuelve a auditar lo mismo en cada pasada.
    await s.verificarPendientes(ORG_A);
    const otra = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action = 'HANDOFF_UPDATED'", [ORG_A]);
    expect(otra.rows[0].n).toBe(1);
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
    const s = servicio([verificador('COMPLETED')]);
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

  /** El orden que pidió el producto, de punta a punta. Elegir cuenta va al final: es lo único de la lista
   *  que se hace dentro de SOEC, y no tiene sentido antes de que exista la cuenta y haya con qué pagarla. */
  it('el orden completo es el de la dependencia real', () => {
    const orden = ([
      'LOGIN_REQUIRED', 'IDENTITY_VERIFICATION_REQUIRED', 'TWO_FACTOR_REQUIRED', 'OAUTH_CONSENT_REQUIRED',
      'ACCOUNT_PROVISIONING_REQUIRED', 'TERMS_ACCEPTANCE_REQUIRED', 'PAYMENT_SETUP_REQUIRED', 'ACCOUNT_SELECTION_REQUIRED',
    ] as const).map(prioridadDe);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
    expect(new Set(orden).size).toBe(orden.length); // sin empates: la elección es determinista
  });
});

describe('la entidad guarda quién lo exige y cuándo dejó de hacer falta', () => {
  it('el proveedor se deriva del canal y se persiste; cancelar deja su fecha', async () => {
    const s = servicio();
    const h = await s.abrir(ORG_A, intencionAlta);
    expect(h.proveedor).toBe('GOOGLE');
    expect(proveedorDeCanal('GOOGLE_ADS')).toBe('GOOGLE');

    const { rows } = await pool.query('select proveedor, cancelado_en from external_handoff where id = $1', [h.id]);
    expect(rows[0].proveedor).toBe('GOOGLE');
    expect(rows[0].cancelado_en).toBeNull();

    // La cuenta queda elegida ⇒ la tarea deja de hacer falta: se cancela, con fecha y con auditoría.
    await s.sincronizarGoogle(ORG_A, { estadoProveedor: 'CONNECTED', cuentasAccesibles: 1, cuentaEnElSsot: true });
    const cerrada = await new RepositorioHandoff(pool).porId(ORG_A, h.id);
    expect(cerrada?.estado).toBe('CANCELLED');
    expect(cerrada?.canceladoEn).not.toBeNull();
    const audit = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action = 'HANDOFF_CANCELLED'", [ORG_A]);
    expect(audit.rows[0].n).toBe(1);
  });

  it('salir al proveedor y vencer quedan en el historial con su nombre', async () => {
    const s = servicio();
    const h = await s.abrir(ORG_A, intencionAlta);
    await s.marcarEsperandoFuera(ORG_A, h.id);
    const caducada = await s.abrir(ORG_A, { ...intencionAlta, causa: 'otra-cosa', urlProveedor: null }, { expiraEn: '2026-09-22T00:00:00.000Z' });
    await s.vista(ORG_A); // al mirar, lo caducado vence

    expect((await new RepositorioHandoff(pool).porId(ORG_A, caducada.id))?.estado).toBe('EXPIRED');
    const { rows } = await pool.query('select action, count(*)::int as n from business_audit where organization_id = $1 group by 1', [ORG_A]);
    const porAccion = Object.fromEntries(rows.map((r: { action: string; n: number }) => [r.action, r.n]));
    expect(porAccion.HANDOFF_UPDATED).toBe(1); // salió al proveedor
    expect(porAccion.HANDOFF_EXPIRED).toBe(1); // y la otra venció
    expect(JSON.stringify(rows)).not.toMatch(/token|secret|password/i);
  });
});

describe('a dónde se puede mandar a una persona', () => {
  it('ni esquemas raros, ni la red de casa, ni el proveedor equivocado', async () => {
    const prohibidas = [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'file:///etc/passwd',
      'https://localhost/ads',
      'https://127.0.0.1/ads',
      'https://10.0.0.5/ads',
      'https://169.254.169.254/latest/meta-data',
      'https://192.168.1.1/ads',
      // Un anfitrión válido… de OTRO proveedor: para una tarea de Google no sirve.
      'https://business.facebook.com/adsmanager',
    ];
    for (const url of prohibidas) {
      await expect(servicio().abrir(ORG_A, { ...intencionAlta, urlProveedor: url })).rejects.toThrow(HandoffInvalidoError);
    }
    const { rows } = await pool.query('select count(*)::int as n from external_handoff where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(0); // fail-closed: ninguna se escribió

    // Y la lista blanca es por proveedor: lo de Meta vale para Meta.
    expect(urlDeProveedorValida('https://business.facebook.com/adsmanager', 'META')).toContain('facebook.com');
  });
});

describe('los verificadores de Google miran el mundo, no la palabra de nadie', () => {
  const mundo = (e: EstadoGoogleParaHandoff | null): (() => Promise<EstadoGoogleParaHandoff | null>) => async () => e;
  const verificar = async (tipo: Handoff['tipo'], estado: EstadoGoogleParaHandoff | null): Promise<ResultadoVerificacion> => {
    const h = { organizationId: ORG_A, canal: 'GOOGLE_ADS', tipo } as Handoff;
    const v = verificadoresDeGoogle(mundo(estado)).find((x) => x.soporta(h))!;
    return (await v.verificar(h)).resultado;
  };

  it('la autorización se cierra cuando está vigente, y sigue abierta cuando no', async () => {
    expect(await verificar('OAUTH_CONSENT_REQUIRED', { estadoProveedor: 'CONNECTED', cuentasAccesibles: 1, cuentaEnElSsot: true })).toBe('COMPLETED');
    expect(await verificar('OAUTH_CONSENT_REQUIRED', { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: null, cuentaEnElSsot: false })).toBe('COMPLETED');
    expect(await verificar('OAUTH_CONSENT_REQUIRED', { estadoProveedor: 'NEEDS_REAUTH', cuentasAccesibles: null, cuentaEnElSsot: false })).toBe('STILL_REQUIRED');
    expect(await verificar('OAUTH_CONSENT_REQUIRED', { estadoProveedor: null, cuentasAccesibles: null, cuentaEnElSsot: false })).toBe('STILL_REQUIRED');
  });

  it('el alta de cuenta se cierra sólo cuando se pudo contar y hay al menos una', async () => {
    const autorizado = { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentaEnElSsot: false };
    expect(await verificar('ACCOUNT_PROVISIONING_REQUIRED', { ...autorizado, cuentasAccesibles: 2 })).toBe('COMPLETED');
    expect(await verificar('ACCOUNT_PROVISIONING_REQUIRED', { ...autorizado, cuentasAccesibles: 0 })).toBe('STILL_REQUIRED');
    // `null` es «no lo hemos mirado»: ni se cierra ni se insiste.
    expect(await verificar('ACCOUNT_PROVISIONING_REQUIRED', { ...autorizado, cuentasAccesibles: null })).toBe('RETRY_LATER');
  });

  it('la elección de cuenta se cierra cuando está escrita donde el motor la lee', async () => {
    expect(await verificar('ACCOUNT_SELECTION_REQUIRED', { estadoProveedor: 'CONNECTED', cuentasAccesibles: 3, cuentaEnElSsot: true })).toBe('COMPLETED');
    expect(await verificar('ACCOUNT_SELECTION_REQUIRED', { estadoProveedor: 'CONNECTED', cuentasAccesibles: 3, cuentaEnElSsot: false })).toBe('STILL_REQUIRED');
  });

  it('si no se puede preguntar al proveedor, el veredicto es «más tarde», nunca «hecho»', async () => {
    for (const tipo of ['OAUTH_CONSENT_REQUIRED', 'ACCOUNT_PROVISIONING_REQUIRED', 'ACCOUNT_SELECTION_REQUIRED'] as const) {
      expect(await verificar(tipo, null)).toBe('RETRY_LATER');
    }
    // Y un lector que lanza tampoco concluye nada.
    const h = { organizationId: ORG_A, canal: 'GOOGLE_ADS', tipo: 'ACCOUNT_PROVISIONING_REQUIRED' } as Handoff;
    const roto = verificadoresDeGoogle(async () => { throw new Error('el proveedor no respondió'); }).find((x) => x.soporta(h))!;
    expect((await roto.verificar(h)).resultado).toBe('RETRY_LATER');
  });

  it('lo que todavía no sabemos comprobar no se cierra: adaptador pendiente explícito', async () => {
    for (const tipo of ['PAYMENT_SETUP_REQUIRED', 'TERMS_ACCEPTANCE_REQUIRED', 'IDENTITY_VERIFICATION_REQUIRED', 'LOGIN_REQUIRED', 'TWO_FACTOR_REQUIRED'] as const) {
      const h = { organizationId: ORG_A, canal: 'GOOGLE_ADS', tipo } as Handoff;
      const v = VERIFICADORES_PENDIENTES.find((x) => x.soporta(h));
      expect(v, `${tipo} debe tener un adaptador, aunque sea pendiente`).toBeDefined();
      expect((await v!.verificar(h)).resultado).toBe('RETRY_LATER');
    }
  });
});

describe('reanudar: el recorrido sigue solo cuando el mundo cambia', () => {
  /** Un mundo mutable: lo que Google contestaría hoy. */
  const mundoMutable = (inicial: EstadoGoogleParaHandoff): { estado: EstadoGoogleParaHandoff; leer: () => Promise<EstadoGoogleParaHandoff> } => {
    const caja = { estado: inicial, leer: async () => caja.estado };
    return caja;
  };

  const servicioConMundo = (caja: { leer: () => Promise<EstadoGoogleParaHandoff> }, recalculos: string[] = []): HandoffService =>
    new HandoffService(pool, {
      ahora: () => AHORA,
      leerEstadoGoogle: caja.leer,
      verificadores: [...verificadoresDeGoogle(caja.leer), ...VERIFICADORES_PENDIENTES],
      recalcularPreparacion: async (org: string) => { recalculos.push(org); },
    });

  it('completar el alta de cuenta abre la tarea siguiente, y repetirlo no duplica nada', async () => {
    const caja = mundoMutable({ estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 0, cuentaEnElSsot: false });
    const recalculos: string[] = [];
    const s = servicioConMundo(caja, recalculos);

    // Estado de CP: autorizado, sin ninguna cuenta.
    await s.sincronizarGoogle(ORG_A, caja.estado);
    expect((await s.vista(ORG_A)).tarea?.titulo).toContain('Crea tu cuenta de anuncios');

    // La persona crea la cuenta en Google. El mundo cambia; nadie se lo cree por decirlo: se comprueba.
    caja.estado = { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 2, cuentaEnElSsot: false };
    const r = await s.reanudar(ORG_A);
    expect(r.completadas).toHaveLength(1);
    expect(r.preparacionRecalculada).toBe(true);
    expect(recalculos).toEqual([ORG_A]);
    expect(r.siguiente?.titulo).toContain('Elige en qué cuenta');
    expect(r.pendientes).toBe(0); // una cosa a la vez, también después de reanudar

    // Idempotente: otra pasada no cierra nada nuevo, no crea filas y no vuelve a recalcular.
    const otra = await s.reanudar(ORG_A);
    expect(otra.completadas).toEqual([]);
    expect(otra.preparacionRecalculada).toBe(false);
    expect(otra.siguiente?.id).toBe(r.siguiente?.id);
    expect(recalculos).toEqual([ORG_A]);
    const { rows } = await pool.query('select estado, count(*)::int as n from external_handoff where organization_id = $1 group by 1 order by 1', [ORG_A]);
    expect(rows).toEqual([{ estado: 'COMPLETED', n: 1 }, { estado: 'OPEN', n: 1 }]);
    const creadas = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action = 'HANDOFF_CREATED'", [ORG_A]);
    expect(creadas.rows[0].n).toBe(2);
  });

  it('cuando la cuenta queda elegida, no queda nada pendiente por este canal', async () => {
    const caja = mundoMutable({ estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 2, cuentaEnElSsot: false });
    const s = servicioConMundo(caja);
    await s.sincronizarGoogle(ORG_A, caja.estado);
    expect((await s.vista(ORG_A)).tarea).not.toBeNull();

    caja.estado = { estadoProveedor: 'CONNECTED', cuentasAccesibles: 2, cuentaEnElSsot: true };
    const r = await s.reanudar(ORG_A);
    expect(r.completadas).toHaveLength(1);
    expect(r.siguiente).toBeNull();
  });

  it('reanudar no concede ningún permiso, tampoco cuando cierra tareas', async () => {
    const caja = mundoMutable({ estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 0, cuentaEnElSsot: false });
    const s = servicioConMundo(caja);
    await s.sincronizarGoogle(ORG_A, caja.estado);
    caja.estado = { estadoProveedor: 'CONNECTED', cuentasAccesibles: 2, cuentaEnElSsot: true };
    await s.reanudar(ORG_A);

    const caps = (await new RepositorioConexiones(pool).capacidades(ORG_A)).filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(caps).not.toContain('ESCRITURA_ADS');
    expect(caps).not.toContain('AUTONOMIA_ADS');
    expect(await new PgMandatoRepo(pool).actual(ORG_A)).toBeNull();
    const gobierno = await new RepositorioNegocios(pool).gobierno(ORG_A);
    expect(gobierno?.autonomousSpend ?? false).toBe(false);
    expect(gobierno?.campaignExecution ?? false).toBe(false);
    const { rows } = await pool.query('select count(*)::int as n from business_connection where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(0);
  });

  it('reanudar en otra empresa no toca las tareas de la primera', async () => {
    const caja = mundoMutable({ estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 0, cuentaEnElSsot: false });
    const s = servicioConMundo(caja);
    const deA = await s.abrir(ORG_A, intencionAlta);

    caja.estado = { estadoProveedor: 'CONNECTED', cuentasAccesibles: 2, cuentaEnElSsot: true };
    await s.reanudar(ORG_B);
    expect((await new RepositorioHandoff(pool).porId(ORG_A, deA.id))?.estado).toBe('OPEN');
  });
});
