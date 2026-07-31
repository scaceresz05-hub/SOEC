/**
 * Servicio de contenido gobernado (Bloque D). Deriva contenido DESDE una campaña gobernada
 * (Bloque C) reutilizando el contrato de brief de la fábrica (`@soec/contenido`), y aplica la
 * capa de gobierno: separación de organización inviolable por referencia externa, prohibición
 * de programar/publicar contenido rechazado, versión que preserva la trazabilidad previa, y
 * publicación estrictamente SIMULADA (no productiva). Event-sourced (`contenido-gob:<org>:<id>`).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { Campania } from '@soec/campanias';
import { type ContenidoBrief, type EtapaEmbudo, validarBrief } from '@soec/contenido';
import {
  type ContenidoGobernado,
  type EstadoContenido,
  EVENTOS_CONTENIDO,
  contenidoGobStreamId,
  reconstruirContenido,
  transicionContenidoValida,
} from '../domain/contenido-gobernado';
import { ContenidoGobernadoInvalidoError, SeparacionContenidoVioladaError, TransicionContenidoInvalidaError } from '../domain/errors';

/** Datos editoriales que el contenido añade sobre el contexto heredado de la campaña. */
export interface EntradaContenido {
  readonly canal: string;
  readonly cuerpo: string;
  readonly marcaId: string;
  readonly productoServicio: string;
  readonly llamadaAccion: string;
  readonly idioma?: string;
  readonly tono?: string;
  readonly territorio?: string;
  readonly etapaEmbudo?: EtapaEmbudo;
  readonly restricciones?: readonly string[];
  readonly afirmacionesProhibidas?: readonly string[];
  /** Fuentes de evidencia adicionales; se suman a las heredadas de la campaña/decisión. */
  readonly fuentesExtra?: readonly string[];
}

export class ContenidoGobernadoService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  cargar(ctx: RequestContext, contenidoId: string): Promise<ContenidoGobernado> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, contenidoGobStreamId(org, contenidoId)).then((e) => reconstruirContenido(org, contenidoId, e));
  }

  /** Construye el brief de la fábrica a partir de la campaña + los datos editoriales. */
  private construirBrief(org: string, campania: Campania, entrada: EntradaContenido): ContenidoBrief {
    return {
      organizationId: org,
      marcaId: entrada.marcaId,
      objetivoComercial: campania.objetivo,
      objetivoMarketing: campania.objetivo,
      iniciativaId: '',
      campaniaId: campania.campaniaId,
      planId: '',
      actividadId: '',
      audiencia: campania.publico,
      segmento: campania.publico,
      etapaEmbudo: entrada.etapaEmbudo ?? 'consideracion',
      canalDestino: entrada.canal,
      proposito: campania.propuesta,
      mensajePrincipal: campania.mensaje,
      propuestaValor: campania.propuesta,
      productoServicio: entrada.productoServicio,
      problemaCliente: `${campania.publico} necesita ${entrada.productoServicio}`,
      llamadaAccion: entrada.llamadaAccion,
      tono: entrada.tono ?? 'cercano y profesional',
      idioma: entrada.idioma ?? 'es',
      territorio: entrada.territorio ?? 'CL',
      restricciones: entrada.restricciones ?? [],
      afirmacionesPermitidas: [],
      afirmacionesProhibidas: entrada.afirmacionesProhibidas ?? [],
      requisitosLegales: entrada.restricciones ?? [],
      fuentesDisponibles: [`decision:${campania.decisionId}`, `campania:${campania.campaniaId}`, ...(entrada.fuentesExtra ?? [])],
      fechaObjetivo: campania.calendario,
    };
  }

  /**
   * Deriva un contenido gobernado desde una campaña. La organización SIEMPRE es la del
   * contexto; una campaña de otra organización no puede reetiquetar el contenido.
   */
  async derivarDeCampania(
    ctx: RequestContext,
    contenidoId: string,
    campania: Campania,
    entrada: EntradaContenido,
    a: Attribution,
    o: string,
  ): Promise<ContenidoGobernado> {
    const org = this.org(ctx);
    if (!campania.existe) throw new ContenidoGobernadoInvalidoError('la campaña de origen no existe');
    // Una referencia externa (la campaña) NO puede cambiar la organización del contenido.
    if (campania.organizacionId !== org) {
      throw new SeparacionContenidoVioladaError('la campaña pertenece a otra organización; no puede gobernar este contenido');
    }
    if (!entrada.cuerpo.trim()) throw new ContenidoGobernadoInvalidoError('el contenido requiere un cuerpo');

    const brief = this.construirBrief(org, campania, entrada);
    const val = validarBrief(brief); // integración: usa la validación de la fábrica, no una propia

    const existente = await this.cargar(ctx, contenidoId);
    if (existente.existe) return existente;

    const payload = {
      contenidoId,
      organizacionId: org,
      campaniaId: campania.campaniaId,
      decisionId: campania.decisionId,
      publico: campania.publico,
      fuentes: brief.fuentesDisponibles,
      canal: entrada.canal,
      cuerpo: entrada.cuerpo,
      brief,
      faltantesBrief: val.faltantes,
      estado: 'BORRADOR' as EstadoContenido,
    };
    const input: EventInput = {
      type: EVENTOS_CONTENIDO.creado,
      payload,
      attribution: a,
      occurredAt: o,
      idempotencyKey: `crear:${contenidoGobStreamId(org, contenidoId)}`,
    };
    await this.store.append(ctx, contenidoGobStreamId(org, contenidoId), existente.version, [input]);
    return this.cargar(ctx, contenidoId);
  }

  /** Transición gobernada. Programar exige APROBADO; el brief debe estar completo para revisar. */
  async transicionar(ctx: RequestContext, contenidoId: string, hacia: EstadoContenido, a: Attribution, o: string): Promise<ContenidoGobernado> {
    const c = await this.cargar(ctx, contenidoId);
    if (!c.existe) throw new ContenidoGobernadoInvalidoError('el contenido no existe');
    if (!transicionContenidoValida(c.estado, hacia)) {
      throw new TransicionContenidoInvalidaError(`transición no permitida: ${c.estado} → ${hacia}`);
    }
    // No se puede pasar a revisión un contenido con brief incompleto (no se inventa el dato).
    if (hacia === 'EN_REVISION' && c.faltantesBrief.length > 0) {
      throw new ContenidoGobernadoInvalidoError(`brief incompleto: faltan ${c.faltantesBrief.join(', ')}`);
    }
    const input: EventInput = { type: EVENTOS_CONTENIDO.transicionado, payload: { estado: hacia }, attribution: a, occurredAt: o };
    await this.store.append(ctx, contenidoGobStreamId(this.org(ctx), contenidoId), c.version, [input]);
    return this.cargar(ctx, contenidoId);
  }

  /** Crea una nueva revisión editorial preservando la trazabilidad previa (campaña, decisión). */
  async nuevaVersion(ctx: RequestContext, contenidoId: string, cuerpo: string, a: Attribution, o: string): Promise<ContenidoGobernado> {
    const c = await this.cargar(ctx, contenidoId);
    if (!c.existe) throw new ContenidoGobernadoInvalidoError('el contenido no existe');
    if (c.estado === 'PROGRAMADO' || c.estado === 'PUBLICADO_SIMULADO') {
      throw new ContenidoGobernadoInvalidoError('no se puede versionar un contenido ya programado o publicado');
    }
    if (!cuerpo.trim()) throw new ContenidoGobernadoInvalidoError('la nueva versión requiere un cuerpo');
    const input: EventInput = { type: EVENTOS_CONTENIDO.versionado, payload: { cuerpo }, attribution: a, occurredAt: o };
    await this.store.append(ctx, contenidoGobStreamId(this.org(ctx), contenidoId), c.version, [input]);
    return this.cargar(ctx, contenidoId);
  }
}
