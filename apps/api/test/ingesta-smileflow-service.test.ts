import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, SalidaAdaptador, SolicitudAdaptador } from '@soec/adaptadores';
import { ObservacionService } from '@soec/motor-medicion';
import { IngestaSmileFlowGrowth } from '../src/ingesta/ingesta-smileflow-service';
import { observacionIdDe } from '../src/ingesta/mapa-growth';

const ORG = 'org-smileflow';
const AHORA = '2026-08-08T12:00:00.000Z';

function ctx(): RequestContext {
  const o = OrganizationId(ORG);
  return { organizationId: o, actor: ActorId('ingesta'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}

const EVENTOS = [
  { event_id: 10, event_name: 'demo_cta_clicked', occurred_at: '2026-08-08T09:00:00.000Z', anon_id: 'a1', path: '/', utm_source: 'google', utm_campaign: 'c1', value: null, lead_id: null },
  { event_id: 11, event_name: 'lead_created', occurred_at: '2026-08-08T09:05:00.000Z', anon_id: 'a2', path: '/g', utm_source: 'google', utm_campaign: 'c1', value: null, lead_id: 55 },
];

/** Adaptador FAKE que devuelve un body JSON fijo (2 eventos) según el cursor pedido. */
class AdaptadorFake implements AdaptadorExterno {
  readonly nombre = 'fake';
  readonly capacidad = 'ingesta-growth';
  readonly version = '0';
  llamadas = 0;
  cursoresPedidos: string[] = [];

  soportaReal(): boolean { return false; }
  async salud(): Promise<{ estado: 'SALUDABLE'; detalle: string }> { return { estado: 'SALUDABLE', detalle: 'fake' }; }

  async ejecutar(_ctx: RequestContext, solicitud: SolicitudAdaptador): Promise<SalidaAdaptador> {
    this.llamadas += 1;
    const cursor = solicitud.peticion.parametros.cursor ?? '0';
    this.cursoresPedidos.push(cursor);
    // Sólo entrega los eventos cuando el cursor pedido es 0; si ya avanzó (>=11), no hay más.
    const datos = Number(cursor) < 11 ? EVENTOS : [];
    const next = datos.length > 0 ? 11 : null;
    return { estado: 'OK', salida: { body: JSON.stringify({ ok: true, datos, next_cursor: next }) }, error: null };
  }
}

function nuevaIngesta() {
  const store = new InMemoryEventStore();
  const observaciones = new ObservacionService(store, {} as never);
  const adaptador = new AdaptadorFake();
  const ingesta = new IngestaSmileFlowGrowth({ adaptador, observaciones, store, org: ORG });
  return { store, observaciones, adaptador, ingesta };
}

describe('IngestaSmileFlowGrowth', () => {
  it('primera corrida ingiere 2 observaciones REAL, VALIDADAS, con cursor avanzado', async () => {
    const { observaciones, ingesta } = nuevaIngesta();
    const r = await ingesta.correrUnaVez(ctx(), { ahora: AHORA });

    expect(r.leidos).toBe(2);
    expect(r.ingeridos).toBe(2);
    expect(r.nuevos).toBe(2);
    expect(r.cursorAntes).toBe(0);
    expect(r.cursorDespues).toBe(11);

    const st = await observaciones.cargar(ctx(), observacionIdDe(EVENTOS[1]!));
    expect(st.existe).toBe(true);
    expect(st.estado).toBe('VALIDADA');
    expect(st.datos?.naturaleza).toBe('REAL');
    expect(await observaciones.listarIds(ctx())).toHaveLength(2);
  });

  it('REPLAY de la misma corrida no duplica (idempotente por externalEventId)', async () => {
    const { observaciones, ingesta } = nuevaIngesta();
    await ingesta.correrUnaVez(ctx(), { ahora: AHORA });
    // Segunda corrida: el cursor ya está en 11 ⇒ el fake no entrega más eventos.
    const r2 = await ingesta.correrUnaVez(ctx(), { ahora: AHORA });

    expect(r2.cursorAntes).toBe(11); // arrancó desde el checkpoint
    expect(r2.leidos).toBe(0);
    expect(r2.nuevos).toBe(0);
    expect(await observaciones.listarIds(ctx())).toHaveLength(2); // sigue en 2
  });

  it('si los mismos eventos reaparecen (cursor reseteado), no crea observaciones nuevas', async () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    // Adaptador que SIEMPRE devuelve los 2 mismos eventos, ignorando el cursor.
    const adaptador: AdaptadorExterno = {
      nombre: 'fake-fijo', capacidad: 'ingesta-growth', version: '0',
      soportaReal: () => false,
      salud: async () => ({ estado: 'SALUDABLE', detalle: 'fake' }),
      ejecutar: async () => ({ estado: 'OK', salida: { body: JSON.stringify({ datos: EVENTOS, next_cursor: null }) }, error: null }),
    };
    const ingesta = new IngestaSmileFlowGrowth({ adaptador, observaciones, store, org: ORG });

    const r1 = await ingesta.correrUnaVez(ctx(), { ahora: AHORA });
    expect(r1.nuevos).toBe(2);
    const r2 = await ingesta.correrUnaVez(ctx(), { ahora: AHORA });
    expect(r2.leidos).toBe(2); // volvieron a llegar
    expect(r2.nuevos).toBe(0); // pero ya existían ⇒ no se duplican
    expect(await observaciones.listarIds(ctx())).toHaveLength(2);
  });

  it('estado ERROR del adaptador ⇒ lanza', async () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    const adaptador: AdaptadorExterno = {
      nombre: 'fake-err', capacidad: 'ingesta-growth', version: '0',
      salud: async () => ({ estado: 'NO_DISPONIBLE', detalle: 'x' }),
      ejecutar: async () => ({ estado: 'ERROR', salida: null, error: { clase: 'NO_DISPONIBLE', mensaje: 'caído', reintentable: true } }),
    };
    const ingesta = new IngestaSmileFlowGrowth({ adaptador, observaciones, store, org: ORG });
    await expect(ingesta.correrUnaVez(ctx(), { ahora: AHORA })).rejects.toThrow(/falló/);
  });
});
