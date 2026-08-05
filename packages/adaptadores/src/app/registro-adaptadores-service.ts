/**
 * @soec/adaptadores · aplicación · SERVICIO DE REGISTRO DE ADAPTADORES (M4-C-B). Event-sourced, multi-tenant,
 * determinista. Gobierna el ciclo de vida operativo sin atajos: registrar → configurar → habilitar →
 * autorizar (acto humano), más pausar/reanudar/revocar/expirar/reemplazar/eliminar y cambios de salud,
 * breaker y versión. Nunca nace AUTORIZADO ni REAL; REAL exige acto humano sobre un adaptador AUTORIZADO.
 * Guarda sólo metadatos y referencias (nunca el valor de un secreto ni un proveedor comercial).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { esReferenciaSecreto } from '@soec/plataforma-capacidades';
import {
  AdaptadorInvalidoError,
  RegistroAdaptadorNoEncontradoError,
  TransicionAdaptadorInvalidaError,
} from '../domain/errores-normalizados';
import type { CompatibilidadAdaptador, EstadoCircuitBreaker, LimiteConcurrencia } from '../domain/operativo-tipos';
import { type ContenidoDescriptor, crearDescriptor, huellaDescriptor } from '../domain/descriptor';
import { type NivelActivacion, transicionActivacionValida } from '../m4d/activacion';
import {
  EVENTOS_ADAPTADOR,
  type EstadoRegistroAdaptador,
  type RegistroAdaptador,
  type SaludRegistro,
  adaptadorStreamId,
  reconstruirAdaptador,
  transicionOperativaValida,
} from '../domain/registro-adaptador';

export interface ConfiguracionAdaptador {
  readonly compatibilidad: CompatibilidadAdaptador;
  readonly limites: LimiteConcurrencia;
  readonly secretRef?: string | null;
  readonly expiraEn?: string | null;
}

export interface IndiceAdaptadores {
  readonly organizationId: string;
  readonly version: number;
  readonly adaptadores: readonly string[];
}
const EVENTOS_INDICE = { registrado: 'adaptadores_indice.registrado' } as const;
export function indiceAdaptadoresStreamId(org: string): string {
  return `adaptadores:${org}`;
}

export class RegistroAdaptadoresService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext, adaptadorId: string): Promise<RegistroAdaptador> {
    const org = this.org(ctx);
    return reconstruirAdaptador(org, adaptadorId, await this.store.readStream(ctx, adaptadorStreamId(org, adaptadorId)));
  }

  async listar(ctx: RequestContext): Promise<IndiceAdaptadores> {
    const org = this.org(ctx);
    const eventos = await this.store.readStream(ctx, indiceAdaptadoresStreamId(org));
    return eventos.reduce<IndiceAdaptadores>(
      (st, ev) => {
        const next = { ...st, version: st.version + 1 };
        if (ev.type === EVENTOS_INDICE.registrado) {
          const id = (ev.payload as { adaptadorId: string }).adaptadorId;
          if (st.adaptadores.includes(id)) return next;
          return { ...next, adaptadores: [...st.adaptadores, id] };
        }
        return next;
      },
      { organizationId: org, version: 0, adaptadores: [] },
    );
  }

  private async emitir(ctx: RequestContext, adaptadorId: string, type: string, payload: Record<string, unknown>, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const reg = await this.cargar(ctx, adaptadorId);
    const ev: EventInput = { type, payload, attribution: a, occurredAt: o };
    await this.store.append(ctx, adaptadorStreamId(org, adaptadorId), reg.version, [ev]);
  }

  /** Emite una transición de estado validando la matriz (sin atajos). */
  private async transicionar(ctx: RequestContext, adaptadorId: string, hacia: EstadoRegistroAdaptador, type: string, payload: Record<string, unknown>, a: Attribution, o: string): Promise<RegistroAdaptador> {
    const reg = await this.cargar(ctx, adaptadorId);
    if (!reg.existe) throw new RegistroAdaptadorNoEncontradoError(`adaptador ${adaptadorId} no encontrado`);
    if (!transicionOperativaValida(reg.estado, hacia)) {
      throw new TransicionAdaptadorInvalidaError(`transición ${reg.estado} → ${hacia} no permitida`);
    }
    await this.emitir(ctx, adaptadorId, type, payload, a, o);
    return this.cargar(ctx, adaptadorId);
  }

  async registrar(ctx: RequestContext, adaptadorId: string, capacidadId: string, contratoId: string, contratoVersion: string, implementacionVersion: string, creadoPor: string, a: Attribution, o: string): Promise<void> {
    if (!adaptadorId?.trim() || !capacidadId?.trim() || !contratoId?.trim()) throw new AdaptadorInvalidoError('adaptadorId, capacidadId y contratoId son obligatorios');
    if (!creadoPor?.trim()) throw new AdaptadorInvalidoError('creadoPor es obligatorio');
    const reg = await this.cargar(ctx, adaptadorId);
    if (!reg.existe) {
      await this.emitir(ctx, adaptadorId, EVENTOS_ADAPTADOR.registrado, { adaptadorId, capacidadId, contratoId, contratoVersion, implementacionVersion, creadoPor, en: o }, a, o);
    }
    await this.asegurarEnIndice(ctx, adaptadorId, a, o);
  }

  async configurar(ctx: RequestContext, adaptadorId: string, config: ConfiguracionAdaptador, actor: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    if (config.secretRef && !esReferenciaSecreto(config.secretRef)) throw new AdaptadorInvalidoError('secretRef debe ser una referencia opaca (nunca el valor)');
    if (config.expiraEn && !/^\d{4}-\d{2}-\d{2}T/.test(config.expiraEn)) throw new AdaptadorInvalidoError('expiraEn debe ser ISO');
    return this.transicionar(ctx, adaptadorId, 'CONFIGURADO', EVENTOS_ADAPTADOR.configurado, { compatibilidad: config.compatibilidad, limites: config.limites, secretRef: config.secretRef ?? null, expiraEn: config.expiraEn ?? null, actor, en: o }, a, o);
  }

  async habilitar(ctx: RequestContext, adaptadorId: string, actor: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    return this.transicionar(ctx, adaptadorId, 'HABILITADO', EVENTOS_ADAPTADOR.habilitado, { actor, en: o }, a, o);
  }

  /** Autorización: exige ACTO HUMANO. Sólo desde HABILITADO. */
  async autorizar(ctx: RequestContext, adaptadorId: string, actorHumano: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    if (!actorHumano?.trim()) throw new AdaptadorInvalidoError('autorizar exige un actor humano');
    return this.transicionar(ctx, adaptadorId, 'AUTORIZADO', EVENTOS_ADAPTADOR.autorizado, { actorHumano, en: o }, a, o);
  }

  /** Cambio a REAL: acto humano, sobre un adaptador AUTORIZADO. Nunca automático. */
  async activarReal(ctx: RequestContext, adaptadorId: string, actorHumano: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    if (!actorHumano?.trim()) throw new AdaptadorInvalidoError('activar REAL exige un actor humano');
    const reg = await this.cargar(ctx, adaptadorId);
    if (!reg.existe) throw new RegistroAdaptadorNoEncontradoError(`adaptador ${adaptadorId} no encontrado`);
    if (reg.estado !== 'AUTORIZADO') throw new TransicionAdaptadorInvalidaError('sólo un adaptador AUTORIZADO puede pasar a REAL');
    if (!reg.secretRef) throw new AdaptadorInvalidoError('activar REAL exige una secretRef configurada');
    await this.emitir(ctx, adaptadorId, EVENTOS_ADAPTADOR.modoCambiado, { modo: 'REAL', actorHumano, en: o }, a, o);
    return this.cargar(ctx, adaptadorId);
  }

  async pausar(ctx: RequestContext, adaptadorId: string, actor: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    return this.transicionar(ctx, adaptadorId, 'PAUSADO', EVENTOS_ADAPTADOR.pausado, { actor, en: o }, a, o);
  }

  async reanudar(ctx: RequestContext, adaptadorId: string, actor: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    return this.transicionar(ctx, adaptadorId, 'AUTORIZADO', EVENTOS_ADAPTADOR.reanudado, { actor, en: o }, a, o);
  }

  async revocar(ctx: RequestContext, adaptadorId: string, motivo: string, actor: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    if (!motivo?.trim() || !actor?.trim()) throw new AdaptadorInvalidoError('revocar exige motivo y actor');
    return this.transicionar(ctx, adaptadorId, 'REVOCADO', EVENTOS_ADAPTADOR.revocado, { motivo, actor, en: o }, a, o);
  }

  async expirar(ctx: RequestContext, adaptadorId: string, actor: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    return this.transicionar(ctx, adaptadorId, 'EXPIRADO', EVENTOS_ADAPTADOR.expirado, { actor, en: o }, a, o);
  }

  async reemplazar(ctx: RequestContext, adaptadorId: string, porAdaptadorId: string, actor: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    if (!porAdaptadorId?.trim()) throw new AdaptadorInvalidoError('reemplazar exige el adaptador reemplazante');
    return this.transicionar(ctx, adaptadorId, 'REEMPLAZADO', EVENTOS_ADAPTADOR.reemplazado, { porAdaptadorId, actor, en: o }, a, o);
  }

  /** Baja lógica: preserva historial, impide uso y reactivación silenciosa. */
  async eliminar(ctx: RequestContext, adaptadorId: string, actor: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    return this.transicionar(ctx, adaptadorId, 'ELIMINADO', EVENTOS_ADAPTADOR.eliminado, { actor, en: o }, a, o);
  }

  async registrarSalud(ctx: RequestContext, adaptadorId: string, salud: SaludRegistro, a: Attribution, o: string): Promise<RegistroAdaptador> {
    const reg = await this.cargar(ctx, adaptadorId);
    if (!reg.existe) throw new RegistroAdaptadorNoEncontradoError(`adaptador ${adaptadorId} no encontrado`);
    await this.emitir(ctx, adaptadorId, EVENTOS_ADAPTADOR.saludRegistrada, { salud, en: o }, a, o);
    return this.cargar(ctx, adaptadorId);
  }

  async actualizarBreaker(ctx: RequestContext, adaptadorId: string, circuitBreaker: EstadoCircuitBreaker, a: Attribution, o: string): Promise<RegistroAdaptador> {
    const reg = await this.cargar(ctx, adaptadorId);
    if (!reg.existe) throw new RegistroAdaptadorNoEncontradoError(`adaptador ${adaptadorId} no encontrado`);
    await this.emitir(ctx, adaptadorId, EVENTOS_ADAPTADOR.breakerActualizado, { circuitBreaker, en: o }, a, o);
    return this.cargar(ctx, adaptadorId);
  }

  async cambiarVersion(ctx: RequestContext, adaptadorId: string, contratoVersion: string, implementacionVersion: string, compatibilidad: CompatibilidadAdaptador, actor: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    const reg = await this.cargar(ctx, adaptadorId);
    if (!reg.existe) throw new RegistroAdaptadorNoEncontradoError(`adaptador ${adaptadorId} no encontrado`);
    await this.emitir(ctx, adaptadorId, EVENTOS_ADAPTADOR.versionCambiada, { contratoVersion, implementacionVersion, compatibilidad, actor, en: o }, a, o);
    return this.cargar(ctx, adaptadorId);
  }

  /**
   * Registra/actualiza el descriptor INMUTABLE del adaptador (F-CBH-1). Idempotente por huella; un cambio
   * real incrementa `descriptorVersion` y exige ACTO HUMANO. Habilitar `soportaReal` NO activa el modo REAL
   * (eso requiere `activarReal` sobre el registro). Un descriptor incompatible se bloquea en la ejecución.
   */
  async registrarDescriptor(ctx: RequestContext, adaptadorId: string, contenido: ContenidoDescriptor, actorHumano: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    if (!actorHumano?.trim()) throw new AdaptadorInvalidoError('registrar/actualizar descriptor exige un actor humano');
    const reg = await this.cargar(ctx, adaptadorId);
    if (!reg.existe) throw new RegistroAdaptadorNoEncontradoError(`adaptador ${adaptadorId} no encontrado`);
    if (contenido.adaptadorId !== adaptadorId) throw new AdaptadorInvalidoError('el descriptor no corresponde al adaptador');
    if (reg.capacidadId && contenido.capacidadId !== reg.capacidadId) throw new AdaptadorInvalidoError('capacidadId del descriptor ≠ registro');
    const huella = huellaDescriptor(contenido);
    if (reg.descriptor && reg.descriptor.huella === huella) return reg; // idempotente
    const primero = reg.descriptor === null;
    const descriptorVersion = (reg.descriptor?.descriptorVersion ?? 0) + 1;
    const descriptor = crearDescriptor(contenido, descriptorVersion);
    await this.emitir(ctx, adaptadorId, primero ? EVENTOS_ADAPTADOR.descriptorRegistrado : EVENTOS_ADAPTADOR.descriptorActualizado, { descriptor, actor: actorHumano, en: o }, a, o);
    return this.cargar(ctx, adaptadorId);
  }

  /**
   * Cambia el NIVEL DE ACTIVACIÓN (M4-D, Eje 7). Acto humano; sólo transiciones válidas (un paso adelante o
   * retroceso a SIMULADO = kill-switch). Convierte la activación progresiva en un evento gobernado, no código.
   */
  async cambiarNivel(ctx: RequestContext, adaptadorId: string, nivel: NivelActivacion, actorHumano: string, a: Attribution, o: string): Promise<RegistroAdaptador> {
    if (!actorHumano?.trim()) throw new AdaptadorInvalidoError('cambiar el nivel de activación exige un actor humano');
    const reg = await this.cargar(ctx, adaptadorId);
    if (!reg.existe) throw new RegistroAdaptadorNoEncontradoError(`adaptador ${adaptadorId} no encontrado`);
    if (nivel === reg.nivelActivacion) return reg; // idempotente
    if (!transicionActivacionValida(reg.nivelActivacion, nivel)) {
      throw new TransicionAdaptadorInvalidaError(`transición de nivel ${reg.nivelActivacion} → ${nivel} no permitida`);
    }
    await this.emitir(ctx, adaptadorId, EVENTOS_ADAPTADOR.nivelCambiado, { nivel, actor: actorHumano, en: o }, a, o);
    return this.cargar(ctx, adaptadorId);
  }

  private async asegurarEnIndice(ctx: RequestContext, adaptadorId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const idx = await this.listar(ctx);
    if (idx.adaptadores.includes(adaptadorId)) return;
    const ev: EventInput = { type: EVENTOS_INDICE.registrado, payload: { adaptadorId }, attribution: a, occurredAt: o };
    await this.store.append(ctx, indiceAdaptadoresStreamId(org), idx.version, [ev]);
  }
}
