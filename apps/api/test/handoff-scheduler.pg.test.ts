/**
 * Autonomy Fase I.4 · REANUDACIÓN AUTÓNOMA: SOEC se entera solo de que ya hiciste lo tuyo.
 *
 * Lo que estas pruebas fijan no es «existe un setInterval», sino las cuatro promesas que lo hacen defendible:
 *
 *   · un negocio que necesita algo humano recibe SU tarea sin que nadie abra una pantalla;
 *   · un tick que no cambia nada NO cambia nada: ni updatedAt, ni auditoría, ni una segunda fila;
 *   · «no pude preguntar» jamás se convierte en una decisión de negocio — un 429 de Google no cierra ni abre
 *     nada, y desde luego no revoca una conexión;
 *   · reanudar solo no concede permisos: ni mandato, ni gasto, ni escritura, ni campañas.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { accionMigrations, PgMandatoRepo } from '../src/accion/accion-pg';
import { googleAdsOAuthMigrations } from '../src/acquisition/google-ads-oauth-pg';
import { handoffMigrations, RepositorioHandoff } from '../src/handoff/handoff-pg';
import { HandoffService } from '../src/handoff/handoff-service';
import { verificadoresDeGoogle, VERIFICADORES_PENDIENTES } from '../src/handoff/handoff-verificadores';
import { correrTickDeHandoffs, ExternalHandoffScheduler, organizacionesConCanalIniciado, INTERVALO_POR_DEFECTO_MS } from '../src/handoff/handoff-scheduler';
import type { EstadoGoogleParaHandoff } from '../src/handoff/handoff-google';

const pool = makeTestPool();
const ORG_A = 'org-qa-sched-a';
const ORG_B = 'org-qa-sched-b';
/** Una empresa que existe pero JAMÁS tocó Google: no debe recibir ninguna tarea de ese canal. */
const ORG_SIN_GOOGLE = 'org-qa-sched-sin-google';

const SIN_CUENTAS: EstadoGoogleParaHandoff = { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 0, cuentaEnElSsot: false };
const CON_CUENTAS: EstadoGoogleParaHandoff = { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 2, cuentaEnElSsot: false };
const YA_ELEGIDA: EstadoGoogleParaHandoff = { estadoProveedor: 'CONNECTED', cuentasAccesibles: 2, cuentaEnElSsot: true };

/** El mundo exterior, mutable y con posibilidad de estar caído. */
function mundo(inicial: EstadoGoogleParaHandoff | Error) {
  const caja = {
    estado: inicial as EstadoGoogleParaHandoff | Error,
    consultas: 0,
    leer: async (): Promise<EstadoGoogleParaHandoff | null> => {
      caja.consultas += 1;
      if (caja.estado instanceof Error) throw caja.estado;
      return caja.estado;
    },
  };
  return caja;
}

function servicioCon(caja: { leer: () => Promise<EstadoGoogleParaHandoff | null> }, extra: Record<string, unknown> = {}): HandoffService {
  const leer = async (): Promise<EstadoGoogleParaHandoff | null> => caja.leer();
  return new HandoffService(pool, {
    leerEstadoGoogle: leer,
    verificadores: [...verificadoresDeGoogle(leer), ...VERIFICADORES_PENDIENTES],
    ...extra,
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

/** Da de alta el ciclo de autorización del canal: es lo que hace elegible a una empresa. */
async function conCanalIniciado(org: string): Promise<void> {
  await pool.query(
    `insert into google_ads_connection (organization_id, connection_id, estado, salud, needs_reauth, created_at, updated_at)
     values ($1, $2, 'ACCOUNT_SELECTION_PENDING', 'UNKNOWN', false, now(), now())
     on conflict do nothing`,
    [org, `gads-${org}`],
  );
}

const filas = async (org: string): Promise<number> =>
  (await pool.query('select count(*)::int as n from external_handoff where organization_id = $1', [org])).rows[0].n as number;
const auditoria = async (org: string, accion?: string): Promise<number> => (await pool.query(
  accion === undefined
    ? 'select count(*)::int as n from business_audit where organization_id = $1'
    : 'select count(*)::int as n from business_audit where organization_id = $1 and action = $2',
  accion === undefined ? [org] : [org, accion],
)).rows[0].n as number;

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await runMigrations(pool, accionMigrations);
  await runMigrations(pool, googleAdsOAuthMigrations);
  await runMigrations(pool, handoffMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate external_handoff, google_ads_connection, accion_ledger, accion_mandato, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile cascade');
  for (const o of [ORG_A, ORG_B, ORG_SIN_GOOGLE]) await altaDeNegocio(o);
  await conCanalIniciado(ORG_A);
  await conCanalIniciado(ORG_B);
});
afterAll(async () => { await pool.end(); });

describe('quién entra en el tick', () => {
  it('sólo las empresas que ya empezaron el canal, o que ya tienen una tarea', async () => {
    const elegibles = await organizacionesConCanalIniciado(pool)();
    expect([...elegibles].sort()).toEqual([ORG_A, ORG_B]);
    expect(elegibles).not.toContain(ORG_SIN_GOOGLE);
  });

  it('una empresa que nunca tocó Google no recibe ninguna tarea de Google', async () => {
    const caja = mundo(SIN_CUENTAS);
    const r = await correrTickDeHandoffs({ reanudador: servicioCon(caja), elegibles: organizacionesConCanalIniciado(pool) });

    expect(r.organizaciones).toBe(2);
    expect(await filas(ORG_SIN_GOOGLE)).toBe(0);
    expect(await auditoria(ORG_SIN_GOOGLE)).toBe(0);
  });
});

describe('la primera tarea nace sola', () => {
  it('sin ninguna tarea previa, un tick crea exactamente la que corresponde', async () => {
    const caja = mundo(SIN_CUENTAS);
    expect(await filas(ORG_A)).toBe(0);

    const r = await correrTickDeHandoffs({ reanudador: servicioCon(caja), elegibles: organizacionesConCanalIniciado(pool) });
    expect(r.creados).toBe(2); // una por empresa elegible
    expect(await filas(ORG_A)).toBe(1);

    const abiertas = await new RepositorioHandoff(pool).abiertas(ORG_A);
    expect(abiertas[0]!.tipo).toBe('ACCOUNT_PROVISIONING_REQUIRED');
    expect(abiertas[0]!.estado).toBe('OPEN');
    // Nadie abrió una pantalla: la tarea existe porque el servidor miró el mundo.
    expect(await auditoria(ORG_A, 'HANDOFF_CREATED')).toBe(1);
  });

  it('repetir el tick no duplica nada: ni fila, ni auditoría, ni marca de actualización', async () => {
    const caja = mundo(SIN_CUENTAS);
    const s = servicioCon(caja);
    const elegibles = organizacionesConCanalIniciado(pool);
    await correrTickDeHandoffs({ reanudador: s, elegibles });

    const antes = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);
    for (let i = 0; i < 3; i += 1) await correrTickDeHandoffs({ reanudador: s, elegibles });
    const despues = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);

    expect(despues.rows).toEqual(antes.rows); // NOOP de verdad: ni siquiera cambia `actualizado_en`
    expect(await filas(ORG_A)).toBe(1);
    expect(await auditoria(ORG_A, 'HANDOFF_CREATED')).toBe(1);
    expect(await auditoria(ORG_A, 'HANDOFF_COMPLETED')).toBe(0);
  });
});

describe('cuando el mundo cambia, SOEC lo nota sin que nadie pulse nada', () => {
  it('aparece una cuenta ⇒ se cierra el alta y se abre la elección, en el mismo tick', async () => {
    const caja = mundo(SIN_CUENTAS);
    const s = servicioCon(caja);
    const elegibles = organizacionesConCanalIniciado(pool);
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    const alta = (await new RepositorioHandoff(pool).abiertas(ORG_A))[0]!;

    // La persona crea su cuenta en Google. No avisa a nadie.
    caja.estado = CON_CUENTAS;
    const r = await correrTickDeHandoffs({ reanudador: s, elegibles });

    expect(r.completados).toBe(2);
    expect(r.creados).toBe(2);
    const repo = new RepositorioHandoff(pool);
    expect((await repo.porId(ORG_A, alta.id))?.estado).toBe('COMPLETED');
    const ahora = await repo.abiertas(ORG_A);
    expect(ahora).toHaveLength(1);
    expect(ahora[0]!.tipo).toBe('ACCOUNT_SELECTION_REQUIRED');
    expect(ahora[0]!.estado).toBe('OPEN');
  });

  it('con la cuenta ya elegida no queda nada pendiente, y no se inventa un paso más', async () => {
    const caja = mundo(CON_CUENTAS);
    const s = servicioCon(caja);
    const elegibles = organizacionesConCanalIniciado(pool);
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    expect((await new RepositorioHandoff(pool).abiertas(ORG_A))[0]!.tipo).toBe('ACCOUNT_SELECTION_REQUIRED');

    // I.4 no elige cuenta por su cuenta aunque pudiera: esa decisión se evalúa aparte.
    caja.estado = YA_ELEGIDA;
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    expect(await new RepositorioHandoff(pool).abiertas(ORG_A)).toHaveLength(0);
    const conexiones = await pool.query('select count(*)::int as n from business_connection where organization_id = $1', [ORG_A]);
    expect(conexiones.rows[0].n).toBe(0); // no se eligió ninguna cuenta en nombre de nadie
  });
});

describe('un proveedor caído no es una decisión de negocio', () => {
  it('timeout/429/5xx ⇒ RETRY_LATER: nada se cierra, nada se abre, nada se toca', async () => {
    const caja = mundo(SIN_CUENTAS);
    const s = servicioCon(caja);
    const elegibles = organizacionesConCanalIniciado(pool);
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    const antes = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);
    const auditAntes = await auditoria(ORG_A);

    caja.estado = new Error('429 Too Many Requests');
    const r = await correrTickDeHandoffs({ reanudador: s, elegibles });

    expect(r.completados).toBe(0);
    expect(r.creados).toBe(0);
    expect(r.retryLater).toBeGreaterThan(0);
    expect(r.errores).toBe(0); // un proveedor caído no es un fallo del tick: es una respuesta
    const despues = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);
    expect(despues.rows).toEqual(antes.rows);
    expect(await auditoria(ORG_A)).toBe(auditAntes);
  });

  it('sin poder preguntar, tampoco se crea la primera tarea: no se adivina qué falta', async () => {
    const caja = mundo(new Error('ETIMEDOUT'));
    await correrTickDeHandoffs({ reanudador: servicioCon(caja), elegibles: organizacionesConCanalIniciado(pool) });
    expect(await filas(ORG_A)).toBe(0);
    expect(await auditoria(ORG_A)).toBe(0);
  });
});

describe('dos a la vez no son dos veces', () => {
  it('dos ticks concurrentes dejan una sola tarea y una sola línea de historia', async () => {
    const caja = mundo(SIN_CUENTAS);
    const s = servicioCon(caja);
    const elegibles = organizacionesConCanalIniciado(pool);
    const [a, b] = await Promise.all([
      correrTickDeHandoffs({ reanudador: s, elegibles }),
      correrTickDeHandoffs({ reanudador: s, elegibles }),
    ]);

    expect(await filas(ORG_A)).toBe(1);
    expect(await auditoria(ORG_A, 'HANDOFF_CREATED')).toBe(1);
    // Uno de los dos cedió el turno en vez de repetir el trabajo.
    expect(a.omitidas + b.omitidas).toBeGreaterThan(0);
  });

  it('un tick y un «ya lo hice» simultáneos tampoco se pisan', async () => {
    const caja = mundo(SIN_CUENTAS);
    const s = servicioCon(caja);
    await Promise.all([
      correrTickDeHandoffs({ reanudador: s, elegibles: organizacionesConCanalIniciado(pool) }),
      s.reanudar(ORG_A, 'persona'),
    ]);
    expect(await filas(ORG_A)).toBe(1);
    expect(await auditoria(ORG_A, 'HANDOFF_CREATED')).toBe(1);
  });

  it('tras un reinicio, el scheduler retoma la tarea existente en vez de crear otra', async () => {
    const caja = mundo(SIN_CUENTAS);
    await correrTickDeHandoffs({ reanudador: servicioCon(caja), elegibles: organizacionesConCanalIniciado(pool) });
    const original = (await new RepositorioHandoff(pool).abiertas(ORG_A))[0]!;

    // «Reinicio»: servicio y scheduler nuevos, misma base.
    const otro = servicioCon(mundo(SIN_CUENTAS));
    await correrTickDeHandoffs({ reanudador: otro, elegibles: organizacionesConCanalIniciado(pool) });

    const abiertas = await new RepositorioHandoff(pool).abiertas(ORG_A);
    expect(abiertas).toHaveLength(1);
    expect(abiertas[0]!.id).toBe(original.id);
  });

  it('el tick de una empresa no toca a la otra', async () => {
    const caja = mundo(SIN_CUENTAS);
    const s = servicioCon(caja);
    await correrTickDeHandoffs({ reanudador: s, elegibles: organizacionesConCanalIniciado(pool) });
    const deB = (await new RepositorioHandoff(pool).abiertas(ORG_B))[0]!;

    caja.estado = YA_ELEGIDA;
    await s.reanudar(ORG_A); // sólo A
    expect((await new RepositorioHandoff(pool).porId(ORG_B, deB.id))?.estado).toBe('OPEN');
    expect(await new RepositorioHandoff(pool).porId(ORG_A, deB.id)).toBeNull();
  });
});

describe('reanudar solo no concede nada', () => {
  it('ni mandato, ni gasto, ni escritura, ni autonomía, ni campañas', async () => {
    const caja = mundo(SIN_CUENTAS);
    const s = servicioCon(caja);
    const elegibles = organizacionesConCanalIniciado(pool);
    await correrTickDeHandoffs({ reanudador: s, elegibles });
    caja.estado = YA_ELEGIDA;
    await correrTickDeHandoffs({ reanudador: s, elegibles });

    const caps = (await new RepositorioConexiones(pool).capacidades(ORG_A)).filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(caps).not.toContain('ESCRITURA_ADS');
    expect(caps).not.toContain('AUTONOMIA_ADS');
    expect(await new PgMandatoRepo(pool).actual(ORG_A)).toBeNull();
    const g = await new RepositorioNegocios(pool).gobierno(ORG_A);
    expect(g?.autonomousSpend ?? false).toBe(false);
    expect(g?.campaignExecution ?? false).toBe(false);
    const campañas = await pool.query('select count(*)::int as n from business_connection where organization_id = $1', [ORG_A]);
    expect(campañas.rows[0].n).toBe(0);
  });
});

describe('la cadena tiene tope y el scheduler se puede apagar', () => {
  it('una reanudación no da vueltas sin fin: como mucho los pasos declarados', async () => {
    const caja = mundo(SIN_CUENTAS);
    const s = servicioCon(caja);
    const r = await s.reanudar(ORG_A, 'scheduler', { maxPasos: 2 });
    expect(r.pasos).toBeLessThanOrEqual(2);
  });

  it('apagarlo explícitamente lo deja dormido; su cadencia por defecto son 5 minutos', () => {
    const caja = mundo(SIN_CUENTAS);
    const dormido = new ExternalHandoffScheduler({ reanudador: servicioCon(caja), elegibles: async () => [], habilitado: false });
    expect(dormido.iniciar().agendado).toBe(false);
    expect(INTERVALO_POR_DEFECTO_MS).toBe(5 * 60 * 1000);

    const vivo = new ExternalHandoffScheduler({ reanudador: servicioCon(caja), elegibles: async () => [], retrasoInicialMs: 60_000 });
    const r = vivo.iniciar();
    expect(r.agendado).toBe(true);
    expect(r.intervaloMs).toBe(INTERVALO_POR_DEFECTO_MS);
    vivo.detener();
  });

  it('los registros del tick no llevan secretos, sólo cuentas', async () => {
    const eventos: Record<string, unknown>[] = [];
    const caja = mundo(SIN_CUENTAS);
    await correrTickDeHandoffs({
      reanudador: servicioCon(caja), elegibles: organizacionesConCanalIniciado(pool),
      log: (e) => eventos.push(e),
    });
    const texto = JSON.stringify(eventos);
    for (const prohibido of ['token', 'secret', 'password', 'refresh', 'Bearer', 'developer']) {
      expect(texto.toLowerCase(), `«${prohibido}» no puede aparecer en un log`).not.toContain(prohibido.toLowerCase());
    }
    expect(eventos.some((e) => typeof e.creados === 'number')).toBe(true);
  });
});
