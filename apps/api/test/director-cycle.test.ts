/**
 * Ciclo del Director SERVER-SIDE: al cerrar un experimento (stop/pausa), genera y PERSISTE post-mortem + learning +
 * decision pack + notificación, SIN que la UI/endpoint lo dispare, e idempotente (dos ciclos no duplican).
 * El endpoint sólo LEE lo persistido (leerResultado). NINGÚN write a Google.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DirectorCycleService, type DepsDirectorCycle } from '../src/autonomia-ads/director-cycle';
import { ExperimentMemoryService } from '../src/autonomia-ads/experiment-memory';

const CAMP = 'customers/8605539300/campaigns/24194332264';

// Cliente Google FAKE READ-ONLY: campaña PAUSED con gasto 7760 sin contactos ⇒ el experimento está CERRADO.
function clienteFake(): { buscar: (cid: string, q: string) => Promise<Array<Record<string, unknown>>> } {
  return {
    buscar: async (_cid, q) => {
      // Las dimensiones (keyword/device/network/geo) llevan 'segments.date' en su WHERE ⇒ chequearlas ANTES.
      if (q.includes('keyword_view')) return [{ adGroupCriterion: { keyword: { text: 'software de administración dental', matchType: 'BROAD' } }, metrics: { impressions: '400', clicks: '4', costMicros: '6200000000', conversions: '0' } }];
      if (q.includes('segments.device')) return [];
      if (q.includes('ad_network_type')) return [];
      if (q.includes('geographic_view')) return [];
      if (q.includes('start_date_time')) return [];
      if (q.includes('segments.date')) return [];                 // evolución vacía
      if (q.includes('metrics.cost_micros')) return [{ campaign: { id: '24194332264' }, metrics: { costMicros: '7760000000', impressions: '520', clicks: '5', conversions: '0' } }];
      if (q.includes('advertising_channel_type')) return [{ campaign: { status: 'PAUSED', name: 'SmileFlow Search Chile', advertisingChannelType: 'SEARCH' } }];
      return [];
    },
  };
}

function deps(): DepsDirectorCycle {
  const envelope = { id: 'env:org-smileflow:h', maxSpendWithoutContact: 7500, experimentBudget: 15000, expiresAt: null, startsAt: null, stopRules: [{ id: 'STOP_ZERO_CONVERSION', enabled: true }] };
  return {
    envelopes: { leerUltimo: async () => envelope } as unknown as DepsDirectorCycle['envelopes'],
    bindings: { listar: async () => [{ envelopeId: 'env:org-smileflow:h', entityType: 'campaign', providerResourceId: CAMP }] } as unknown as DepsDirectorCycle['bindings'],
    diagnosis: { leerUltima: async () => ({ firstPartyTracking: { status: 'PASS' }, landing: { status: 'PASS' } }) } as unknown as DepsDirectorCycle['diagnosis'],
    clienteFactory: () => clienteFake(),
    ahora: () => '2026-09-07T00:00:00.000Z',
  };
}

describe('DirectorCycleService — autónomo, sin UI', () => {
  it('1/14: correrCiclo (scheduler) genera y PERSISTE post-mortem + recommendation + learning + notificación, sin endpoint', async () => {
    const store = new InMemoryEventStore();
    const svc = new DirectorCycleService(store, deps());
    const r = await svc.correrCiclo('org-smileflow', 'scheduler');
    expect(r?.persistido).toBe(true);
    expect(r?.analisis.recomendacion.action).toBe('PREPARE_EXPERIMENT_2');
    // 15: el resultado quedó persistido y se puede LEER (lo que hará el endpoint)
    const persistido = await svc.leerResultado('org-smileflow');
    expect(persistido).not.toBeNull();
    expect(persistido!.ranBy).toBe('scheduler');
    expect(persistido!.analisis.postMortem.keywordConcentration.length).toBeGreaterThan(0);
    expect(persistido!.createdAt).toBe('2026-09-07T00:00:00.000Z');
    // learning persistido + notificación interna "requiere tu decisión"
    expect(await new ExperimentMemoryService(store).listar('org-smileflow')).toHaveLength(1);
    const notifs = await svc.leerNotificaciones('org-smileflow');
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.mensaje.toLowerCase()).toContain('decisión');
  });

  it('2: dos ciclos con el mismo cierre NO duplican post-mortem/decisión/learning', async () => {
    const store = new InMemoryEventStore();
    const svc = new DirectorCycleService(store, deps());
    await svc.correrCiclo('org-smileflow', 'scheduler');
    const r2 = await svc.correrCiclo('org-smileflow', 'scheduler');
    expect(r2?.persistido).toBe(false);                       // idempotente por experimentId
    expect(await new ExperimentMemoryService(store).listar('org-smileflow')).toHaveLength(1);
    const notifs = await svc.leerNotificaciones('org-smileflow');
    expect(notifs).toHaveLength(1);
  });

  it('sin campaña vinculada ⇒ null (no persiste nada)', async () => {
    const store = new InMemoryEventStore();
    const d = deps();
    const svc = new DirectorCycleService(store, { ...d, bindings: { listar: async () => [] } as unknown as DepsDirectorCycle['bindings'] });
    expect(await svc.correrCiclo('org-smileflow')).toBeNull();
    expect(await svc.leerResultado('org-smileflow')).toBeNull();
  });
});
