/**
 * Servicio de decisión institucional. Autoriza por rol, valida integridad (justificación,
 * coherencia ACEPTADO/RECHAZADO, candidato dentro de la propuesta), exige reemplazo
 * EXPLÍCITO de la aceptación vigente, y registra el evento append-only con huella de
 * snapshot y clave de idempotencia. Concurrencia optimista vía expectedVersion del
 * EventStore. No produce efecto operativo (decidir ≠ ejecutar).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  type ComandoDecision,
  type DecisionState,
  type RechazoDetalle,
  EVENTOS_DEC,
  SNAPSHOT_SCHEMA_VERSION,
  decStreamId,
  huellaSnapshot,
  reconstruirDecision,
  validarDecision,
} from '../domain/decision';
import { AutorizacionDenegadaError, DecisionInvalidaError } from '../domain/errors';

/** Permiso requerido en el scope para registrar decisiones institucionales. */
export const PERMISO_DECIDIR = 'decisiones:decidir';

export class DecisionService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  cargar(ctx: RequestContext, departamentoId: string): Promise<DecisionState> {
    return this.store
      .readStream(ctx, decStreamId(this.org(ctx), departamentoId))
      .then((e) => reconstruirDecision(this.org(ctx), departamentoId, e));
  }

  private autorizar(ctx: RequestContext): void {
    const permisos = ctx.scope?.permissions ?? [];
    if (!permisos.includes(PERMISO_DECIDIR)) {
      throw new AutorizacionDenegadaError(
        'El actor no tiene el rol autorizado para registrar decisiones institucionales',
      );
    }
  }

  async registrar(
    ctx: RequestContext,
    departamentoId: string,
    cmd: ComandoDecision,
    a: Attribution,
    o: string,
  ): Promise<DecisionState> {
    this.autorizar(ctx);
    const estado = await this.cargar(ctx, departamentoId);
    if (estado.decisiones.some((d) => d.decisionId === cmd.decisionId)) return estado; // idempotente (repetición)

    const errores = validarDecision(cmd);
    if (errores.length > 0)
      throw new DecisionInvalidaError(`Decisión inválida: ${errores.join(', ')}`);

    let reemplaza: string | null = cmd.reemplazaDecisionId ?? null;
    if (cmd.resultado === 'ACEPTADO') {
      if (estado.vigente) {
        if (reemplaza !== estado.vigente.decisionId)
          throw new DecisionInvalidaError(
            'Una aceptación debe superar EXPLÍCITAMENTE a la vigente (reemplazaDecisionId incorrecto)',
          );
      } else if (reemplaza !== null) {
        throw new DecisionInvalidaError('No hay objetivo vigente que reemplazar');
      }
    } else {
      reemplaza = null;
    }

    const rechazo: RechazoDetalle | null =
      cmd.resultado === 'RECHAZADO'
        ? (cmd.rechazo ?? { alcance: 'PROPUESTA_COMPLETA', candidatosRechazados: [] })
        : null;

    const input: EventInput = {
      type: EVENTOS_DEC.registrada,
      payload: {
        decisionId: cmd.decisionId,
        resultado: cmd.resultado,
        candidatoElegido: cmd.candidatoElegido,
        propuesta: cmd.propuesta,
        justificacion: cmd.justificacion,
        reemplazaDecisionId: reemplaza,
        rechazo,
        snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        snapshotHash: huellaSnapshot(cmd.propuesta, cmd.candidatoElegido),
      },
      attribution: a,
      occurredAt: o,
      idempotencyKey: cmd.decisionId,
    };
    await this.store.append(ctx, decStreamId(this.org(ctx), departamentoId), estado.version, [
      input,
    ]);
    return this.cargar(ctx, departamentoId);
  }

  async revocar(
    ctx: RequestContext,
    departamentoId: string,
    decisionId: string,
    motivo: string,
    a: Attribution,
    o: string,
  ): Promise<DecisionState> {
    this.autorizar(ctx);
    const estado = await this.cargar(ctx, departamentoId);
    if (estado.vigente?.decisionId !== decisionId) {
      throw new DecisionInvalidaError(
        'Solo puede revocarse el objetivo vigente; una decisión superada/inexistente no se revoca como vigente',
      );
    }
    const input: EventInput = {
      type: EVENTOS_DEC.revocada,
      payload: { decisionId, motivo },
      attribution: a,
      occurredAt: o,
      idempotencyKey: `revoke:${decisionId}`,
    };
    await this.store.append(ctx, decStreamId(this.org(ctx), departamentoId), estado.version, [
      input,
    ]);
    return this.cargar(ctx, departamentoId);
  }
}
