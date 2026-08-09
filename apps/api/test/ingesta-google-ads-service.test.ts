import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, SalidaAdaptador, SolicitudAdaptador } from '@soec/adaptadores';
import { ObservacionService } from '@soec/motor-medicion';
import { IngestaGoogleAds } from '../src/ingesta/ingesta-google-ads-service';
import { GAQL_CAMPANIAS, GAQL_TERMINOS } from '../src/ingesta/mapa-google-ads';

const ORG = 'org-smileflow';
const CUSTOMER = '8605539300';
const AHORA = '2026-08-08T12:00:00.000Z';

function ctx(): RequestContext {
  const o = OrganizationId(ORG);
  return { organizationId: o, actor: ActorId('ingesta'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}

const BODY_CAMPANIA = JSON.stringify([
  {
    results: [
      {
        campaign: { id: '24120966895', name: 'SmileFlow Search Chile', status: 'ENABLED' },
        segments: { date: '2026-08-07' },
        metrics: { impressions: '100', clicks: '5', costMicros: '1234000', averageCpc: '246800', ctr: 0.05 },
      },
    ],
  },
]);

const BODY_TERMINOS = JSON.stringify([
  {
    results: [
      {
        searchTermView: { searchTerm: 'dentista santiago' },
        campaign: { id: '24120966895' },
        segments: { date: '2026-08-07' },
        metrics: { impressions: '10', clicks: '1', costMicros: '5000' },
      },
    ],
  },
]);

/** Adaptador FAKE READ ONLY: devuelve el body de campaña o de términos según la GAQL pedida. */
class AdaptadorFake implements AdaptadorExterno {
  readonly nombre = 'fake-ads';
  readonly capacidad = 'ingesta-ads';
  readonly version = '0';
  llamadas = 0;

  soportaReal(): boolean { return false; }
  async salud(): Promise<{ estado: 'SALUDABLE'; detalle: string }> { return { estado: 'SALUDABLE', detalle: 'fake' }; }

  async ejecutar(_ctx: RequestContext, solicitud: SolicitudAdaptador): Promise<SalidaAdaptador> {
    this.llamadas += 1;
    const q = solicitud.peticion.parametros.query;
    const body = q === GAQL_CAMPANIAS ? BODY_CAMPANIA : q === GAQL_TERMINOS ? BODY_TERMINOS : '[]';
    return { estado: 'OK', salida: { body }, error: null };
  }
}

function nueva() {
  const store = new InMemoryEventStore();
  const observaciones = new ObservacionService(store, {} as never);
  const adaptador = new AdaptadorFake();
  const ingesta = new IngestaGoogleAds({ adaptador, observaciones, store, org: ORG, customerId: CUSTOMER });
  return { store, observaciones, adaptador, ingesta };
}

describe('IngestaGoogleAds', () => {
  it('primera corrida ingiere 5 métricas de campaña + 2 de término como REAL/VALIDADA', async () => {
    const { observaciones, ingesta } = nueva();
    const r = await ingesta.correrUnaVez(ctx(), { ahora: AHORA });

    expect(r.campaniasFilas).toBe(1);
    expect(r.terminosFilas).toBe(1);
    expect(r.ingeridos).toBe(7);
    expect(r.nuevos).toBe(7);

    const ids = await observaciones.listarIds(ctx());
    expect(ids).toHaveLength(7);
    const st = await observaciones.cargar(ctx(), 'google-ads:campaign:24120966895:2026-08-07:impressions');
    expect(st.existe).toBe(true);
    expect(st.estado).toBe('VALIDADA');
    expect(st.datos?.naturaleza).toBe('REAL');
  });

  it('REPLAY de la misma corrida es idempotente: nuevos=0', async () => {
    const { observaciones, ingesta } = nueva();
    await ingesta.correrUnaVez(ctx(), { ahora: AHORA });
    const r2 = await ingesta.correrUnaVez(ctx(), { ahora: AHORA });

    expect(r2.ingeridos).toBe(7);
    expect(r2.nuevos).toBe(0);
    expect(await observaciones.listarIds(ctx())).toHaveLength(7);
  });

  it('avanza el checkpoint de fecha en el stream de cursor', async () => {
    const { store, ingesta } = nueva();
    await ingesta.correrUnaVez(ctx(), { ahora: AHORA });
    const eventos = await store.readStream(ctx(), `ingesta-cursor:google-ads:${ORG}`);
    const ultimo = eventos.filter((e) => e.type === 'cursor.avanzado').at(-1);
    expect((ultimo?.payload as { fecha: string }).fecha).toBe('2026-08-07');
  });

  it('estado ERROR del adaptador ⇒ lanza', async () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    const adaptador: AdaptadorExterno = {
      nombre: 'fake-err', capacidad: 'ingesta-ads', version: '0',
      salud: async () => ({ estado: 'NO_DISPONIBLE', detalle: 'x' }),
      ejecutar: async () => ({ estado: 'ERROR', salida: null, error: { clase: 'NO_DISPONIBLE', mensaje: 'caído', reintentable: true } }),
    };
    const ingesta = new IngestaGoogleAds({ adaptador, observaciones, store, org: ORG, customerId: CUSTOMER });
    await expect(ingesta.correrUnaVez(ctx(), { ahora: AHORA })).rejects.toThrow(/falló/);
  });
});
