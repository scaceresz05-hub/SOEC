/**
 * apps/api · CAPA DE COMPOSICIÓN · G2-A · INTENCIÓN DE CAMBIO como contrato PERSISTENTE event-sourced.
 *
 * Formaliza la propuesta de un cambio real sobre Google Ads con su máquina de estados y trazabilidad completa.
 * En G2-A la intención NUNCA llega a EJECUTADA externa: el Executor sólo simula (AUTONOMOUS_REAL=false).
 * Idempotente por id determinista (org+campaignId+actionType+entityRef): dos propuestas iguales no se duplican.
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RequestContext } from '@soec/contracts';
import type { ActionTypeAds } from './capacidad-negativa';

export type EstadoIntencion =
  | 'PROPUESTA'
  | 'PENDIENTE_APROBACION'
  | 'APROBADA'
  | 'RECHAZADA'
  | 'LISTA_PARA_EJECUTAR'
  | 'EJECUTADA'   // reservado para efecto externo REAL (G2-B); jamás se alcanza en G2-A
  | 'VERIFICADA'  // en G2-A = verificada en DRY-RUN
  | 'REVERTIDA'   // en G2-A = revertida en DRY-RUN
  | 'FALLIDA';

/** Evidencia trazable de por qué se propone el cambio (sin PII). */
export interface EvidenciaIntencion {
  readonly resumen: string;
  readonly muestra: number;
  readonly suficiente: boolean;
  readonly sinConversionAtribuible: boolean;
  readonly ventana: string;
}

export interface IntencionDeCambio {
  readonly id: string;
  readonly org: string;
  readonly customerId: string;
  readonly campaignId: string;
  readonly lever: string;              // p. ej. 'negativa_termino'
  readonly entityRef: string;          // término/entidad concreta afectada
  readonly actionType: ActionTypeAds;
  readonly before: string;
  readonly after: string;
  readonly reason: string;
  readonly evidence: EvidenciaIntencion;
  readonly confidence: 'baja' | 'media' | 'alta';
  readonly risk: 'bajo' | 'medio' | 'alto';
  readonly authorizationRef: string | null; // ref de la autorización humana (null hasta aprobar)
  readonly createdAt: string;
  readonly status: EstadoIntencion;
}

export const EVENTOS_INTENCION = {
  propuesta: 'intencion.propuesta',
  pendiente: 'intencion.pendiente_aprobacion',
  aprobada: 'intencion.aprobada',
  rechazada: 'intencion.rechazada',
  lista: 'intencion.lista_para_ejecutar',
  verificada: 'intencion.verificada_dryrun',
  revertida: 'intencion.revertida_dryrun',
  fallida: 'intencion.fallida',
} as const;

export function intencionStreamId(org: string, id: string): string {
  return `intencion-ads:${org}:${id}`;
}
function indiceStreamId(org: string): string {
  return `intencion-ads-indice:${org}`;
}

/** id determinista ⇒ idempotencia por (org, campaignId, actionType, entityRef). */
export function intencionId(org: string, campaignId: string, actionType: string, entityRef: string): string {
  const slug = entityRef.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `${actionType}:${campaignId}:${slug}`;
}

export interface IntencionState {
  readonly existe: boolean;
  readonly version: number;
  readonly intencion: IntencionDeCambio | null;
}

/** Transiciones VÁLIDAS de la máquina de estados. En G2-A no hay transición a EJECUTADA. */
const TRANSICIONES: Record<EstadoIntencion, readonly EstadoIntencion[]> = {
  PROPUESTA: ['PENDIENTE_APROBACION', 'RECHAZADA'],
  PENDIENTE_APROBACION: ['APROBADA', 'RECHAZADA'],
  APROBADA: ['LISTA_PARA_EJECUTAR', 'RECHAZADA'],
  LISTA_PARA_EJECUTAR: ['VERIFICADA', 'REVERTIDA', 'FALLIDA'], // en G2-A: dry-run
  RECHAZADA: [],
  EJECUTADA: ['VERIFICADA', 'REVERTIDA', 'FALLIDA'],
  VERIFICADA: [],
  REVERTIDA: [],
  FALLIDA: [],
};

export function transicionValida(desde: EstadoIntencion, hacia: EstadoIntencion): boolean {
  return (TRANSICIONES[desde] ?? []).includes(hacia);
}

export class IntencionService {
  constructor(private readonly store: EventStore) {}

  async cargar(ctx: RequestContext, id: string): Promise<IntencionState> {
    const eventos = await this.store.readStream(ctx, intencionStreamId(String(ctx.organizationId), id));
    let intencion: IntencionDeCambio | null = null;
    for (const e of eventos) {
      const p = e.payload as Partial<IntencionDeCambio> & { status?: EstadoIntencion };
      if (e.type === EVENTOS_INTENCION.propuesta) intencion = p as IntencionDeCambio;
      else if (intencion && p.status) intencion = { ...intencion, ...p, status: p.status } as IntencionDeCambio;
    }
    return { existe: intencion !== null, version: eventos.length, intencion };
  }

  private async append(ctx: RequestContext, id: string, version: number, type: string, payload: unknown, a: Attribution, o: string): Promise<void> {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    await this.store.append(ctx, intencionStreamId(String(ctx.organizationId), id), version, [input]);
  }

  /** Propone una intención (PROPUESTA). Idempotente: si ya existe, la devuelve sin duplicar. */
  async proponer(ctx: RequestContext, intencion: IntencionDeCambio, a: Attribution, o: string): Promise<IntencionState> {
    const st = await this.cargar(ctx, intencion.id);
    if (st.existe) return st;
    await this.append(ctx, intencion.id, st.version, EVENTOS_INTENCION.propuesta, { ...intencion, status: 'PROPUESTA' }, a, o);
    await this.asegurarEnIndice(ctx, intencion.id, a, o);
    return this.cargar(ctx, intencion.id);
  }

  private async transicionar(ctx: RequestContext, id: string, evento: string, nuevoEstado: EstadoIntencion, extra: Partial<IntencionDeCambio>, a: Attribution, o: string): Promise<IntencionState> {
    const st = await this.cargar(ctx, id);
    if (!st.existe || !st.intencion) throw new Error(`intención ${id} no existe`);
    if (!transicionValida(st.intencion.status, nuevoEstado)) throw new Error(`transición inválida ${st.intencion.status} → ${nuevoEstado}`);
    await this.append(ctx, id, st.version, evento, { ...extra, status: nuevoEstado }, a, o);
    return this.cargar(ctx, id);
  }

  marcarPendiente(ctx: RequestContext, id: string, a: Attribution, o: string) { return this.transicionar(ctx, id, EVENTOS_INTENCION.pendiente, 'PENDIENTE_APROBACION', {}, a, o); }
  aprobar(ctx: RequestContext, id: string, authorizationRef: string, a: Attribution, o: string) { return this.transicionar(ctx, id, EVENTOS_INTENCION.aprobada, 'APROBADA', { authorizationRef }, a, o); }
  rechazar(ctx: RequestContext, id: string, a: Attribution, o: string) { return this.transicionar(ctx, id, EVENTOS_INTENCION.rechazada, 'RECHAZADA', {}, a, o); }
  marcarLista(ctx: RequestContext, id: string, a: Attribution, o: string) { return this.transicionar(ctx, id, EVENTOS_INTENCION.lista, 'LISTA_PARA_EJECUTAR', {}, a, o); }
  marcarVerificada(ctx: RequestContext, id: string, a: Attribution, o: string) { return this.transicionar(ctx, id, EVENTOS_INTENCION.verificada, 'VERIFICADA', {}, a, o); }
  marcarRevertida(ctx: RequestContext, id: string, a: Attribution, o: string) { return this.transicionar(ctx, id, EVENTOS_INTENCION.revertida, 'REVERTIDA', {}, a, o); }
  marcarFallida(ctx: RequestContext, id: string, a: Attribution, o: string) { return this.transicionar(ctx, id, EVENTOS_INTENCION.fallida, 'FALLIDA', {}, a, o); }

  private async asegurarEnIndice(ctx: RequestContext, id: string, a: Attribution, o: string): Promise<void> {
    const streamId = indiceStreamId(String(ctx.organizationId));
    const eventos = await this.store.readStream(ctx, streamId);
    if (eventos.some((e) => (e.payload as { id?: string }).id === id)) return;
    try {
      await this.store.append(ctx, streamId, eventos.length, [{ type: 'intencion-indice.registrada', payload: { id }, attribution: a, occurredAt: o }]);
    } catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  async listarIds(ctx: RequestContext): Promise<readonly string[]> {
    const eventos = await this.store.readStream(ctx, indiceStreamId(String(ctx.organizationId)));
    return eventos.filter((e) => e.type === 'intencion-indice.registrada').map((e) => (e.payload as { id: string }).id);
  }
}
