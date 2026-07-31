/**
 * @soec/crm-comercial · aplicación · Servicio del CRM inteligente.
 *
 * Comandos y consultas sobre contactos, event-sourced y acotados por organización (aislamiento
 * multiempresa: toda operación usa `ctx.organizationId`; un contacto de otra org no es legible ni
 * mutable). Las consultas analíticas (puntaje, recomendación) delegan en funciones puras del dominio
 * y por tanto son deterministas, reconstruibles y explicables.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { TipoEvidencia } from '@soec/negocio';
import {
  type ActividadTipo,
  type ContactoState,
  EVENTOS_CONTACTO,
  contactoStreamId,
  reconstruirContacto,
} from '../domain/contacto';
import { ComandoCrmInvalidoError, ContactoNoEncontradoError } from '../domain/errors';
import { EVENTOS_CRMINDICE, type CrmIndice, crmIndiceStreamId, reconstruirCrmIndice } from '../domain/indices';
import { LIMITES, exigirBajoLimite, normalizarOpcional, validarFechaActividad, validarMonto, validarTexto } from '../domain/validacion';
import { type OpcionesPuntaje, type PuntajeContacto, puntuarContacto, recomendarSiguientePaso } from '../domain/puntaje';
import type { RecomendacionExplicada } from '../domain/explicabilidad';

export interface EntradaContactoNuevo {
  readonly contactoId: string;
  readonly nombre: string;
  readonly email?: string;
  readonly telefono?: string;
  readonly origen: TipoEvidencia;
}
export interface EntradaActividad {
  readonly actividadId: string;
  readonly tipo: ActividadTipo;
  readonly detalle: string;
  readonly valor?: number;
  /** Origen epistémico (default: HECHO_VERIFICADO, un hecho observado). */
  readonly origen?: TipoEvidencia;
}

export class CrmComercialService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargarContacto(ctx: RequestContext, contactoId: string): Promise<ContactoState> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, contactoStreamId(org, contactoId));
    return reconstruirContacto(org, contactoId, events);
  }

  async listarContactos(ctx: RequestContext): Promise<CrmIndice> {
    const events = await this.store.readStream(ctx, crmIndiceStreamId(this.org(ctx)));
    return reconstruirCrmIndice(events);
  }

  /**
   * Registra un contacto nuevo (idempotente por contactoId). H-6: asegura el agregado y LUEGO el
   * índice de forma autorreparable (nunca retorna antes de garantizar la inscripción). H-5: valida.
   */
  async registrarContacto(ctx: RequestContext, entrada: EntradaContactoNuevo, a: Attribution, occurredAt: string): Promise<void> {
    if (!entrada.contactoId?.trim() || !entrada.nombre?.trim()) throw new ComandoCrmInvalidoError('contactoId y nombre son obligatorios');
    const nombre = validarTexto(entrada.nombre.trim(), LIMITES.nombre, 'nombre');
    const email = normalizarOpcional(entrada.email, LIMITES.email, 'email');
    const telefono = normalizarOpcional(entrada.telefono, LIMITES.telefono, 'telefono');
    const org = this.org(ctx);
    const actual = await this.cargarContacto(ctx, entrada.contactoId);
    if (!actual.existe) {
      const payload = { nombre, email, telefono, origen: entrada.origen };
      const input: EventInput = { type: EVENTOS_CONTACTO.registrado, payload, attribution: a, occurredAt };
      await this.store.append(ctx, contactoStreamId(org, entrada.contactoId), actual.version, [input]);
    }
    await this.asegurarEnIndice(ctx, entrada.contactoId, nombre, a, occurredAt);
  }

  /** Registra una actividad observable (hecho con tiempo del mundo `occurredAt`). H-5: valida. */
  async registrarActividad(ctx: RequestContext, contactoIdArg: string, entrada: EntradaActividad, a: Attribution, occurredAt: string): Promise<void> {
    if (!entrada.actividadId?.trim()) throw new ComandoCrmInvalidoError('actividadId es obligatorio');
    validarTexto(entrada.detalle ?? '', LIMITES.texto, 'detalle');
    const valor = validarMonto(entrada.valor);
    validarFechaActividad(occurredAt);
    const estado = await this.cargarContacto(ctx, contactoIdArg);
    if (!estado.existe) throw new ContactoNoEncontradoError(`contacto ${contactoIdArg} no encontrado`);
    exigirBajoLimite(estado.actividades.length, LIMITES.maxActividades, 'actividades');
    const payload = { actividadId: entrada.actividadId, tipo: entrada.tipo, detalle: entrada.detalle, valor, ...(entrada.origen ? { origen: entrada.origen } : {}) };
    const input: EventInput = { type: EVENTOS_CONTACTO.actividad, payload, attribution: a, occurredAt };
    await this.store.append(ctx, contactoStreamId(this.org(ctx), contactoIdArg), estado.version, [input]);
  }

  /** Registra/actualiza un atributo tipado del contacto con su origen epistémico. H-5: valida. */
  async registrarAtributo(ctx: RequestContext, contactoIdArg: string, clave: string, valor: string, origen: TipoEvidencia, a: Attribution, occurredAt: string): Promise<void> {
    if (!clave?.trim()) throw new ComandoCrmInvalidoError('clave de atributo obligatoria');
    const c = validarTexto(clave.trim(), LIMITES.claveAtributo, 'clave de atributo');
    validarTexto(valor ?? '', LIMITES.valorAtributo, 'valor de atributo');
    const estado = await this.cargarContacto(ctx, contactoIdArg);
    if (!estado.existe) throw new ContactoNoEncontradoError(`contacto ${contactoIdArg} no encontrado`);
    const input: EventInput = { type: EVENTOS_CONTACTO.atributo, payload: { clave: c, valor, origen }, attribution: a, occurredAt };
    await this.store.append(ctx, contactoStreamId(this.org(ctx), contactoIdArg), estado.version, [input]);
  }

  /** Puntaje multidimensional explicable del contacto a la fecha `asOf`. */
  async puntuar(ctx: RequestContext, contactoIdArg: string, asOf: string, opciones: OpcionesPuntaje = {}): Promise<PuntajeContacto> {
    const estado = await this.cargarContacto(ctx, contactoIdArg);
    if (!estado.existe) throw new ContactoNoEncontradoError(`contacto ${contactoIdArg} no encontrado`);
    return puntuarContacto(estado, asOf, opciones);
  }

  /** Siguiente paso recomendado (recomendación explicada o abstención honesta). */
  async recomendar(ctx: RequestContext, contactoIdArg: string, asOf: string, opciones: OpcionesPuntaje = {}): Promise<RecomendacionExplicada> {
    const estado = await this.cargarContacto(ctx, contactoIdArg);
    if (!estado.existe) throw new ContactoNoEncontradoError(`contacto ${contactoIdArg} no encontrado`);
    const p = puntuarContacto(estado, asOf, opciones);
    return recomendarSiguientePaso(estado, p);
  }

  /** H-6: inscribe en el índice de forma idempotente; reparable aunque el agregado ya exista. */
  private async asegurarEnIndice(ctx: RequestContext, contactoIdArg: string, nombre: string, a: Attribution, occurredAt: string): Promise<void> {
    const org = this.org(ctx);
    const idx = reconstruirCrmIndice(await this.store.readStream(ctx, crmIndiceStreamId(org)));
    if (idx.contactos.some((c) => c.contactoId === contactoIdArg)) return;
    const input: EventInput = { type: EVENTOS_CRMINDICE.registrado, payload: { contactoId: contactoIdArg, nombre }, attribution: a, occurredAt };
    await this.store.append(ctx, crmIndiceStreamId(org), idx.version, [input]);
  }
}
