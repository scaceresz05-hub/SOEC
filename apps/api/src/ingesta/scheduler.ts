/**
 * apps/api · CAPA DE COMPOSICIÓN · Orquestador AUTÓNOMO multi-fuente de ingesta.
 *
 * Corre cada fuente de ingesta (Growth, Google Ads, …) de forma INDEPENDIENTE: si una falla (throw), el error
 * se captura y se registra, y el scheduler CONTINÚA con las demás (recuperación ante errores; una fuente caída
 * no bloquea a las otras). Tras cada corrida se appendéa el estado de última sincronización por fuente a un
 * stream event-sourced, consultable con `ultimaSync`.
 *
 * Las instancias de ingesta se INYECTAN por constructor (el scheduler no las crea).
 */
import { ConcurrencyError, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';

/** Contrato mínimo de una fuente de ingesta corrible (Growth, Google Ads, …). */
export interface FuenteCorrible {
  correrUnaVez(ctx: RequestContext, opts: { ahora: string }): Promise<unknown>;
}

export interface FuenteIngesta {
  readonly provider: string;
  readonly ingesta: FuenteCorrible;
}

export interface DependenciasScheduler {
  readonly fuentes: readonly FuenteIngesta[];
  readonly store: EventStore;
  readonly org: string;
}

/** Estado de una fuente en una corrida. PARCIAL = ingirió parte (alguna consulta falló) sin perder el resto. */
export type EstadoFuente = 'OK' | 'PARCIAL' | 'FALLO';
/** Estado global de la corrida multi-fuente (observabilidad del scheduler / código de salida del launcher). */
export type EstadoCorrida = 'GLOBAL_OK' | 'PARTIAL_FAILURE' | 'TOTAL_FAILURE';

export interface ResultadoFuente {
  readonly provider: string;
  readonly ok: boolean; // false SÓLO en FALLO total de la fuente; PARCIAL mantiene ok=true (no se pierde lo demás)
  readonly estado: EstadoFuente;
  readonly resumen?: unknown;
  readonly error?: string;
}

export interface EstadoSync {
  readonly ok: boolean;
  readonly estado: EstadoFuente;
  readonly at: string;
  readonly resumen?: unknown;
  readonly error?: string;
}

/** Deriva el estado de la fuente desde su resumen: usa `resumen.estado` si lo expone (Google Ads); si no, OK. */
function estadoDeResumen(resumen: unknown): EstadoFuente {
  const e = (resumen as { estado?: unknown } | null)?.estado;
  return e === 'OK' || e === 'PARCIAL' || e === 'FALLO' ? e : 'OK';
}

/** Estado global: OK si todas OK; TOTAL si todas FALLO; PARCIAL en cualquier mezcla (o alguna PARCIAL). */
function estadoGlobal(estados: readonly EstadoFuente[]): EstadoCorrida {
  if (estados.length > 0 && estados.every((e) => e === 'OK')) return 'GLOBAL_OK';
  if (estados.length > 0 && estados.every((e) => e === 'FALLO')) return 'TOTAL_FAILURE';
  return 'PARTIAL_FAILURE';
}

const ATRIB: Attribution = {
  source: 'scheduler-ingesta',
  purpose: 'estado-sync',
  assumptions: [],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

const EVENTO_SYNC = 'sync.registrada';

export class SchedulerIngesta {
  constructor(private readonly deps: DependenciasScheduler) {}

  private estadoStreamId(provider: string): string {
    return `ingesta-estado:${provider}:${this.deps.org}`;
  }

  async correrTodo(ctx: RequestContext, opts: { ahora: string }): Promise<{ fuentes: ResultadoFuente[]; estado: EstadoCorrida }> {
    const resultados: ResultadoFuente[] = [];
    for (const fuente of this.deps.fuentes) {
      let estado: EstadoSync;
      let resultado: ResultadoFuente;
      try {
        const resumen = await fuente.ingesta.correrUnaVez(ctx, { ahora: opts.ahora });
        const est = estadoDeResumen(resumen); // PARCIAL no pierde lo demás: ok se mantiene true salvo FALLO total
        estado = { ok: est !== 'FALLO', estado: est, at: opts.ahora, resumen };
        resultado = { provider: fuente.provider, ok: est !== 'FALLO', estado: est, resumen };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        estado = { ok: false, estado: 'FALLO', at: opts.ahora, error };
        resultado = { provider: fuente.provider, ok: false, estado: 'FALLO', error };
      }
      await this.registrarEstado(ctx, fuente.provider, estado);
      resultados.push(resultado);
    }
    return { fuentes: resultados, estado: estadoGlobal(resultados.map((r) => r.estado)) };
  }

  private async registrarEstado(ctx: RequestContext, provider: string, estado: EstadoSync): Promise<void> {
    const streamId = this.estadoStreamId(provider);
    const events = await this.deps.store.readStream(ctx, streamId);
    try {
      await this.deps.store.append(ctx, streamId, events.length, [
        { type: EVENTO_SYNC, payload: estado, attribution: ATRIB, occurredAt: estado.at },
      ]);
    } catch (e) {
      if (!(e instanceof ConcurrencyError)) throw e; // carrera ⇒ tolerada
    }
  }

  /** Último estado de sincronización registrado para una fuente (null si nunca corrió). */
  async ultimaSync(ctx: RequestContext, provider: string): Promise<EstadoSync | null> {
    const events = await this.deps.store.readStream(ctx, this.estadoStreamId(provider));
    let ultimo: EstadoSync | null = null;
    for (const e of events) {
      if (e.type === EVENTO_SYNC) ultimo = e.payload as EstadoSync;
    }
    return ultimo;
  }
}
