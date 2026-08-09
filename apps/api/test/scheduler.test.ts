import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { SchedulerIngesta, type FuenteCorrible } from '../src/ingesta/scheduler';

const ORG = 'org-smileflow';
const AHORA = '2026-08-08T12:00:00.000Z';

function ctx(): RequestContext {
  const o = OrganizationId(ORG);
  return { organizationId: o, actor: ActorId('sched'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}

const fuenteOk: FuenteCorrible = { correrUnaVez: async () => ({ nuevos: 3 }) };
const fuenteFalla: FuenteCorrible = { correrUnaVez: async () => { throw new Error('boom en la fuente'); } };

describe('SchedulerIngesta', () => {
  it('una fuente que falla NO propaga el throw: la otra sigue OK y ambos estados quedan registrados', async () => {
    const store = new InMemoryEventStore();
    const scheduler = new SchedulerIngesta({
      store, org: ORG,
      fuentes: [
        { provider: 'smileflow-growth', ingesta: fuenteOk },
        { provider: 'google-ads', ingesta: fuenteFalla },
      ],
    });

    const r = await scheduler.correrTodo(ctx(), { ahora: AHORA });

    const growth = r.fuentes.find((f) => f.provider === 'smileflow-growth')!;
    const ads = r.fuentes.find((f) => f.provider === 'google-ads')!;
    expect(growth.ok).toBe(true);
    expect(growth.resumen).toEqual({ nuevos: 3 });
    expect(ads.ok).toBe(false);
    expect(ads.error).toContain('boom');

    // ultimaSync devuelve el último estado por proveedor
    const sg = await scheduler.ultimaSync(ctx(), 'smileflow-growth');
    const sa = await scheduler.ultimaSync(ctx(), 'google-ads');
    expect(sg?.ok).toBe(true);
    expect(sg?.at).toBe(AHORA);
    expect(sa?.ok).toBe(false);
    expect(sa?.error).toContain('boom');
  });

  it('ultimaSync devuelve null si la fuente nunca corrió', async () => {
    const store = new InMemoryEventStore();
    const scheduler = new SchedulerIngesta({ store, org: ORG, fuentes: [] });
    expect(await scheduler.ultimaSync(ctx(), 'google-ads')).toBeNull();
  });

  it('registra el estado más reciente cuando una fuente pasa de fallar a OK', async () => {
    const store = new InMemoryEventStore();
    let intentos = 0;
    const inestable: FuenteCorrible = {
      correrUnaVez: async () => {
        intentos += 1;
        if (intentos === 1) throw new Error('primer intento falla');
        return { nuevos: 1 };
      },
    };
    const scheduler = new SchedulerIngesta({ store, org: ORG, fuentes: [{ provider: 'google-ads', ingesta: inestable }] });

    await scheduler.correrTodo(ctx(), { ahora: AHORA });
    expect((await scheduler.ultimaSync(ctx(), 'google-ads'))?.ok).toBe(false);

    await scheduler.correrTodo(ctx(), { ahora: '2026-08-08T13:00:00.000Z' });
    const ultimo = await scheduler.ultimaSync(ctx(), 'google-ads');
    expect(ultimo?.ok).toBe(true);
    expect(ultimo?.resumen).toEqual({ nuevos: 1 });
  });
});
