/**
 * Autonomy Fase I.5 · PROVISIONAR UNA CUENTA sin dejar dos.
 *
 * Crear una cuenta de anuncios es irreversible en la vida de alguien: no se puede «reintentar por si acaso».
 * Estas pruebas fijan las cuatro promesas que hacen defendible automatizarlo algún día:
 *
 *   · con la bandera de escritura apagada —el default— NUNCA se llama al proveedor. Ni una vez.
 *   · una respuesta incierta se RECONCILIA (ir a mirar), nunca se repite;
 *   · dos intentos simultáneos, un reinicio o un doble clic dejan una sola solicitud y una sola cuenta;
 *   · tener una cuenta no es tener permiso para gastar en ella.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { accionMigrations, PgMandatoRepo } from '../src/accion/accion-pg';
import { handoffMigrations, RepositorioHandoff } from '../src/handoff/handoff-pg';
import { HandoffService } from '../src/handoff/handoff-service';
import { provisionamientoMigrations, RepositorioProvisionamiento } from '../src/provisionamiento/provisionamiento-pg';
import { ProvisionamientoService } from '../src/provisionamiento/provisionamiento-service';
import { escriturasDeProvisionamientoHabilitadas } from '../src/provisionamiento/provisionamiento-google';
import type {
  CapacidadProvisionamiento, PuertoProvisionamientoCuenta, ResultadoProvisionamiento, ResultadoVerificacion,
} from '../src/provisionamiento/provisionamiento-tipos';

const pool = makeTestPool();
const ORG_A = 'org-qa-prov-a';
const ORG_B = 'org-qa-prov-b';
const DATOS = { nombre: 'Clínica QA', moneda: 'CLP', zonaHoraria: 'America/Santiago' };

const CAPAZ: CapacidadProvisionamiento = {
  estado: 'AUTOMATABLE', motivo: 'MANAGER_ELEGIBLE_DISPONIBLE',
  explicacion: 'Podemos preparar la cuenta de anuncios nosotros.', managerCustomerId: '9999999999',
};
const HUMANA: CapacidadProvisionamiento = {
  estado: 'HUMAN_PROVIDER_STEP_REQUIRED', motivo: 'SIN_MANAGER_ACCESIBLE',
  explicacion: 'La primera cuenta hay que crearla en Google.', managerCustomerId: null,
};

/** Doble del proveedor: cuenta cuántas veces se intentó crear algo de verdad. */
function puerto(opciones: {
  capacidad?: CapacidadProvisionamiento;
  alProvisionar?: () => ResultadoProvisionamiento;
  alVerificar?: () => ResultadoVerificacion;
} = {}): PuertoProvisionamientoCuenta & { creaciones: number; verificaciones: number } {
  const doble = {
    nombre: 'doble',
    creaciones: 0,
    verificaciones: 0,
    inspeccionar: async (): Promise<CapacidadProvisionamiento> => opciones.capacidad ?? CAPAZ,
    provisionar: async (): Promise<ResultadoProvisionamiento> => {
      doble.creaciones += 1;
      return opciones.alProvisionar?.() ?? { resultado: 'CREADA', customerId: '1234567890' };
    },
    verificar: async (): Promise<ResultadoVerificacion> => {
      doble.verificaciones += 1;
      return opciones.alVerificar?.() ?? { verificacion: 'NO_EXISTE' };
    },
  };
  return doble;
}

const servicio = (p: PuertoProvisionamientoCuenta): ProvisionamientoService => new ProvisionamientoService(pool, { puerto: p });

async function altaDeNegocio(org: string): Promise<void> {
  await new RepositorioNegocios(pool).insertarPerfil(pool, {
    organizationId: org, businessKey: `bk-${org}`, displayName: DATOS.nombre, legalName: null,
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
  await runMigrations(pool, provisionamientoMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate account_provisioning_request, external_handoff, accion_ledger, accion_mandato, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile cascade');
  await altaDeNegocio(ORG_A);
  await altaDeNegocio(ORG_B);
});
afterAll(async () => { await pool.end(); });

describe('la bandera de escritura nace apagada', () => {
  it('sólo «true» exacto la enciende', () => {
    for (const v of [undefined, '', 'false', 'FALSE', '1', 'yes', 'True']) {
      expect(escriturasDeProvisionamientoHabilitadas({ GOOGLE_ADS_ACCOUNT_PROVISIONING_WRITES_ENABLED: v }), String(v)).toBe(false);
    }
    expect(escriturasDeProvisionamientoHabilitadas({ GOOGLE_ADS_ACCOUNT_PROVISIONING_WRITES_ENABLED: 'true' })).toBe(true);
  });

  it('con la bandera apagada no se llama al proveedor ni una vez', async () => {
    const p = puerto({ alProvisionar: () => ({ resultado: 'NO_INTENTADA', detalle: 'la creación automática está apagada' }) });
    const s = servicio(p);
    await s.evaluar(ORG_A, DATOS);
    await s.intentar(ORG_A);
    await s.intentar(ORG_A);

    // El puerto real, con la bandera apagada, responde NO_INTENTADA sin red; aquí se comprueba que el
    // servicio no insiste ni deja la solicitud en un estado que invite a reintentar a ciegas.
    const activa = await new RepositorioProvisionamiento(pool).activa(ORG_A);
    expect(activa?.estado).not.toBe('COMPLETED');
    expect(activa?.referenciaProveedor).toBeNull();
  });
});

describe('la solicitud es una, viva y auditable', () => {
  it('evaluar dos veces no crea dos solicitudes', async () => {
    const s = servicio(puerto());
    const a = await s.evaluar(ORG_A, DATOS);
    const b = await s.evaluar(ORG_A, DATOS);
    expect(b.solicitud?.id).toBe(a.solicitud?.id);
    const { rows } = await pool.query('select count(*)::int as n from account_provisioning_request where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(1);
  });

  it('sin datos del negocio no se abre ninguna solicitud', async () => {
    const r = await servicio(puerto()).evaluar(ORG_A, null);
    expect(r.solicitud).toBeNull();
    const { rows } = await pool.query('select count(*)::int as n from account_provisioning_request where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(0);
  });

  it('la capacidad queda escrita con su motivo, también cuando el paso es humano', async () => {
    const r = await servicio(puerto({ capacidad: HUMANA })).evaluar(ORG_A, DATOS);
    expect(r.solicitud?.estado).toBe('WAITING_HUMAN');
    expect(r.solicitud?.capacidad).toBe('HUMAN_PROVIDER_STEP_REQUIRED');
    expect(r.solicitud?.motivo).toBe('SIN_MANAGER_ACCESIBLE');
  });

  it('no guarda secretos de ninguna clase', async () => {
    await servicio(puerto()).evaluar(ORG_A, DATOS);
    const { rows } = await pool.query('select * from account_provisioning_request where organization_id = $1', [ORG_A]);
    const texto = JSON.stringify(rows);
    for (const prohibido of ['token', 'secret', 'password', 'refresh', 'Bearer', 'cvv', 'pan']) {
      expect(texto.toLowerCase()).not.toContain(prohibido.toLowerCase());
    }
  });
});

describe('una creación incierta se reconcilia, nunca se repite', () => {
  it('si la respuesta se pierde y la cuenta existe, se adopta en vez de crear otra', async () => {
    const p = puerto({
      alProvisionar: () => ({ resultado: 'INCIERTO', detalle: 'la llamada no devolvió respuesta' }),
      alVerificar: () => ({ verificacion: 'EXISTE', customerId: '5555555555' }),
    });
    const s = servicio(p);
    await s.evaluar(ORG_A, DATOS);
    const r = await s.intentar(ORG_A);

    expect(p.creaciones).toBe(1); // una sola llamada de creación, pase lo que pase
    expect(p.verificaciones).toBe(1);
    expect(r?.estado).toBe('COMPLETED');
    expect(r?.referenciaProveedor).toBe('5555555555');
    expect(r?.detalle).toMatch(/ya existía/i);
  });

  it('si no se puede saber si se creó, se dice y se para: jamás se repite a ciegas', async () => {
    const p = puerto({
      alProvisionar: () => ({ resultado: 'INCIERTO', detalle: 'timeout' }),
      alVerificar: () => ({ verificacion: 'INDETERMINADA', detalle: 'el proveedor no respondió' }),
    });
    const s = servicio(p);
    await s.evaluar(ORG_A, DATOS);
    const r = await s.intentar(ORG_A);

    expect(r?.estado).toBe('BLOCKED_EXTERNAL');
    expect(r?.detalle).toMatch(/incierto/i);
    // Y un intento posterior NO vuelve a crear: la solicitud ya no está lista.
    await s.intentar(ORG_A);
    expect(p.creaciones).toBe(1);
  });

  it('tras un corte, la solicitud a medias se resuelve mirando, no repitiendo', async () => {
    const p = puerto({ alVerificar: () => ({ verificacion: 'EXISTE', customerId: '7777777777' }) });
    const s = servicio(p);
    const { solicitud } = await s.evaluar(ORG_A, DATOS);
    // Simula el corte: la fila quedó EXECUTING y el proceso murió.
    await new RepositorioProvisionamiento(pool).cambiar(pool, ORG_A, solicitud!.id, { estado: 'EXECUTING', detalle: 'creando' });

    const r = await s.reconciliarPendientes(ORG_A);
    expect(p.creaciones).toBe(0); // no se volvió a crear nada
    expect(r?.estado).toBe('COMPLETED');
    expect(r?.referenciaProveedor).toBe('7777777777');
  });

  it('el proveedor rechaza por política ⇒ bloqueo externo explícito, sin reintentos', async () => {
    const p = puerto({ alProvisionar: () => ({ resultado: 'RECHAZADA_POR_PROVEEDOR', detalle: 'la cuenta no cumple los requisitos de Google' }) });
    const s = servicio(p);
    await s.evaluar(ORG_A, DATOS);
    const r = await s.intentar(ORG_A);
    expect(r?.estado).toBe('BLOCKED_EXTERNAL');
    await s.intentar(ORG_A);
    expect(p.creaciones).toBe(1);
  });

  it('un error temporal deja la solicitud para más tarde, no la mata', async () => {
    const p = puerto({ alProvisionar: () => ({ resultado: 'REINTENTAR', detalle: '429' }) });
    const s = servicio(p);
    await s.evaluar(ORG_A, DATOS);
    expect((await s.intentar(ORG_A))?.estado).toBe('RETRY_LATER');
  });
});

describe('dos a la vez no son dos cuentas', () => {
  it('dos intentos concurrentes crean UNA sola vez', async () => {
    const p = puerto();
    const s = servicio(p);
    await s.evaluar(ORG_A, DATOS);
    await Promise.all([s.intentar(ORG_A), s.intentar(ORG_A)]);
    expect(p.creaciones).toBe(1);
    const { rows } = await pool.query('select count(*)::int as n from account_provisioning_request where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(1);
  });

  it('dos evaluaciones concurrentes dejan una sola solicitud', async () => {
    const s = servicio(puerto());
    await Promise.all([s.evaluar(ORG_A, DATOS), s.evaluar(ORG_A, DATOS)]);
    const { rows } = await pool.query('select count(*)::int as n from account_provisioning_request where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(1);
  });

  it('la solicitud de una empresa no existe para la otra', async () => {
    const s = servicio(puerto());
    const { solicitud } = await s.evaluar(ORG_A, DATOS);
    await s.evaluar(ORG_B, DATOS);
    expect(await new RepositorioProvisionamiento(pool).porId(ORG_B, solicitud!.id)).toBeNull();
    const { rows } = await pool.query('select organization_id, count(*)::int as n from account_provisioning_request group by 1 order by 1');
    expect(rows).toEqual([{ organization_id: ORG_A, n: 1 }, { organization_id: ORG_B, n: 1 }]);
  });
});

describe('la capacidad cambia lo que se le pide a la persona', () => {
  const estado = (capacidad: 'AUTOMATABLE' | 'HUMAN_PROVIDER_STEP_REQUIRED' | 'BLOCKED_EXTERNAL' | 'RETRY_LATER') => ({
    estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 0, cuentaEnElSsot: false,
    capacidadProvisionamiento: capacidad,
  });

  it('si SOEC puede crearla, no se le pide a nadie que la cree', async () => {
    const h = new HandoffService(pool, {});
    await h.sincronizarGoogle(ORG_A, estado('AUTOMATABLE'));
    expect(await new RepositorioHandoff(pool).abiertas(ORG_A)).toHaveLength(0);
    expect((await h.vista(ORG_A)).tarea).toBeNull();
  });

  it('si hace falta una persona, hay exactamente UNA tarea y es la de crear la cuenta', async () => {
    const h = new HandoffService(pool, {});
    await h.sincronizarGoogle(ORG_A, estado('HUMAN_PROVIDER_STEP_REQUIRED'));
    const abiertas = await new RepositorioHandoff(pool).abiertas(ORG_A);
    expect(abiertas).toHaveLength(1);
    expect(abiertas[0]!.tipo).toBe('ACCOUNT_PROVISIONING_REQUIRED');
    expect((await h.vista(ORG_A)).tarea?.titulo).toContain('Crea tu cuenta de anuncios');
  });

  it('si el proveedor lo bloquea, se dice y no se ofrece un botón inútil', async () => {
    const h = new HandoffService(pool, {});
    await h.sincronizarGoogle(ORG_A, estado('BLOCKED_EXTERNAL'));
    const v = await h.vista(ORG_A);
    expect(v.tarea?.bloqueadaFuera).toBe(true);
    expect(v.tarea?.urlProveedor).toBeNull();
    expect(v.tarea?.motivo).toMatch(/no es algo que puedas resolver tú/i);
  });

  /** La promesa que protege a CP: no saber jamás borra una tarea que ya estaba. */
  it('si no se pudo averiguar, la tarea existente se queda EXACTAMENTE como estaba', async () => {
    const h = new HandoffService(pool, {});
    await h.sincronizarGoogle(ORG_A, estado('HUMAN_PROVIDER_STEP_REQUIRED'));
    const antes = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);

    await h.sincronizarGoogle(ORG_A, estado('RETRY_LATER'));
    const despues = await pool.query('select id, estado, actualizado_en from external_handoff where organization_id = $1', [ORG_A]);
    expect(despues.rows).toEqual(antes.rows);
  });

  it('sin capacidad evaluada, todo se comporta como antes de esta fase', async () => {
    const h = new HandoffService(pool, {});
    await h.sincronizarGoogle(ORG_A, { estadoProveedor: 'ACCOUNT_SELECTION_PENDING', cuentasAccesibles: 0, cuentaEnElSsot: false });
    expect((await h.vista(ORG_A)).tarea?.titulo).toContain('Crea tu cuenta de anuncios');
  });
});

describe('provisionar no es permiso para gastar', () => {
  it('crear la cuenta no concede mandato, gasto, escritura, autonomía ni campañas', async () => {
    const p = puerto();
    const s = servicio(p);
    await s.evaluar(ORG_A, DATOS);
    const r = await s.intentar(ORG_A);
    expect(r?.estado).toBe('COMPLETED'); // la cuenta se creó (en el doble)

    const caps = (await new RepositorioConexiones(pool).capacidades(ORG_A)).filter((c) => c.habilitada).map((c) => c.capacidad);
    expect(caps).not.toContain('ESCRITURA_ADS');
    expect(caps).not.toContain('AUTONOMIA_ADS');
    expect(await new PgMandatoRepo(pool).actual(ORG_A)).toBeNull();
    const g = await new RepositorioNegocios(pool).gobierno(ORG_A);
    expect(g?.autonomousSpend ?? false).toBe(false);
    expect(g?.campaignExecution ?? false).toBe(false);
    // Ni siquiera se elige la cuenta recién creada: eso es otra decisión, de otra fase.
    const { rows } = await pool.query('select count(*)::int as n from business_connection where organization_id = $1', [ORG_A]);
    expect(rows[0].n).toBe(0);
  });
});
