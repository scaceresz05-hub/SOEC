/**
 * @soec/motor-medicion · aplicación · SERVICIO DE OBSERVACIÓN OPERACIONAL (M8).
 *
 * Ingresa HECHOS observados a partir de ejecuciones de M7 y los VALIDA autoritativamente contra
 * `LecturaOperativa` — NO confía en el llamador como autoridad del contexto. Reglas duras:
 *  - `registrar` guarda el hecho recibido (REGISTRADA); `validar` lo confronta con M7 (VALIDADA/INVALIDA).
 *  - Nunca acepta naturaleza REAL; una ejecución SIMULADA solo produce observaciones SIMULADAS.
 *  - Multi-tenant: toda lectura pasa por el `ctx` (org); no hay acceso cruzado.
 *  - Ausencia de valor = `null` (jamás 0). Idempotente por `observacionId`. Historia append-only.
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RequestContext } from '@soec/contracts';
import { type LecturaOperativa, clasificarM8 } from '@soec/motor-operacion';
import {
  EVENTOS_OBSERVACION, type DatosObservacion, type NaturalezaDato, type ObservacionState, type UnidadObservacion,
  observacionStreamId, reconstruirObservacion, transicionObservacionValida,
} from '../dominio/observacion';
import { ComandoMedicionInvalidoError, ObservacionNoEncontradaError } from '../dominio/errors';
import type { NivelCalidad } from '@soec/medicion';

const EVENTOS_OBS_INDICE = { registrada: 'observacion-indice.registrada' } as const;
function obsIndiceStreamId(org: string): string { return `observacion-indice:${org}`; }

/** Entrada del hecho observado. El CONTEXTO (orden/ejecución/pieza/variante/naturaleza) se verifica en M7. */
export interface EntradaObservacion {
  readonly ordenId: string;
  readonly hipotesisId: string | null;
  readonly kpiId: string;
  readonly instante: string;
  readonly fuente: string;
  readonly metrica: string;
  readonly valor: number | null;
  readonly unidad: UnidadObservacion;
  readonly naturaleza: NaturalezaDato; // debe ser SIMULADA/ESTIMADA; REAL se rechaza
  readonly calidad: NivelCalidad;
  readonly cobertura: number;
  readonly limitaciones?: readonly string[];
}

export class ObservacionService {
  constructor(private readonly store: EventStore, private readonly lectura: LecturaOperativa) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  cargar(ctx: RequestContext, observacionId: string): Promise<ObservacionState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, observacionStreamId(org, observacionId)).then((e) => reconstruirObservacion(org, observacionId, e));
  }

  private appendObs(ctx: RequestContext, observacionId: string, version: number, type: string, payload: unknown, a: Attribution, o: string) {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, observacionStreamId(this.org(ctx), observacionId), version, [input]);
  }

  private async transicionar(ctx: RequestContext, observacionId: string, type: string, payload: unknown, a: Attribution, o: string): Promise<void> {
    const st = await this.cargar(ctx, observacionId);
    await this.appendObs(ctx, observacionId, st.version, type, payload, a, o);
  }

  /** Registra el HECHO recibido (REGISTRADA). Idempotente. NUNCA acepta naturaleza REAL. */
  async registrar(ctx: RequestContext, observacionId: string, e: EntradaObservacion, a: Attribution, o: string): Promise<ObservacionState> {
    if (!observacionId?.trim() || !e.ordenId?.trim() || !e.kpiId?.trim()) throw new ComandoMedicionInvalidoError('observacionId, ordenId y kpiId son obligatorios');
    if ((e.naturaleza as string) === 'REAL') throw new ComandoMedicionInvalidoError('M8 no registra observaciones de naturaleza REAL');
    if (e.cobertura < 0 || e.cobertura > 1) throw new ComandoMedicionInvalidoError('cobertura fuera de rango [0,1]');
    const st = await this.cargar(ctx, observacionId);
    if (st.existe) { await this.asegurarEnIndice(ctx, observacionId, a, o); return st; } // idempotente (repara índice)
    const datos: DatosObservacion = {
      ordenId: e.ordenId, executionId: '', pieza: { id: '', version: 0 }, variante: null, hipotesisId: e.hipotesisId,
      kpiId: e.kpiId, instante: e.instante, fuente: e.fuente, metrica: e.metrica, valor: e.valor, unidad: e.unidad,
      naturaleza: e.naturaleza, calidad: e.calidad, cobertura: e.cobertura, limitaciones: e.limitaciones ?? [], evidenciaOperacionalRef: null,
    };
    await this.appendObs(ctx, observacionId, st.version, EVENTOS_OBSERVACION.registrada, datos, a, o);
    await this.asegurarEnIndice(ctx, observacionId, a, o);
    return this.cargar(ctx, observacionId);
  }

  /**
   * VALIDA autoritativamente contra M7: la orden existe, su ejecución es COMPLETA y medible, tiene evidencia
   * de naturaleza SIMULADA, y la observación no pretende ser REAL. Materializa pieza/variante/executionId
   * DESDE M7 (no desde el llamador). VALIDADA si todo cuadra; INVALIDA con motivo si no.
   */
  async validar(ctx: RequestContext, observacionId: string, a: Attribution, o: string): Promise<ObservacionState> {
    const st = await this.exigir(ctx, observacionId);
    if (st.estado !== 'REGISTRADA') return st;
    const d = st.datos!;
    const veredicto = await this.verificarContraM7(ctx, d);
    if (!veredicto.ok) {
      await this.transicionar(ctx, observacionId, EVENTOS_OBSERVACION.invalidada, { motivo: veredicto.motivo }, a, o);
      return this.cargar(ctx, observacionId);
    }
    // Materializa el contexto AUTORITATIVO de M7 sobre el hecho (pieza/variante/executionId/evidenciaRef/naturaleza).
    await this.transicionar(ctx, observacionId, EVENTOS_OBSERVACION.validada, { contexto: veredicto.contexto }, a, o);
    return this.cargar(ctx, observacionId);
  }

  private async verificarContraM7(ctx: RequestContext, d: DatosObservacion): Promise<{ ok: true; contexto: unknown } | { ok: false; motivo: string }> {
    const orden = await this.lectura.cargarOrden(ctx, d.ordenId); // scoped por ctx.org ⇒ cross-tenant ⇒ !existe
    if (!orden.existe || !orden.datos) return { ok: false, motivo: 'la orden no existe para esta organización' };
    const tieneEvidencia = orden.evidenciaRefs.length > 0;
    const clas = clasificarM8(orden.estado, tieneEvidencia);
    if (clas !== 'COMPLETA') return { ok: false, motivo: `la ejecución no es COMPLETA/medible (clasificación ${clas})` };
    const evidencias = await this.lectura.listarEvidencias(ctx, d.ordenId);
    if (evidencias.length === 0) return { ok: false, motivo: 'la ejecución no tiene evidencia' };
    if (evidencias.some((ev) => (ev as { naturaleza?: string }).naturaleza !== 'SIMULADO')) return { ok: false, motivo: 'evidencia con naturaleza no SIMULADA' };
    if ((d.naturaleza as string) === 'REAL') return { ok: false, motivo: 'observación REAL sobre ejecución simulada' };
    const contexto = {
      executionId: `${d.ordenId}:i${orden.intentos}`,
      pieza: orden.datos.pieza, variante: orden.datos.variante,
      evidenciaOperacionalRef: orden.evidenciaRefs[orden.evidenciaRefs.length - 1] ?? null,
    };
    return { ok: true, contexto };
  }

  async invalidar(ctx: RequestContext, observacionId: string, motivo: string, a: Attribution, o: string): Promise<ObservacionState> {
    await this.exigir(ctx, observacionId);
    await this.transicionar(ctx, observacionId, EVENTOS_OBSERVACION.invalidada, { motivo }, a, o);
    return this.cargar(ctx, observacionId);
  }

  async descartar(ctx: RequestContext, observacionId: string, motivo: string, a: Attribution, o: string): Promise<ObservacionState> {
    const st = await this.exigir(ctx, observacionId);
    if (!transicionObservacionValida(st.estado, 'DESCARTADA')) return st;
    await this.transicionar(ctx, observacionId, EVENTOS_OBSERVACION.descartada, { motivo }, a, o);
    return this.cargar(ctx, observacionId);
  }

  /** Marca esta observación como SUPERADA por otra posterior (misma orden/kpi). Conserva la historia. */
  async superar(ctx: RequestContext, observacionId: string, por: string, a: Attribution, o: string): Promise<ObservacionState> {
    const st = await this.exigir(ctx, observacionId);
    if (!transicionObservacionValida(st.estado, 'SUPERADA')) return st;
    await this.transicionar(ctx, observacionId, EVENTOS_OBSERVACION.superada, { por }, a, o);
    return this.cargar(ctx, observacionId);
  }

  private async exigir(ctx: RequestContext, observacionId: string): Promise<ObservacionState> {
    const st = await this.cargar(ctx, observacionId);
    if (!st.existe) throw new ObservacionNoEncontradaError(`observación ${observacionId} no encontrada`);
    return st;
  }

  private async asegurarEnIndice(ctx: RequestContext, observacionId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, obsIndiceStreamId(org));
    if (events.some((e) => e.type === EVENTOS_OBS_INDICE.registrada && (e.payload as { observacionId: string }).observacionId === observacionId)) return;
    try {
      await this.store.append(ctx, obsIndiceStreamId(org), events.length, [{ type: EVENTOS_OBS_INDICE.registrada, payload: { observacionId }, attribution: a, occurredAt: o }]);
    } catch (e) { if (!(e instanceof ConcurrencyError)) throw e; } // índice idempotente ante concurrencia
  }

  async listarIds(ctx: RequestContext): Promise<readonly string[]> {
    const events = await this.store.readStream(ctx, obsIndiceStreamId(this.org(ctx)));
    return events.filter((e) => e.type === EVENTOS_OBS_INDICE.registrada).map((e) => (e.payload as { observacionId: string }).observacionId);
  }

  async estaEnIndice(ctx: RequestContext, observacionId: string): Promise<boolean> {
    const events = await this.store.readStream(ctx, obsIndiceStreamId(this.org(ctx)));
    return events.some((e) => e.type === EVENTOS_OBS_INDICE.registrada && (e.payload as { observacionId: string }).observacionId === observacionId);
  }

  async reindexar(ctx: RequestContext, observacionId: string, a: Attribution, o: string): Promise<void> {
    await this.asegurarEnIndice(ctx, observacionId, a, o);
  }
}
