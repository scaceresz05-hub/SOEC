import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, SalidaAdaptador, SolicitudAdaptador } from '@soec/adaptadores';
import { ObservacionService } from '@soec/motor-medicion';
import { IngestaGoogleAds, adsSnapshotStreamId, ultimoSnapshotAds } from '../src/ingesta/ingesta-google-ads-service';

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

const bodySnapshot = (impressions: string): string => JSON.stringify([
  { results: [{ campaign: { id: '24120966895', name: 'SmileFlow Search Chile', status: 'ENABLED' }, metrics: { impressions, clicks: '0', costMicros: '0' } }] },
]);

type Etiqueta = 'campanias' | 'terminos' | 'snapshot';

/** Clasifica la GAQL pedida por su CONTENIDO (las queries diarias/terms ahora se construyen con ventana). */
function etiquetaDe(query: string): Etiqueta {
  if (query.includes('search_term_view')) return 'terminos';
  if (query.includes('WHERE segments.date')) return 'campanias';
  return 'snapshot';
}

/** Adaptador FAKE READ ONLY configurable: puede fallar consultas puntuales (para probar aislamiento). */
class AdaptadorFake implements AdaptadorExterno {
  readonly nombre = 'fake-ads';
  readonly capacidad = 'ingesta-ads';
  readonly version = '0';
  llamadas = 0;
  constructor(private readonly fallar: Set<Etiqueta> = new Set<Etiqueta>(), private readonly snapshotImpr: string = '51') {}

  soportaReal(): boolean { return false; }
  async salud(): Promise<{ estado: 'SALUDABLE'; detalle: string }> { return { estado: 'SALUDABLE', detalle: 'fake' }; }

  async ejecutar(_ctx: RequestContext, solicitud: SolicitudAdaptador): Promise<SalidaAdaptador> {
    this.llamadas += 1;
    const etq = etiquetaDe(solicitud.peticion.parametros.query ?? '');
    if (this.fallar.has(etq)) {
      return { estado: 'ERROR', salida: null, error: { clase: 'NO_DISPONIBLE', mensaje: `respuesta HTTP 400 (${etq})`, reintentable: true } };
    }
    const body = etq === 'campanias' ? BODY_CAMPANIA : etq === 'terminos' ? BODY_TERMINOS : bodySnapshot(this.snapshotImpr);
    return { estado: 'OK', salida: { body }, error: null };
  }
}

function nueva(fallar?: Set<Etiqueta>, snapshotImpr?: string) {
  const store = new InMemoryEventStore();
  const observaciones = new ObservacionService(store, {} as never);
  const adaptador = new AdaptadorFake(fallar ?? new Set<Etiqueta>(), snapshotImpr ?? '51');
  const ingesta = new IngestaGoogleAds({ adaptador, observaciones, store, org: ORG, customerId: CUSTOMER });
  return { store, observaciones, adaptador, ingesta };
}

describe('IngestaGoogleAds', () => {
  it('corrida OK: 5 métricas de campaña + 2 de término como REAL/VALIDADA; snapshot va al stream dedicado', async () => {
    const { store, observaciones, ingesta } = nueva();
    const r = await ingesta.correrUnaVez(ctx(), { ahora: AHORA });

    expect(r.estado).toBe('OK');
    expect(r.snapshotFilas).toBe(1);
    expect(r.campaniasFilas).toBe(1);
    expect(r.terminosFilas).toBe(1);
    expect(r.ingeridos).toBe(7); // 5 diarias + 2 términos (el snapshot NO es observación)
    expect(r.nuevos).toBe(7);
    expect(r.fallos).toEqual([]);
    // la ventana incluye hoy (hasta = hoy local)
    expect(r.ventana.hasta).toBe('2026-08-08');

    const ids = await observaciones.listarIds(ctx());
    expect(ids).toHaveLength(7); // sin observación de snapshot
    const st = await observaciones.cargar(ctx(), 'google-ads:campaign:24120966895:2026-08-07:impressions');
    expect(st.existe).toBe(true);
    expect(st.estado).toBe('VALIDADA');
    expect(st.datos?.naturaleza).toBe('REAL');

    // el snapshot acumulado vigente quedó en el stream dedicado (last-wins)
    const snap = ultimoSnapshotAds(await store.readStream(ctx(), adsSnapshotStreamId(ORG)));
    expect(snap?.impressions).toBe(51);
    expect(snap?.campaignId).toBe('24120966895');
  });

  it('REPLAY de la misma corrida es idempotente en observaciones: nuevos=0', async () => {
    const { observaciones, ingesta } = nueva();
    await ingesta.correrUnaVez(ctx(), { ahora: AHORA });
    const r2 = await ingesta.correrUnaVez(ctx(), { ahora: AHORA });

    expect(r2.estado).toBe('OK');
    expect(r2.ingeridos).toBe(7);
    expect(r2.nuevos).toBe(0);
    expect(await observaciones.listarIds(ctx())).toHaveLength(7);
  });

  it('snapshot LAST-WINS: el panel refleja el acumulado MÁS RECIENTE (fresco cada sync, no se congela)', async () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    // 1ª sync ve 10 impresiones; 2ª sync (mismo día) ve 51 ⇒ el stream debe quedar en 51.
    const ing1 = new IngestaGoogleAds({ adaptador: new AdaptadorFake(new Set(), '10'), observaciones, store, org: ORG, customerId: CUSTOMER });
    await ing1.correrUnaVez(ctx(), { ahora: AHORA });
    const ing2 = new IngestaGoogleAds({ adaptador: new AdaptadorFake(new Set(), '51'), observaciones, store, org: ORG, customerId: CUSTOMER });
    await ing2.correrUnaVez(ctx(), { ahora: '2026-08-08T12:15:00.000Z' });

    const snap = ultimoSnapshotAds(await store.readStream(ctx(), adsSnapshotStreamId(ORG)));
    expect(snap?.impressions).toBe(51); // NO congelado en 10
  });

  it('avanza el checkpoint de fecha en el stream de cursor', async () => {
    const { store, ingesta } = nueva();
    await ingesta.correrUnaVez(ctx(), { ahora: AHORA });
    const eventos = await store.readStream(ctx(), `ingesta-cursor:google-ads:${ORG}`);
    const ultimo = eventos.filter((e) => e.type === 'cursor.avanzado').at(-1);
    expect((ultimo?.payload as { fecha: string }).fecha).toBe('2026-08-07');
  });

  it('AISLAMIENTO: si `terminos` falla, snapshot + campañas SÍ persisten y el estado es PARCIAL', async () => {
    const { store, observaciones, ingesta } = nueva(new Set<Etiqueta>(['terminos']));
    const r = await ingesta.correrUnaVez(ctx(), { ahora: AHORA });

    expect(r.estado).toBe('PARCIAL');
    expect(r.fallos.some((f) => f.startsWith('terminos'))).toBe(true);
    expect(r.terminosFilas).toBe(0);
    // snapshot persistido pese al fallo de términos
    const snap = ultimoSnapshotAds(await store.readStream(ctx(), adsSnapshotStreamId(ORG)));
    expect(snap?.impressions).toBe(51);
    // campañas diarias persistidas (5 métricas); NINGUNA observación de término
    const ids = await observaciones.listarIds(ctx());
    expect(ids).toHaveLength(5);
  });

  it('TODAS las consultas fallan ⇒ estado FALLO, sin observaciones ni snapshot', async () => {
    const { store, observaciones, ingesta } = nueva(new Set<Etiqueta>(['snapshot', 'campanias', 'terminos']));
    const r = await ingesta.correrUnaVez(ctx(), { ahora: AHORA });

    expect(r.estado).toBe('FALLO');
    expect(r.fallos).toHaveLength(3);
    expect(await observaciones.listarIds(ctx())).toHaveLength(0);
    expect(ultimoSnapshotAds(await store.readStream(ctx(), adsSnapshotStreamId(ORG)))).toBeNull();
  });
});
