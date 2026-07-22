/**
 * Servicio de publicación controlada (F2-CHAN-01 §18). Consume un paquete publicable,
 * lo autoriza por el plano operacional (única puerta al efecto), verifica modo,
 * capacidad y activos, lo mapea al payload del canal, lo envía por un adaptador
 * REEMPLAZABLE (simulado o emulado), verifica el estado remoto, reconcilia
 * divergencias y registra todo el ciclo. Idempotente: nunca publica dos veces por una
 * respuesta perdida. No publica públicamente, no gasta, no usa credenciales reales.
 */
import { createHash } from 'node:crypto';
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { PolicyService, evaluarAutorizacion, type AccionPropuesta } from '@soec/operacional';
import { ContentService } from '@soec/contenido';
import type { CanalCredentialProvider, CredencialResuelta, ReferenciaCredencial } from '../domain/credentials';
import { esModoBloqueado, modoHabilitado, type ModoPublicacion } from '../domain/modes';
import type { AdaptadorCanal, PayloadCanal } from '../domain/ports';
import {
  EVENTOS_PUB,
  type EstadoPublicacion,
  type Intento,
  type PublicationState,
  pubStreamId,
  reconstruirPub,
} from '../domain/publication';
import { reconciliar } from '../domain/reconciliation';
import { AdaptadorCanalNoDisponibleError, ComandoCanalInvalidoError, PublicacionNoEncontradaError } from '../domain/errors';
import { mapearPaquete } from './paquete-mapper';

export interface PublicarCmd {
  readonly paqueteId: string;
  readonly canal: string;
  readonly policyId: string;
  readonly modo: ModoPublicacion;
  readonly cuentaLogica: string;
  readonly credencialId: string;
  readonly attribution: Attribution;
  readonly occurredAt: string;
}

const ESTADOS_PAQUETE_PUBLICABLE = new Set(['listo', 'autorizado', 'entregado', 'ejecutado', 'verificado']);

export class PublicationService {
  private readonly policies: PolicyService;

  constructor(
    private readonly store: EventStore,
    private readonly adaptadores: Readonly<Record<'simulado' | 'sandbox', AdaptadorCanal>>,
    private readonly credenciales: CanalCredentialProvider,
    private readonly contenido: ContentService,
  ) {
    this.policies = new PolicyService(store);
  }

  cargar(ctx: RequestContext, publicationId: string): Promise<PublicationState> {
    return this.store.readStream(ctx, pubStreamId(publicationId)).then((e) => reconstruirPub(publicationId, ctx.organizationId, e));
  }

  private input(type: string, payload: unknown, attribution: Attribution, occurredAt: string): EventInput {
    return { type, payload, attribution, occurredAt };
  }
  private idFor(paqueteId: string, canal: string): string {
    return `${paqueteId}__${canal}`;
  }
  private adaptador(modo: ModoPublicacion): AdaptadorCanal {
    if (modo === 'simulado') return this.adaptadores.simulado;
    if (modo === 'sandbox') return this.adaptadores.sandbox;
    throw new AdaptadorCanalNoDisponibleError(`No hay adaptador habilitado para el modo '${modo}'`);
  }
  private claveIdempotencia(ctx: RequestContext, cmd: PublicarCmd, huella: string): string {
    const base = `${ctx.organizationId}|${cmd.paqueteId}|${cmd.canal}|${cmd.cuentaLogica}|${huella}`;
    return 'idem-' + createHash('sha256').update(base).digest('hex').slice(0, 24);
  }
  /** Índice externalRef → publicationId (para resolver webhooks entrantes). Idempotente. */
  private async indexar(ctx: RequestContext, externalRef: string | null, publicationId: string, attribution: Attribution, occurredAt: string): Promise<void> {
    if (!externalRef) return;
    const sid = `pubext:${externalRef}`;
    const existente = await this.store.readStream(ctx, sid);
    if (existente.length > 0) return;
    await this.store.append(ctx, sid, 0, [{ type: 'pubext.mapa', payload: { publicationId }, attribution, occurredAt }]);
  }
  async resolverPorReferencia(ctx: RequestContext, externalRef: string): Promise<string | null> {
    const e = await this.store.readStream(ctx, `pubext:${externalRef}`);
    const p = e[0]?.payload as { publicationId: string } | undefined;
    return p?.publicationId ?? null;
  }

  private async credencialDe(ctx: RequestContext, state: PublicationState): Promise<CredencialResuelta> {
    const ref: ReferenciaCredencial = { organizationId: String(ctx.organizationId), canal: state.canal, cuentaLogica: state.cuentaLogica, credencialId: state.credencialId };
    const cred = await this.credenciales.resolver(ref);
    if (!cred) throw new ComandoCanalInvalidoError('credencial no resoluble');
    return cred;
  }

  /** Prepara la publicación: autoriza, mapea, verifica modo/capacidad/activo/credencial. */
  async preparar(ctx: RequestContext, cmd: PublicarCmd): Promise<PublicationState> {
    if (!cmd.paqueteId || !cmd.canal || !cmd.policyId) throw new ComandoCanalInvalidoError('paqueteId, canal y policyId son obligatorios');
    const publicationId = this.idFor(cmd.paqueteId, cmd.canal);
    const previo = await this.cargar(ctx, publicationId);
    if (previo.existe) return previo; // idempotente por identidad de publicación

    const paquete = await this.contenido.cargarPaquete(ctx, cmd.paqueteId);
    const adapter = this.adaptador(cmd.modo === 'real_desactivado' ? 'simulado' : cmd.modo);
    if (!adapter.soporta(cmd.canal)) throw new AdaptadorCanalNoDisponibleError(`El adaptador no soporta el canal '${cmd.canal}'`);
    const capacidades = adapter.capacidades(cmd.canal);
    const { payload, incompatibilidades } = mapearPaquete(paquete, cmd.canal, capacidades);

    const policyState = await this.policies.cargar(ctx, cmd.policyId);
    const accion: AccionPropuesta = { tipo: capacidades.publicaImagen && !capacidades.publicaTexto ? 'anuncio' : 'publicar_organico', canal: cmd.canal, contenido: payload.content, costo: 0, productoIntelectualRef: `paquete:${cmd.paqueteId}` };
    const decision = evaluarAutorizacion(policyState, accion, 0);

    const ref: ReferenciaCredencial = { organizationId: String(ctx.organizationId), canal: cmd.canal, cuentaLogica: cmd.cuentaLogica, credencialId: cmd.credencialId };
    const cred = await this.credenciales.resolver(ref);

    let estado: EstadoPublicacion = 'lista';
    let motivoBloqueo: string | null = null;
    if (esModoBloqueado(cmd.modo)) {
      estado = 'bloqueada';
      motivoBloqueo = 'modo_real_desactivado';
    } else if (!modoHabilitado(cmd.modo)) {
      estado = 'bloqueada';
      motivoBloqueo = 'modo_no_habilitado';
    } else if (!ESTADOS_PAQUETE_PUBLICABLE.has(paquete.estado)) {
      estado = 'bloqueada';
      motivoBloqueo = `paquete_no_publicable:${paquete.estado}`;
    } else if (!decision.permitida) {
      estado = 'bloqueada';
      motivoBloqueo = `autorizacion:${decision.motivo}`;
    } else if (payload.requiereArchivoReal && payload.assetsReales === 0) {
      estado = 'bloqueada';
      motivoBloqueo = 'activo_real_faltante';
    } else if (incompatibilidades.length > 0) {
      estado = 'bloqueada';
      motivoBloqueo = `incompatible:${incompatibilidades[0]}`;
    } else if (!cred || !cred.vigente) {
      estado = 'bloqueada';
      motivoBloqueo = 'credencial_no_vigente';
    }

    const idempotencyKey = this.claveIdempotencia(ctx, cmd, payload.huella);
    await this.store.append(ctx, pubStreamId(publicationId), previo.version, [
      this.input(EVENTOS_PUB.preparada, {
        paqueteRef: cmd.paqueteId, canal: cmd.canal, cuentaLogica: cmd.cuentaLogica, credencialId: cmd.credencialId, modo: cmd.modo,
        capacidades, payload, idempotencyKey, policyVersion: decision.policyVersion, estado, motivoBloqueo,
      }, cmd.attribution, cmd.occurredAt),
    ]);
    return this.cargar(ctx, publicationId);
  }

  /** Envía la publicación (idempotente): no reenvía si ya hay referencia; reconcilia lo desconocido. */
  async enviar(ctx: RequestContext, publicationId: string, attribution: Attribution, occurredAt: string): Promise<PublicationState> {
    const state = await this.cargar(ctx, publicationId);
    if (!state.existe) throw new PublicacionNoEncontradaError(`La publicación '${publicationId}' no existe`);
    if (['bloqueada', 'cancelada', 'retirada'].includes(state.estado)) return state;
    if (state.externalRef && ['publicada', 'verificada', 'aceptada', 'procesando'].includes(state.estado)) return state; // idempotencia dura
    if (state.estado === 'desconocida') return this.reconciliar(ctx, publicationId, attribution, occurredAt);

    const adapter = this.adaptador(state.modo as ModoPublicacion);
    const cred = await this.credencialDe(ctx, state);
    const payload = state.payload as PayloadCanal;
    const r = await adapter.enviar({ payload, idempotencyKey: state.idempotencyKey, credencial: cred, capacidades: state.capacidades! });

    const nuevoEstado: EstadoPublicacion =
      r.resultado === 'publicada' ? 'publicada' : r.resultado === 'aceptada' ? 'aceptada' : r.resultado === 'desconocida' ? 'desconocida' : 'fallida';
    const intento: Intento = { intentoId: state.intentos.length + 1, resultado: r.resultado, externalRef: r.externalRef, categoriaError: r.error?.categoria ?? null, mensaje: r.error?.mensajeSeguro ?? r.resultado, en: occurredAt };
    await this.store.append(ctx, pubStreamId(publicationId), state.version, [
      this.input(EVENTOS_PUB.intento, { intento, nuevoEstado, externalRef: r.externalRef }, attribution, occurredAt),
    ]);
    await this.indexar(ctx, r.externalRef, publicationId, attribution, occurredAt);

    if (nuevoEstado === 'publicada') return this.verificar(ctx, publicationId, attribution, occurredAt);
    if (nuevoEstado === 'desconocida') return this.reconciliar(ctx, publicationId, attribution, occurredAt);
    return this.cargar(ctx, publicationId);
  }

  /** Verifica el estado remoto y confirma la publicación (no basta con un 2xx). */
  async verificar(ctx: RequestContext, publicationId: string, attribution: Attribution, occurredAt: string): Promise<PublicationState> {
    const state = await this.cargar(ctx, publicationId);
    if (!state.existe) throw new PublicacionNoEncontradaError(`La publicación '${publicationId}' no existe`);
    if (!state.externalRef) return state;
    const adapter = this.adaptador(state.modo as ModoPublicacion);
    const cred = await this.credencialDe(ctx, state);
    const remoto = await adapter.verificar(state.externalRef, cred);
    const nuevoEstado: EstadoPublicacion = remoto.existe && remoto.status === 'published' ? 'verificada' : remoto.existe ? 'procesando' : 'desconocida';
    await this.store.append(ctx, pubStreamId(publicationId), state.version, [
      this.input(EVENTOS_PUB.verificada, { externalRef: state.externalRef, estadoRemoto: remoto.status, nuevoEstado }, attribution, occurredAt),
    ]);
    return this.cargar(ctx, publicationId);
  }

  /** Reconcilia el estado local contra el proveedor (por clave de idempotencia). */
  async reconciliar(ctx: RequestContext, publicationId: string, attribution: Attribution, occurredAt: string): Promise<PublicationState> {
    const state = await this.cargar(ctx, publicationId);
    if (!state.existe) throw new PublicacionNoEncontradaError(`La publicación '${publicationId}' no existe`);
    const adapter = this.adaptador(state.modo as ModoPublicacion);
    const cred = await this.credencialDe(ctx, state);
    const remoto = state.externalRef ? await adapter.verificar(state.externalRef, cred) : await adapter.buscarPorIdempotencia(state.idempotencyKey, cred);
    const hallazgo = reconciliar(state.estado, remoto);
    await this.store.append(ctx, pubStreamId(publicationId), state.version, [this.input(EVENTOS_PUB.reconciliada, { hallazgo }, attribution, occurredAt)]);
    await this.indexar(ctx, hallazgo.externalRef, publicationId, attribution, occurredAt);
    const releido = await this.cargar(ctx, publicationId);
    if (releido.estado === 'procesando' && releido.externalRef) return this.verificar(ctx, publicationId, attribution, occurredAt);
    return releido;
  }

  /** Retira (elimina) una publicación donde el canal lo permita. */
  async retirar(ctx: RequestContext, publicationId: string, motivo: string, attribution: Attribution, occurredAt: string): Promise<PublicationState> {
    const state = await this.cargar(ctx, publicationId);
    if (!state.existe) throw new PublicacionNoEncontradaError(`La publicación '${publicationId}' no existe`);
    if (!state.externalRef || !['publicada', 'verificada'].includes(state.estado)) return state;
    const adapter = this.adaptador(state.modo as ModoPublicacion);
    const cred = await this.credencialDe(ctx, state);
    await adapter.retirar(state.externalRef, cred);
    await this.store.append(ctx, pubStreamId(publicationId), state.version, [this.input(EVENTOS_PUB.retirada, { externalRef: state.externalRef, motivo }, attribution, occurredAt)]);
    return this.cargar(ctx, publicationId);
  }

  /** Ciclo controlado completo: preparar → enviar → (verificar/reconciliar). */
  async publicarCiclo(ctx: RequestContext, cmd: PublicarCmd): Promise<PublicationState> {
    const prep = await this.preparar(ctx, cmd);
    if (prep.estado !== 'lista') return prep;
    return this.enviar(ctx, prep.publicationId, cmd.attribution, cmd.occurredAt);
  }
}
