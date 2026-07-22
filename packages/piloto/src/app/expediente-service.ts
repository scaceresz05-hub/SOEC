/**
 * Servicio de expediente + activación. Crea el expediente del piloto, registra la
 * readiness y el checklist, y gestiona las transiciones. La CEREMONIA DE ACTIVACIÓN real
 * está BLOQUEADA por guardarraíl: cualquier intento devuelve una denegación segura que
 * explica exactamente qué autorización estratégica falta; nunca habilita el modo real.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { entornoOperable, realHabilitable, type Entorno } from '../domain/entorno';
import {
  type ExpedienteState,
  type ItemChecklist,
  type PayloadCreado,
  EVENTOS_EXP,
  expStreamId,
  reconstruirExpediente,
} from '../domain/expediente';
import type { ResultadoReadiness } from '../domain/readiness';
import { ActivacionRealProhibidaError, ExpedienteNoEncontradoError } from '../domain/errors';

export interface ResultadoActivacion {
  readonly permitida: false;
  readonly motivoDenegacion: string;
  readonly autorizacionesFaltantes: readonly string[];
}

export class ExpedienteService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext, expId: string): Promise<ExpedienteState> {
    return this.store.readStream(ctx, expStreamId(expId)).then((e) => reconstruirExpediente(expId, String(ctx.organizationId), e));
  }
  private input(type: string, payload: unknown, a: Attribution, o: string): EventInput {
    return { type, payload, attribution: a, occurredAt: o };
  }
  private async append(ctx: RequestContext, expId: string, input: EventInput): Promise<ExpedienteState> {
    const s = await this.cargar(ctx, expId);
    await this.store.append(ctx, expStreamId(expId), s.version, [input]);
    return this.cargar(ctx, expId);
  }

  async crear(ctx: RequestContext, expId: string, p: PayloadCreado, a: Attribution, o: string): Promise<ExpedienteState> {
    const previo = await this.cargar(ctx, expId);
    if (previo.existe) return previo;
    await this.store.append(ctx, expStreamId(expId), previo.version, [this.input(EVENTOS_EXP.creado, p, a, o)]);
    return this.cargar(ctx, expId);
  }
  registrarReadiness(ctx: RequestContext, expId: string, readiness: ResultadoReadiness, a: Attribution, o: string): Promise<ExpedienteState> {
    return this.append(ctx, expId, this.input(EVENTOS_EXP.readiness, { readiness }, a, o));
  }
  evaluarChecklist(ctx: RequestContext, expId: string, checklist: ItemChecklist[], a: Attribution, o: string): Promise<ExpedienteState> {
    return this.append(ctx, expId, this.input(EVENTOS_EXP.checklist, { checklist }, a, o));
  }
  transicionar(ctx: RequestContext, expId: string, nuevoEstado: ExpedienteState['estado'], a: Attribution, o: string): Promise<ExpedienteState> {
    return this.append(ctx, expId, this.input(EVENTOS_EXP.transicion, { nuevoEstado }, a, o));
  }

  /**
   * Intento de ACTIVACIÓN — SIEMPRE denegado en F2-PILOT-01. Devuelve la denegación con
   * las autorizaciones estratégicas faltantes y registra el intento. Nunca habilita real.
   */
  async intentarActivacion(ctx: RequestContext, expId: string, entorno: Entorno, a: Attribution, o: string): Promise<ResultadoActivacion> {
    const exp = await this.cargar(ctx, expId);
    if (!exp.existe) throw new ExpedienteNoEncontradoError(`El expediente '${expId}' no existe`);
    const faltantes: string[] = [];
    if (!entornoOperable(entorno) || !realHabilitable()) faltantes.push('el modo real está desactivado por guardarraíl (F2-PILOT-01)');
    faltantes.push('autorización estratégica explícita del propietario');
    faltantes.push('credenciales reales verificadas del canal');
    faltantes.push('token de activación de un solo uso');
    faltantes.push('ventana de activación definida');
    if (exp.readiness !== 'apto_para_activacion' && exp.readiness !== 'ensayo_aprobado') faltantes.push('readiness apto para activación');
    if (exp.checklist.some((c) => c.bloqueo || c.estado !== 'aprobado')) faltantes.push('checklist de activación completo');

    const motivo = 'activación real prohibida en F2-PILOT-01: la plataforma quedó preparada, pero la activación es una decisión estratégica explícita pendiente';
    await this.store.append(ctx, expStreamId(expId), exp.version, [this.input(EVENTOS_EXP.activacionIntentada, { motivoDenegacion: motivo }, a, o)]);
    // El intento no lanza: devuelve una denegación explicable (la API la traduce a 409/422 si se prefiere).
    return { permitida: false, motivoDenegacion: motivo, autorizacionesFaltantes: faltantes };
  }

  /** Guardarraíl duro: no existe forma de autorizar producción real en este bloque. */
  async prohibirActivacionReal(): Promise<never> {
    throw new ActivacionRealProhibidaError('La activación en modo real está prohibida hasta autorización estratégica explícita');
  }
}
