/**
 * Ciclo del Director SERVER-SIDE con SEGMENTACIÓN por fase: al cerrar el experimento genera y PERSISTE post-mortem
 * (de la fase POST-cambio, no de toda la campaña) + learning + decision pack + notificación, idempotente y con
 * SUPERSESIÓN de versiones. La UI sólo LEE. NINGÚN write a Google.
 */
import { describe, it, expect } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { DirectorCycleService, directorResultStreamId, EVENTO_DIRECTOR_RESULT, type DepsDirectorCycle } from '../src/autonomia-ads/director-cycle';
import { ExperimentMemoryService } from '../src/autonomia-ads/experiment-memory';

const CAMP = 'customers/8605539300/campaigns/24194332264';

// Cliente Google FAKE READ-ONLY: campaña PAUSED, dos fases (cambio de puja 2026-09-02 23:40), gasto total 7760.
function clienteFake(conCambio = true): { buscar: (cid: string, q: string) => Promise<Array<Record<string, unknown>>> } {
  return {
    buscar: async (_cid, q) => {
      if (q.includes('change_event')) return conCambio ? [{ changeEvent: { changeDateTime: '2026-09-02 23:40:00', changedFields: 'bidding_strategy_type', newResource: { campaign: { biddingStrategyType: 'TARGET_SPEND' } } } }] : [];
      if (q.includes('keyword_view')) return [{ adGroupCriterion: { keyword: { text: 'software de administración dental', matchType: 'BROAD' } }, metrics: { impressions: '40', clicks: '3', costMicros: '2414000000', conversions: '0' } }];
      if (q.includes('search_term_view')) return [{ searchTermView: { searchTerm: 'dentidesk inicio de sesión' }, metrics: { impressions: '30', clicks: '1', costMicros: '714000000', conversions: '0' } }];
      if (q.includes('segments.device')) return [];
      if (q.includes('ad_network_type')) return [];
      if (q.includes('geographic_view')) return [];
      if (q.includes('start_date_time')) return [];
      if (q.includes('segments.date')) return [
        { segments: { date: '2026-09-01' }, metrics: { costMicros: '4759000000', clicks: '1', impressions: '112' } },   // fase 1
        { segments: { date: '2026-09-03' }, metrics: { costMicros: '3001000000', clicks: '4', impressions: '48' } },    // fase 2
      ];
      if (q.includes('metrics.cost_micros')) return [{ campaign: { id: '24194332264' }, metrics: { costMicros: '7760000000', impressions: '520', clicks: '5', conversions: '0' } }];
      if (q.includes('advertising_channel_type')) return [{ campaign: { status: 'PAUSED', name: 'SmileFlow Search Chile', advertisingChannelType: 'SEARCH' } }];
      return [];
    },
  };
}

const envelope = { id: 'env:org-smileflow:h', maxSpendWithoutContact: 7500, experimentBudget: 15000, expiresAt: null, startsAt: null, stopRules: [{ id: 'STOP_ZERO_CONVERSION', enabled: true }] };
function deps(conCambio = true): DepsDirectorCycle {
  return {
    envelopes: { leerUltimo: async () => envelope } as unknown as DepsDirectorCycle['envelopes'],
    bindings: { listar: async () => [{ envelopeId: 'env:org-smileflow:h', entityType: 'campaign', providerResourceId: CAMP }] } as unknown as DepsDirectorCycle['bindings'],
    diagnosis: { leerUltima: async () => ({ firstPartyTracking: { status: 'PASS' }, landing: { status: 'PASS' } }) } as unknown as DepsDirectorCycle['diagnosis'],
    clienteFactory: () => clienteFake(conCambio),
    ahora: () => '2026-09-07T00:00:00.000Z',
  };
}

describe('DirectorCycleService — segmentación por fase, autónomo', () => {
  it('1/2/3/4/5: dos fases; la concentración es de la FASE 2 (keyword 2414/3001≈80%), no de toda la campaña', async () => {
    const store = new InMemoryEventStore();
    const svc = new DirectorCycleService(store, deps());
    const r = await svc.correrCiclo('org-smileflow', 'scheduler');
    const pm = r!.analisis.postMortem;
    expect(pm.phaseSegmentation).toBe('SEGMENTED');
    expect(pm.phases).toHaveLength(2);
    expect(pm.phases[1]!.spend).toBe(3001);                 // fase 2
    expect(pm.metrics.spend).toBe(3001);                    // el análisis usa la fase 2 (no 7760)
    expect(pm.keywordConcentration).toHaveLength(1);
    expect(pm.keywordConcentration[0]!.keyword).toBe('software de administración dental');
    expect(pm.keywordConcentration[0]!.sharePct).toBeCloseTo(80.4, 0);   // 2414/3001, NO 2414/7760
    // 5: término visible 714/3001 ≈ 23,8%, no 80%
    const term = pm.searchTermFindings.find((t) => t.termino.includes('dentidesk'))!;
    expect(term.shareCampaignPct).toBeCloseTo(23.8, 0);
    // 6: no divulgado 2287/3001 ≈ 76,2%
    expect(pm.searchTermPrivacy.unreportedPct).toBeCloseTo(76.2, 0);
    // bidding control: fase1 4759 → fase2 750
    expect(pm.biddingControlWorked).toBe(true);
    expect(r!.analisis.recomendacion.action).toBe('PREPARE_EXPERIMENT_2');
    expect(r!.analisis.recomendacion.humanApprovalRequired).toBe(true);
  });

  it('8: sin change-point ⇒ phaseSegmentation UNKNOWN (no mezcla silenciosa como campaña completa)', async () => {
    const store = new InMemoryEventStore();
    const svc = new DirectorCycleService(store, deps(false));
    const r = await svc.correrCiclo('org-smileflow', 'scheduler');
    expect(r!.analisis.postMortem.phaseSegmentation).toBe('UNKNOWN');
    expect(r!.analisis.postMortem.phases).toHaveLength(0);
  });

  it('9: idempotente — dos ciclos con misma versión no duplican', async () => {
    const store = new InMemoryEventStore();
    const svc = new DirectorCycleService(store, deps());
    await svc.correrCiclo('org-smileflow');
    const r2 = await svc.correrCiclo('org-smileflow');
    expect(r2!.persistido).toBe(false);
    expect(await new ExperimentMemoryService(store).listar('org-smileflow')).toHaveLength(1);
    expect((await svc.leerNotificaciones('org-smileflow'))).toHaveLength(1);
  });

  it('10: un post-mortem de versión ANTERIOR queda superseded sin duplicar la decisión', async () => {
    const store = new InMemoryEventStore();
    const svc = new DirectorCycleService(store, deps());
    // Seed de un resultado con evidencia VIEJA (versión anterior) para el mismo experimento.
    const o = OrganizationId('org-smileflow');
    const ctx: RequestContext = { organizationId: o, actor: ActorId('seed'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'seed' };
    await store.append(ctx, directorResultStreamId('org-smileflow'), 0, [{ type: EVENTO_DIRECTOR_RESULT, payload: { experimentId: '24194332264:STOP_ZERO_CONVERSION', campaignId: '24194332264', campaignName: 'x', status: 'PAUSED', createdAt: '2026-09-06T00:00:00Z', analisis: {}, ranBy: 'scheduler', evidenceVersion: 'v1-legacy', supersedes: null }, attribution: { source: 's', purpose: 'p', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' }, occurredAt: '2026-09-06T00:00:00Z' }]);
    const r = await svc.correrCiclo('org-smileflow');
    expect(r!.persistido).toBe(true);                             // supersede la versión vieja
    const vigente = await svc.leerResultado('org-smileflow');
    expect(vigente!.evidenceVersion).toBe('v2-phase-segmented');
    expect(vigente!.supersedes).toBe('2026-09-06T00:00:00Z');     // apunta al anterior, sin borrarlo (auditoría intacta)
    // la nueva ejecución NO vuelve a persistir en un 2º ciclo
    expect((await svc.correrCiclo('org-smileflow'))!.persistido).toBe(false);
  });

  it('sin campaña vinculada ⇒ null', async () => {
    const store = new InMemoryEventStore();
    const svc = new DirectorCycleService(store, { ...deps(), bindings: { listar: async () => [] } as unknown as DepsDirectorCycle['bindings'] });
    expect(await svc.correrCiclo('org-smileflow')).toBeNull();
  });
});
