/**
 * Autonomy Fase 0 · INGESTA SERVER-SIDE MULTIEMPRESA.
 *
 * Lo que se prueba aquí es exactamente lo que falló en producción: la ingesta dependía de una tarea externa
 * y de una variable global de una sola organización. Ahora el runtime descubre las organizaciones ingeribles
 * del registro, corre cada una con sus cursores y un fallo no arrastra a las demás.
 */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { correrIngestaDeTodas, planDeIngesta } from '../src/ingesta/ingesta-runtime';
import { derivarEstado, type RegistroJob } from '../src/operacion/job-health-pg';
import { SchedulerIngesta } from '../src/ingesta/scheduler';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';

/** Entorno con las credenciales de CP y de SmileFlow, como las declara cada negocio en el registro. */
const ENV_COMPLETO = {
  CP_ODONTOLOGIA_GROWTH_TOKEN: 'token-cp',
  CP_ODONTOLOGIA_M2M_URL: 'https://www.dentistaclaudiapacheco.cl',
  SMILEFLOW_GROWTH_TOKEN: 'token-sf',
} as unknown as NodeJS.ProcessEnv;

describe('descubrimiento de organizaciones (sin ninguna fijada en código)', () => {
  it('con credenciales de ambas, el plan incluye a SmileFlow y a CP, cada una con su fuente', () => {
    const plan = planDeIngesta(new InMemoryEventStore(), ENV_COMPLETO);
    const orgs = plan.map((p) => p.org);
    expect(orgs).toContain('org-smileflow');
    expect(orgs).toContain('org-cp-odontologia');
    const cp = plan.find((p) => p.org === 'org-cp-odontologia')!;
    expect(cp.fuentes).toContain('src-cp-odontologia-growth');
    // Google Ads NO se ingiere aquí: tiene su propio scheduler. Se declara el motivo, no se omite en silencio.
    const sf = plan.find((p) => p.org === 'org-smileflow')!;
    expect(sf.fuentes.every((f) => !f.includes('google-ads'))).toBe(true);
    expect(sf.omitidas.join(' ')).toMatch(/google-ads: lo ingiere su propio scheduler/);
  });

  it('sin credenciales, una organización simplemente no entra en la corrida (no es un fallo)', () => {
    const plan = planDeIngesta(new InMemoryEventStore(), {} as NodeJS.ProcessEnv);
    expect(plan.find((p) => p.org === 'org-cp-odontologia')).toBeUndefined();
  });

  it('ninguna organización queda fijada: el plan sale del registro, no de SOEC_INGESTA_ORG', () => {
    const conVariable = planDeIngesta(new InMemoryEventStore(), { ...ENV_COMPLETO, SOEC_INGESTA_ORG: 'org-smileflow' } as NodeJS.ProcessEnv);
    const sinVariable = planDeIngesta(new InMemoryEventStore(), ENV_COMPLETO);
    expect(conVariable.map((p) => p.org)).toEqual(sinVariable.map((p) => p.org));
    expect(sinVariable.length).toBeGreaterThan(1);
  });
});

describe('aislamiento entre organizaciones', () => {
  it('una organización que falla no impide que las demás corran', async () => {
    const store = new InMemoryEventStore();
    const resultados = await correrIngestaDeTodas({ store, env: ENV_COMPLETO }, 15 * 60_000);
    // Sin red real, cada fuente falla; lo que importa es que TODAS las organizaciones se intentaron.
    expect(resultados.length).toBeGreaterThan(1);
    expect(resultados.map((r) => r.org)).toContain('org-cp-odontologia');
    expect(resultados.map((r) => r.org)).toContain('org-smileflow');
  });

  it('registra la salud por organización: inicio y resultado de cada una', async () => {
    const llamadas: Array<{ metodo: string; org: string }> = [];
    const salud = {
      marcarInicio: async (_j: never, org: string) => { llamadas.push({ metodo: 'inicio', org }); },
      marcarExito: async (_j: never, org: string) => { llamadas.push({ metodo: 'exito', org }); },
      marcarFallo: async (_j: never, org: string) => { llamadas.push({ metodo: 'fallo', org }); },
      marcarDeshabilitado: async () => undefined,
      listar: async () => [],
    } as never;
    await correrIngestaDeTodas({ store: new InMemoryEventStore(), env: ENV_COMPLETO, salud }, 15 * 60_000);
    const orgs = new Set(llamadas.map((l) => l.org));
    expect(orgs.has('org-smileflow')).toBe(true);
    expect(orgs.has('org-cp-odontologia')).toBe(true);
    expect(llamadas.filter((l) => l.metodo === 'inicio').length).toBe(orgs.size);
  });
});

describe('cursores e idempotencia (el reinicio no duplica)', () => {
  const ctx = (org: string): RequestContext => {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:read', 'events:append'] }, correlationId: 't' };
  };

  it('el estado de sincronización se guarda por organización y proveedor, sin mezclarse', async () => {
    const store = new InMemoryEventStore();
    const correr = vi.fn(async () => ({ estado: 'OK' }));
    const fuente = { provider: 'growth-x', ingesta: { correrUnaVez: correr } };
    const a = new SchedulerIngesta({ store, org: 'org-a', fuentes: [fuente] });
    const b = new SchedulerIngesta({ store, org: 'org-b', fuentes: [fuente] });
    await a.correrTodo(ctx('org-a'), { ahora: '2026-09-21T10:00:00.000Z' });
    await b.correrTodo(ctx('org-b'), { ahora: '2026-09-21T10:05:00.000Z' });

    const estadoA = await a.ultimaSync(ctx('org-a'), 'growth-x');
    const estadoB = await b.ultimaSync(ctx('org-b'), 'growth-x');
    expect(estadoA?.at).toBe('2026-09-21T10:00:00.000Z');
    expect(estadoB?.at).toBe('2026-09-21T10:05:00.000Z'); // cada organización lleva el suyo
    // El stream de una organización no contiene eventos de la otra.
    const eventosA = await store.readStream(ctx('org-a'), 'ingesta-estado:growth-x:org-a');
    expect(eventosA).toHaveLength(1);
  });

  it('dos corridas seguidas de la misma organización no crean un segundo estado por corrida', async () => {
    const store = new InMemoryEventStore();
    const s = new SchedulerIngesta({ store, org: 'org-a', fuentes: [{ provider: 'growth-x', ingesta: { correrUnaVez: async () => ({ estado: 'OK' }) } }] });
    await s.correrTodo(ctx('org-a'), { ahora: '2026-09-21T10:00:00.000Z' });
    await s.correrTodo(ctx('org-a'), { ahora: '2026-09-21T10:15:00.000Z' });
    const eventos = await store.readStream(ctx('org-a'), 'ingesta-estado:growth-x:org-a');
    expect(eventos).toHaveLength(2); // un latido por corrida
    expect((eventos[1]!.payload as { at: string }).at).toBe('2026-09-21T10:15:00.000Z');
  });
});

describe('salud de jobs · estado derivado', () => {
  const base: RegistroJob = { job: 'ingestion', organizationId: 'org-x', lastStartedAt: null, lastSucceededAt: null, lastFailedAt: null, lastError: null, nextRunAt: null, enabled: true };
  const AHORA = '2026-09-21T12:00:00.000Z';

  it('sin datos, deshabilitado, fallando, atrasado y operativo se distinguen', () => {
    expect(derivarEstado(base, AHORA)).toBe('SIN_DATOS');
    expect(derivarEstado({ ...base, enabled: false }, AHORA)).toBe('DESHABILITADO');
    expect(derivarEstado({ ...base, lastSucceededAt: '2026-09-21T11:00:00.000Z', lastFailedAt: '2026-09-21T11:30:00.000Z' }, AHORA)).toBe('FALLANDO');
    expect(derivarEstado({ ...base, lastSucceededAt: '2026-09-21T11:00:00.000Z', nextRunAt: '2026-09-21T11:15:00.000Z' }, AHORA)).toBe('ATRASADO');
    expect(derivarEstado({ ...base, lastSucceededAt: '2026-09-21T11:55:00.000Z', nextRunAt: '2026-09-21T12:10:00.000Z' }, AHORA)).toBe('OPERATIVO');
  });

  it('un fallo anterior al último éxito ya no se reporta como avería', () => {
    expect(derivarEstado({ ...base, lastFailedAt: '2026-09-21T10:00:00.000Z', lastSucceededAt: '2026-09-21T11:58:00.000Z', nextRunAt: '2026-09-21T12:13:00.000Z' }, AHORA)).toBe('OPERATIVO');
  });
});
