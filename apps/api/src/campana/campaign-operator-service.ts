/**
 * apps/api · campana · CAMPAIGN OPERATOR (DRY-RUN / SIMULACIÓN).
 *
 * Orquesta el ciclo completo SIN gastar ni escribir en ningún proveedor:
 *   OBJETIVO + PRESUPUESTO humano + PERÍODO + evidencia real (snapshot Ads + contactos Growth + términos + cap)
 *     → construirMarketingPlan (puro)      → MARKETING_PLAN (+ CAMPAIGN_DRAFTS + CHANNEL_ALLOCATION)
 *     → construirEnvelopeDraft (puro)      → AUTHORIZED_EXECUTION_ENVELOPE (status DRAFT, sin aprobar)
 *     → persiste (stream `campaign-operator:<org>`, last-wins).
 *
 * NO habilita escritura real: `SOEC_AUTONOMOUS_REAL` permanece false y el sobre queda en DRAFT. La ejecución
 * real controlada (adapters gobernados por el envelope) es un paso posterior, fuera de este entregable.
 */
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import { adsSnapshotStreamId, ultimoSnapshotAds } from '../ingesta/ingesta-google-ads-service';
import { getRecursoGoogleAds } from '../plataforma';
import { construirMarketingPlan, type CanalId, type MarketingPlan } from './marketing-plan';
import { construirEnvelopeDraft, type AuthorizedExecutionEnvelope } from './execution-envelope';
import type { CapLookup } from '../autonomia-ads/plan-accion-service';

const GROWTH = 'smileflow-growth';
const EVENTO_CONTACTO = 'lead_created';
export const EVENTO_CAMPAIGN_OPERATOR = 'campaign-operator.dryrun';
export function campaignOperatorStreamId(org: string): string {
  return `campaign-operator:${org}`;
}

const ATRIB: Attribution = {
  source: 'campaign-operator-dryrun',
  purpose: 'operador de campaña en DRY-RUN (sin efecto externo)',
  assumptions: ['SOEC_AUTONOMOUS_REAL apagado; envelope en DRAFT; ninguna escritura real; nada de gasto'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

export interface EntradaOperador {
  readonly objetivo: string;
  readonly presupuestoTotal: number;
  readonly periodoDias: number;
  readonly canales?: readonly CanalId[];
}

export interface ResultadoOperador {
  readonly modo: 'DRY_RUN';
  readonly autonomousReal: false;
  readonly plan: MarketingPlan;
  readonly envelopeDraft: AuthorizedExecutionEnvelope;
  readonly at: string;
}

/** Disponibilidad de canales para PLANIFICAR. Meta queda DORMANT salvo gate externo (META_AVAILABLE=true). */
export function canalesDisponibles(env: NodeJS.ProcessEnv): Readonly<Record<CanalId, boolean>> {
  return { google: true, meta: env.META_AVAILABLE === 'true' };
}

export class CampaignOperatorDryRunService {
  private readonly observaciones: ObservacionService;

  constructor(
    private readonly store: EventStore,
    private readonly capLookup?: CapLookup,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.observaciones = new ObservacionService(store, {} as never);
  }

  private ctx(org: string): RequestContext {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('campaign-operator'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `campaign-operator-${org}` };
  }

  private async evidencia(ctx: RequestContext): Promise<{ contactos: number; terminos: { termino: string; impresiones: number; clics: number }[] }> {
    const ids = await this.observaciones.listarIds(ctx);
    let contactos = 0;
    const map = new Map<string, { impresiones: number; clics: number }>();
    for (const id of ids) {
      const st = await this.observaciones.cargar(ctx, id);
      const d = st.datos;
      if (!d || d.naturaleza !== 'REAL' || !d.provenanciaReal) continue;
      const p = d.provenanciaReal;
      if (p.provider === GROWTH && !p.diagnostico && p.eventName === EVENTO_CONTACTO) { contactos += 1; continue; }
      if (p.provider === 'google-ads' && !p.diagnostico && p.eventName === 'ads_search_term' && p.utmContent) {
        const acc = map.get(p.utmContent) ?? { impresiones: 0, clics: 0 };
        if (d.metrica === 'search_term_impressions') acc.impresiones += d.valor ?? 0;
        else if (d.metrica === 'search_term_clicks') acc.clics += d.valor ?? 0;
        map.set(p.utmContent, acc);
      }
    }
    return { contactos, terminos: [...map.entries()].map(([termino, v]) => ({ termino, ...v })) };
  }

  async planificar(org: string, ahora: string, entrada: EntradaOperador): Promise<ResultadoOperador> {
    const ctx = this.ctx(org);
    const ads = getRecursoGoogleAds(org); // valida configuración de la org (lanza si falta)
    const snap = ultimoSnapshotAds(await this.store.readStream(ctx, adsSnapshotStreamId(org)));
    const { contactos, terminos } = await this.evidencia(ctx);
    const capAutorizado = this.capLookup && snap ? await this.capLookup(org, snap.campaignId) : null;

    const startAt = ahora;
    const endAt = new Date(Date.parse(ahora) + entrada.periodoDias * 24 * 3600_000).toISOString();
    const disponibilidad = canalesDisponibles(this.env);
    const canalesSolicitados = (entrada.canales && entrada.canales.length > 0 ? entrada.canales : (['google', 'meta'] as CanalId[]));

    const plan = construirMarketingPlan({
      objetivo: entrada.objetivo,
      presupuestoTotal: entrada.presupuestoTotal,
      periodoDias: entrada.periodoDias,
      startAt,
      endAt,
      moneda: 'CLP',
      canalesSolicitados,
      disponibilidad,
      evidencia: {
        impresiones: snap?.impressions ?? 0,
        clics: snap?.clicks ?? 0,
        gasto: snap?.cost ?? 0,
        contactosReales: contactos,
        capAutorizado,
        campaignStatus: snap?.status ?? null,
        moneda: 'CLP',
        terminos,
      },
    });

    const planId = `plan:${org}:${ahora}`;
    const envelopeDraft = construirEnvelopeDraft(plan, org, planId);
    const resultado: ResultadoOperador = { modo: 'DRY_RUN', autonomousReal: false, plan, envelopeDraft, at: ahora };
    // Referencia registrada, sin escritura de proveedor: sólo persiste el plan/sobre (event-sourced, last-wins).
    void ads;
    await this.persistir(ctx, resultado);
    return resultado;
  }

  private async persistir(ctx: RequestContext, r: ResultadoOperador): Promise<void> {
    const streamId = campaignOperatorStreamId(String(ctx.organizationId));
    const eventos = await this.store.readStream(ctx, streamId);
    try {
      await this.store.append(ctx, streamId, eventos.length, [{ type: EVENTO_CAMPAIGN_OPERATOR, payload: r, attribution: ATRIB, occurredAt: r.at }]);
    } catch {
      // carrera ⇒ tolerada (last-wins)
    }
  }

  async leerUltimo(org: string): Promise<ResultadoOperador | null> {
    const ctx = this.ctx(org);
    const eventos = await this.store.readStream(ctx, campaignOperatorStreamId(org));
    let ultimo: ResultadoOperador | null = null;
    for (const e of eventos) if (e.type === EVENTO_CAMPAIGN_OPERATOR) ultimo = e.payload as ResultadoOperador;
    return ultimo;
  }
}
