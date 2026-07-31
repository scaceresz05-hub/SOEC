/**
 * Servicio de ejecución simulada (Bloque E). Orquesta el adaptador determinista y persiste un
 * registro auditable por intento. Garantías:
 *   - Idempotencia: si una `idempotencyKey` ya produjo una publicación simulada, un segundo
 *     intento se resuelve como DUPLICADA y NO crea una segunda publicación.
 *   - Trazabilidad: cada registro lleva `simulado:true`, adaptador, `requestId`, `idempotencyKey`,
 *     escenario, resultado e intento.
 *   - Separación: la ejecución vive bajo la organización del contexto (`ejec:<org>:<contenidoId>`).
 * Event-sourced.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { AdaptadorCanalSimulado } from '../domain/adaptador';
import {
  type EjecucionContenido,
  type EscenarioEjecucion,
  type RegistroEjecucion,
  EVENTOS_EJECUCION,
  ejecucionStreamId,
  publicacionPrevia,
  reconstruirEjecucion,
} from '../domain/ejecucion';
import { EjecucionInvalidaError, SeparacionEjecucionVioladaError } from '../domain/errors';

export interface ComandoEjecucion {
  readonly organizacionId: string;
  readonly contenidoId: string;
  readonly campaniaId: string;
  readonly canal: string;
  readonly idempotencyKey: string;
  /** Escenario a emular; si se omite, lo decide el adaptador. */
  readonly escenario?: EscenarioEjecucion;
}

export interface ResultadoEjecucionServicio {
  readonly registro: RegistroEjecucion;
  readonly estado: EjecucionContenido;
  /** true si el intento fue una petición duplicada (no generó nueva publicación). */
  readonly duplicada: boolean;
}

export class EjecucionService {
  constructor(
    private readonly store: EventStore,
    private readonly adaptador: AdaptadorCanalSimulado,
  ) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  cargar(ctx: RequestContext, contenidoId: string): Promise<EjecucionContenido> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, ejecucionStreamId(org, contenidoId)).then((e) => reconstruirEjecucion(org, contenidoId, e));
  }

  private requestId(org: string, contenidoId: string, idempotencyKey: string, intento: number): string {
    // Determinista: sin reloj ni azar. Único por intento físico.
    return `req:${org}:${contenidoId}:${idempotencyKey}:${intento}`;
  }

  async ejecutar(ctx: RequestContext, cmd: ComandoEjecucion, a: Attribution, o: string): Promise<ResultadoEjecucionServicio> {
    const org = this.org(ctx);
    if (cmd.organizacionId !== org) {
      throw new SeparacionEjecucionVioladaError('la ejecución pertenece a otra organización');
    }
    if (!cmd.idempotencyKey) throw new EjecucionInvalidaError('la ejecución requiere idempotencyKey');

    const estado = await this.cargar(ctx, cmd.contenidoId);
    const intento = estado.registros.length + 1;

    // Idempotencia: si ya se publicó con esta clave, no se vuelve a publicar. Se deja registro
    // auditable de la petición duplicada, pero el contador de publicaciones no crece.
    const previa = publicacionPrevia(estado, cmd.idempotencyKey);
    if (previa) {
      const registro: RegistroEjecucion = {
        requestId: this.requestId(org, cmd.contenidoId, cmd.idempotencyKey, intento),
        idempotencyKey: cmd.idempotencyKey,
        adaptador: this.adaptador.nombre,
        canal: cmd.canal,
        organizacionId: org,
        contenidoId: cmd.contenidoId,
        campaniaId: cmd.campaniaId,
        escenario: 'DUPLICATE_REQUEST',
        resultado: 'DUPLICADA',
        reintentable: false,
        intento,
        simulado: true,
        mensaje: `[SIMULADO] petición duplicada de ${previa.requestId}; no se publica de nuevo`,
        en: o,
      };
      const estadoTras = await this.persistir(ctx, cmd.contenidoId, estado.version, registro, a, o);
      return { registro, estado: estadoTras, duplicada: true };
    }

    const resp = this.adaptador.publicar({ canal: cmd.canal, contenidoId: cmd.contenidoId, idempotencyKey: cmd.idempotencyKey, ...(cmd.escenario ? { escenario: cmd.escenario } : {}) });
    const registro: RegistroEjecucion = {
      requestId: this.requestId(org, cmd.contenidoId, cmd.idempotencyKey, intento),
      idempotencyKey: cmd.idempotencyKey,
      adaptador: resp.adaptador,
      canal: cmd.canal,
      organizacionId: org,
      contenidoId: cmd.contenidoId,
      campaniaId: cmd.campaniaId,
      escenario: resp.escenario,
      resultado: resp.resultado,
      reintentable: resp.reintentable,
      intento,
      simulado: true,
      mensaje: resp.mensaje,
      en: o,
    };
    const estadoTras = await this.persistir(ctx, cmd.contenidoId, estado.version, registro, a, o);
    return { registro, estado: estadoTras, duplicada: false };
  }

  private async persistir(ctx: RequestContext, contenidoId: string, version: number, registro: RegistroEjecucion, a: Attribution, o: string): Promise<EjecucionContenido> {
    const input: EventInput = {
      type: EVENTOS_EJECUCION.registrada,
      payload: registro,
      attribution: a,
      occurredAt: o,
      idempotencyKey: `ejec:${registro.requestId}`,
    };
    await this.store.append(ctx, ejecucionStreamId(this.org(ctx), contenidoId), version, [input]);
    return this.cargar(ctx, contenidoId);
  }
}
