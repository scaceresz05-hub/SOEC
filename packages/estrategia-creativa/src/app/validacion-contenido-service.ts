/**
 * @soec/estrategia-creativa · aplicación · Servicio de VALIDACIÓN de contenido comercial (A-3). Aplica el
 * validador semántico al cuerpo generado y PERSISTE el veredicto (auditable, event-sourced, multi-tenant).
 * Devuelve el veredicto para que el orquestador decida: sólo un resultado VALIDO produce pieza publicable.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  type EntradaValidacionContenido,
  type VeredictoContenido,
  validarContenidoComercial,
} from '../domain/validador-contenido';
import {
  EVENTOS_VALIDACION,
  type RegistroValidacion,
  type ValidacionRegistroState,
  reconstruirValidacionRegistro,
  validacionRegistroStreamId,
} from '../domain/validacion-registro';

export interface ContextoRegistro {
  readonly referencia: string;
  readonly promptRef: string;
  readonly estrategiaRef: string;
  readonly politicaVersion: string;
}

export class ValidacionContenidoService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext, referencia: string): Promise<ValidacionRegistroState> {
    const org = this.org(ctx);
    return reconstruirValidacionRegistro(org, referencia, await this.store.readStream(ctx, validacionRegistroStreamId(org, referencia)));
  }

  /** Valida el cuerpo y registra el veredicto (VALIDO/INVALIDO/REQUIERE_REVISION). Persiste siempre. */
  async validarYRegistrar(ctx: RequestContext, entrada: EntradaValidacionContenido, meta: ContextoRegistro, a: Attribution, o: string): Promise<VeredictoContenido> {
    const veredicto = validarContenidoComercial(entrada);
    const st = await this.cargar(ctx, meta.referencia);
    const registro: RegistroValidacion = {
      referencia: meta.referencia,
      promptRef: meta.promptRef,
      estrategiaRef: meta.estrategiaRef,
      politicaVersion: meta.politicaVersion,
      resultado: veredicto.resultado,
      razones: veredicto.razones,
      categorias: veredicto.categorias,
      afirmacionesNoRespaldadas: veredicto.afirmacionesNoRespaldadas,
      longitudCuerpo: entrada.cuerpo.length,
      naturaleza: 'SIMULADO',
      en: o,
    };
    const ev: EventInput = { type: EVENTOS_VALIDACION.registrada, payload: registro, attribution: a, occurredAt: o };
    await this.store.append(ctx, validacionRegistroStreamId(this.org(ctx), meta.referencia), st.version, [ev]);
    return veredicto;
  }
}
