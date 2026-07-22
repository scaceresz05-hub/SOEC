/**
 * Fábrica de contenido (F2-CONT-01 §8) — pipeline editorial DESACOPLADO que
 * transforma un brief en un paquete publicable:
 *   pieza fuente → adaptaciones por canal → validación → revisión automática → ensamblaje.
 * Cada paso tiene responsabilidad limitada. La fábrica produce y valida; NO publica,
 * NO se autoriza, NO accede a SDK de canales, NO gasta presupuesto real. Una pieza
 * inválida jamás alcanza un estado ejecutable. Ningún efecto externo real.
 */
import type { RequestContext } from '@soec/contracts';
import {
  type Afirmacion,
} from '../domain/afirmacion';
import type { Adaptacion, EstadoAdaptacion } from '../domain/adaptacion';
import type { Activo } from '../domain/activo';
import type { ContenidoBrief } from '../domain/brief';
import { type Canal, type Formato, perfilCanal } from '../domain/canales';
import type { ProveedorGenerativo, SalidaGenerada, SolicitudGenerativa } from '../domain/generative';
import { validarRespuesta } from '../domain/generative';
import type { VersionMarca } from '../domain/marca';
import type { PiezaFuente } from '../domain/pieza';
import type { PayloadProducido, ResultadoProduccion, EstadoPaquete } from '../domain/paquete';
import { huellaPaquete } from '../domain/paquete';
import { type Revision, MAX_REVISIONES } from '../domain/revision';
import {
  type ContextoValidacion,
  type Hallazgo,
  corregiblesAutomaticamente,
  hayBloqueante,
  validarAdaptacion,
} from '../domain/validacion';

export interface ProducirParams {
  readonly paqueteId: string;
  readonly briefId: string;
  readonly marcaId: string;
  readonly planId: string;
  readonly campaniaId: string;
  readonly actividadId: string;
  readonly brief: ContenidoBrief;
  readonly marca: VersionMarca | null;
  readonly afirmacionesProhibidas: readonly string[];
  readonly canalesAutorizados: readonly string[];
  readonly canalesDestino: readonly Canal[];
  readonly promptPiezaRef: string;
  readonly promptAdaptRef: string;
  /** Ganchos promocionales por canal (pueden violar la política; el sistema valida). */
  readonly ganchosPromocionales?: Readonly<Record<string, string>>;
  /**
   * Límite de PRESUPUESTO DE PRODUCCIÓN por pieza (categoría separada del gasto
   * publicitario, que gobierna el plano operacional). Si el costo estimado lo
   * excede, el paquete se deniega. 0/omitido = sin límite.
   */
  readonly limiteProduccionPorPieza?: number;
  readonly occurredAt: string;
}

const COSTO_PIEZA = 2;
const COSTO_ADAPTACION = 1;

/** Construye las afirmaciones con procedencia a partir del brief (nunca inventa datos). */
function afirmacionesDe(brief: ContenidoBrief): Afirmacion[] {
  const out: Afirmacion[] = [];
  if (brief.propuestaValor) out.push({ id: 'af-valor', texto: brief.propuestaValor, tipo: 'declarada_empresa', fuente: `brief:${brief.actividadId}`, confianza: 0.7, politicaAplicable: null, riesgo: 'bajo', estado: 'validada' });
  if (brief.productoServicio) out.push({ id: 'af-producto', texto: brief.productoServicio, tipo: 'declarada_empresa', fuente: `brief:${brief.actividadId}`, confianza: 0.8, politicaAplicable: null, riesgo: 'bajo', estado: 'validada' });
  brief.afirmacionesPermitidas.forEach((t, i) => out.push({ id: `af-perm-${i}`, texto: t, tipo: 'declarada_empresa', fuente: 'brief:permitidas', confianza: 0.6, politicaAplicable: null, riesgo: 'bajo', estado: 'validada' }));
  if (brief.problemaCliente) out.push({ id: 'af-problema', texto: brief.problemaCliente, tipo: 'inferencia', fuente: 'brief:segmento', confianza: 0.5, politicaAplicable: null, riesgo: 'medio', estado: 'pendiente' });
  return out;
}

function advertenciasDe(brief: ContenidoBrief, marca: VersionMarca | null): string[] {
  return [...brief.requisitosLegales, ...(marca?.disclaimers ?? [])].filter(Boolean);
}

function contextoPieza(brief: ContenidoBrief): Readonly<Record<string, string>> {
  return {
    audiencia: brief.audiencia,
    problemaCliente: brief.problemaCliente,
    propuestaValor: brief.propuestaValor,
    productoServicio: brief.productoServicio,
    mensajePrincipal: brief.mensajePrincipal,
    llamadaAccion: brief.llamadaAccion,
    tono: brief.tono,
    idioma: brief.idioma,
  };
}

export class FactoryService {
  constructor(private readonly provider: ProveedorGenerativo) {}

  private async generar(ctx: RequestContext, s: SolicitudGenerativa): Promise<SalidaGenerada | null> {
    const r = await this.provider.generar(ctx, s);
    const v = validarRespuesta(r, s.esquemaSalida, s.limiteCaracteres);
    return v.valida ? r.salida : null;
  }

  /** Produce la pieza fuente semántica (independiente del canal). */
  private async producirPieza(ctx: RequestContext, p: ProducirParams): Promise<PiezaFuente> {
    const afirmaciones = afirmacionesDe(p.brief);
    const advertencias = advertenciasDe(p.brief, p.marca);
    const solicitud: SolicitudGenerativa = {
      tarea: 'pieza_fuente',
      contexto: contextoPieza(p.brief),
      esquemaSalida: ['tituloInterno', 'tesis', 'mensaje', 'cuerpo', 'llamadaAccion'],
      idioma: p.brief.idioma,
      limiteCaracteres: 0,
      evitar: [], // proveedor no confiable: sin pre-filtro; la validación es el guardarraíl
      promptRef: p.promptPiezaRef,
      trazabilidad: `pieza:${p.paqueteId}`,
    };
    const salida = await this.generar(ctx, solicitud);
    const campos = salida?.campos ?? {};
    const listas = salida?.listas ?? {};
    const estado = salida ? 'generada' : 'rechazada';
    return {
      version: 1,
      tituloInterno: campos['tituloInterno'] ?? '',
      tesis: campos['tesis'] ?? '',
      estructura: listas['estructura'] ?? [],
      mensaje: campos['mensaje'] ?? p.brief.mensajePrincipal,
      cuerpo: campos['cuerpo'] ?? '',
      llamadaAccion: campos['llamadaAccion'] ?? p.brief.llamadaAccion,
      hechosUtilizados: listas['hechos'] ?? [],
      afirmaciones,
      referencias: p.brief.fuentesDisponibles,
      supuestos: [`audiencia: ${p.brief.audiencia}`, `etapa: ${p.brief.etapaEmbudo}`],
      advertencias,
      idioma: p.brief.idioma,
      procedencia: p.promptPiezaRef,
      estado,
    };
  }

  private activosPara(canal: Canal, formato: Formato, adaptacionId: string, brief: ContenidoBrief, marca: VersionMarca | null): Activo[] {
    const perfil = perfilCanal(canal);
    const out: Activo[] = [];
    const altText = `Imagen para ${brief.productoServicio} dirigida a ${brief.audiencia}`;
    if (perfil?.activosSoportados.includes('imagen') || perfil?.activosSoportados.includes('miniatura')) {
      out.push({
        id: `act-img-${adaptacionId}`,
        tipo: 'imagen',
        descripcion: `Especificación visual para ${canal}`,
        texto: '',
        imagen: {
          relacionAspecto: canal === 'instagram' ? '1:1' : '16:9',
          composicion: `Producto (${brief.productoServicio}) en contexto de ${brief.audiencia}`,
          elementos: [brief.productoServicio, 'llamada a la acción'],
          textosIncorporados: [brief.llamadaAccion],
          usoLogotipo: marca?.usoLogotipo ?? 'esquina inferior derecha',
          referenciasMarca: (marca?.colores ?? []).map((c) => `${c.nombre} ${c.hex}`),
          instrucciones: marca?.estiloFotografico ?? 'fotografía real, luz natural',
          altText,
        },
        guion: null,
        altText,
        procedencia: `factory:${canal}`,
      });
    }
    if (formato === 'reel' || formato === 'carrusel' || perfil?.activosSoportados.includes('video')) {
      out.push({
        id: `act-guion-${adaptacionId}`,
        tipo: formato === 'carrusel' ? 'carrusel' : 'video',
        descripcion: `Guion visual (${formato}) para ${canal}`,
        texto: '',
        imagen: null,
        guion: {
          relacionAspecto: '9:16',
          duracionTotalSeg: 15,
          escenas: [
            { orden: 1, descripcion: `Problema: ${brief.problemaCliente || 'necesidad del cliente'}`, duracionSeg: 5, locucion: brief.problemaCliente, subtitulo: brief.problemaCliente },
            { orden: 2, descripcion: `Solución: ${brief.productoServicio}`, duracionSeg: 6, locucion: brief.propuestaValor, subtitulo: brief.propuestaValor },
            { orden: 3, descripcion: 'Cierre con llamada a la acción', duracionSeg: 4, locucion: brief.llamadaAccion, subtitulo: brief.llamadaAccion },
          ],
          musicaReferencia: 'pista libre de derechos (referencia; sin material protegido no autorizado)',
        },
        altText,
        procedencia: `factory:${canal}`,
      });
    }
    if (canal === 'blog' || canal === 'correo' || canal === 'linkedin') {
      out.push({ id: `act-texto-${adaptacionId}`, tipo: 'texto', descripcion: `Texto largo para ${canal}`, texto: brief.mensajePrincipal, imagen: null, guion: null, altText: '', procedencia: `factory:${canal}` });
    }
    return out;
  }

  /** Genera una adaptación para un canal, revisándola automáticamente hasta MAX_REVISIONES. */
  private async producirAdaptacion(
    ctx: RequestContext,
    p: ProducirParams,
    pieza: PiezaFuente,
    canal: Canal,
  ): Promise<{ adaptacion: Adaptacion; hallazgos: Hallazgo[]; revisiones: Revision[]; activos: Activo[] }> {
    const perfil = perfilCanal(canal);
    const formato: Formato = perfil?.formatoPorDefecto ?? 'post_social';
    const ctxVal: ContextoValidacion = {
      brief: p.brief,
      marca: p.marca,
      afirmacionesProhibidas: p.afirmacionesProhibidas,
      canalesAutorizados: p.canalesAutorizados,
    };
    // El proveedor es NO confiable (§9): la primera pasada no pre-filtra las
    // restricciones. El validador las detecta y la revisión las añade a `evitar`.
    const revisiones: Revision[] = [];
    let evitar: string[] = [];
    let version = 1;
    let adaptacion = await this.ensamblarAdaptacion(ctx, p, pieza, canal, formato, version, evitar);
    let hallazgos: Hallazgo[] = [...validarAdaptacion(adaptacion, ctxVal)];

    for (let ronda = 1; ronda <= MAX_REVISIONES && hayBloqueante(hallazgos); ronda += 1) {
      const corregibles = corregiblesAutomaticamente(hallazgos);
      if (corregibles.length === 0) {
        revisiones.push({ ronda, motivo: 'hallazgo no corregible automáticamente', hallazgosPrevios: hallazgos, accion: 'sin_correccion_posible', evitarAgregado: [], en: p.occurredAt });
        break;
      }
      const nuevosEvitar = corregibles.map((x) => x.evidencia).filter(Boolean);
      evitar = [...evitar, ...nuevosEvitar];
      version += 1;
      const previa = adaptacion;
      adaptacion = await this.ensamblarAdaptacion(ctx, p, pieza, canal, formato, version, evitar);
      hallazgos = [...validarAdaptacion(adaptacion, ctxVal)];
      revisiones.push({ ronda, motivo: `corrección de ${corregibles.map((x) => x.codigo).join(', ')}`, hallazgosPrevios: validarAdaptacion(previa, ctxVal), accion: 'corregida', evitarAgregado: nuevosEvitar, en: p.occurredAt });
    }

    const bloqueante = hayBloqueante(hallazgos);
    const estado: EstadoAdaptacion = bloqueante ? 'bloqueada' : 'lista';
    const motivoBloqueo = bloqueante ? (hallazgos.find((x) => x.bloqueante)?.codigo ?? 'bloqueada') : null;
    const activos = bloqueante ? [] : this.activosPara(canal, formato, adaptacion.id, p.brief, p.marca);
    return { adaptacion: { ...adaptacion, estado, motivoBloqueo, activosRequeridos: activos.map((a) => a.id) }, hallazgos, revisiones, activos };
  }

  private async ensamblarAdaptacion(
    ctx: RequestContext,
    p: ProducirParams,
    pieza: PiezaFuente,
    canal: Canal,
    formato: Formato,
    version: number,
    evitar: readonly string[],
  ): Promise<Adaptacion> {
    const perfil = perfilCanal(canal);
    const gancho = p.ganchosPromocionales?.[canal] ?? '';
    const solicitud: SolicitudGenerativa = {
      tarea: 'adaptacion_canal',
      contexto: {
        formato,
        titulo: pieza.tituloInterno,
        tituloInterno: pieza.tituloInterno,
        mensaje: pieza.mensaje,
        propuestaValor: p.brief.propuestaValor,
        llamadaAccion: p.brief.llamadaAccion,
        ganchoPromocional: gancho,
        hashtags: perfil?.permiteHashtags ? `${p.brief.productoServicio.replace(/\s+/g, '')},${p.brief.audiencia.split(' ')[0]}` : '',
      },
      esquemaSalida: ['cuerpo', 'llamadaAccion'],
      idioma: p.brief.idioma,
      limiteCaracteres: perfil?.limiteCuerpo ?? 0,
      evitar,
      promptRef: p.promptAdaptRef,
      trazabilidad: `adaptacion:${p.paqueteId}:${canal}`,
    };
    const salida = await this.generar(ctx, solicitud);
    const campos = salida?.campos ?? {};
    const listas = salida?.listas ?? {};
    const hashtags = (listas['hashtags'] ?? []).slice(0, perfil?.maxHashtags ?? 0);
    return {
      id: `adp-${canal}`,
      canal,
      formato,
      version,
      titulo: campos['titulo'] ?? pieza.tituloInterno,
      cuerpo: campos['cuerpo'] ?? '',
      descripcion: campos['descripcion'] ?? '',
      altText: `Imagen para ${p.brief.productoServicio} dirigida a ${p.brief.audiencia}`,
      hashtags: perfil?.permiteHashtags ? hashtags : [],
      llamadaAccion: campos['llamadaAccion'] ?? p.brief.llamadaAccion,
      urlObjetivo: '',
      metadatos: { idioma: p.brief.idioma, canal, formato },
      instruccionesVisuales: p.marca?.estiloVisual ?? '',
      duracionEstimadaSeg: formato === 'reel' ? 15 : 0,
      afirmaciones: pieza.afirmaciones, // conservadas, no elevadas
      advertencias: pieza.advertencias, // disclaimers esenciales conservados
      activosRequeridos: [],
      estado: 'adaptada',
      motivoBloqueo: null,
      procedencia: p.promptAdaptRef,
    };
  }

  /** Produce el paquete completo (payload de evento). No persiste ni ejecuta. */
  async producir(ctx: RequestContext, p: ProducirParams): Promise<PayloadProducido> {
    const pieza0 = await this.producirPieza(ctx, p);

    // Si la pieza no se pudo generar, el paquete queda incompleto (no se inventa).
    if (pieza0.estado === 'rechazada' || !pieza0.cuerpo.trim()) {
      const estado: EstadoPaquete = 'incompleto';
      return this.payload(p, { ...pieza0, estado: 'rechazada' }, [], [], [], [], [], 'incompleto', estado, COSTO_PIEZA);
    }

    const adaptaciones: Adaptacion[] = [];
    const activos: Activo[] = [];
    const revisiones: Revision[] = [];
    const hallazgos: Hallazgo[] = [];
    for (const canal of p.canalesDestino) {
      const r = await this.producirAdaptacion(ctx, p, pieza0, canal);
      adaptaciones.push(r.adaptacion);
      activos.push(...r.activos);
      revisiones.push(...r.revisiones);
      hallazgos.push(...r.hallazgos);
    }

    // Una adaptación con hallazgo de afirmación prohibida no corregida → denegado.
    const persisteProhibida = hallazgos.some((x) => x.bloqueante && (x.codigo === 'afirmacion.prohibida' || x.codigo === 'afirmacion.riesgo' || x.codigo === 'marca.expresion'));
    const algunaBloqueada = adaptaciones.some((a) => a.estado === 'bloqueada');
    let resultado: ResultadoProduccion;
    let estadoPaquete: EstadoPaquete;
    if (persisteProhibida) {
      resultado = 'denegado';
      estadoPaquete = 'denegado';
    } else if (algunaBloqueada || adaptaciones.length === 0) {
      resultado = 'incompleto';
      estadoPaquete = 'incompleto';
    } else {
      resultado = 'listo';
      estadoPaquete = 'listo';
    }

    const costo = COSTO_PIEZA + adaptaciones.length * COSTO_ADAPTACION;
    // Presupuesto de producción (categoría separada del gasto publicitario): si el
    // costo estimado excede el límite por pieza, se deniega antes de entregar.
    const limite = p.limiteProduccionPorPieza ?? 0;
    if (limite > 0 && costo > limite) {
      resultado = 'denegado';
      estadoPaquete = 'denegado';
      hallazgos.push({ codigo: 'presupuesto_produccion_excedido', severidad: 'critico', ubicacion: `paquete:${p.paqueteId}`, descripcion: `El costo de producción (${costo}) excede el límite por pieza (${limite})`, evidencia: `${costo} > ${limite}`, accionPosible: 'reducir alcance o ampliar el presupuesto de producción', bloqueante: true });
    }

    const piezaFinal: PiezaFuente = { ...pieza0, estado: estadoPaquete === 'listo' ? 'valida' : estadoPaquete === 'denegado' ? 'rechazada' : 'revisable' };
    return this.payload(p, piezaFinal, [pieza0, piezaFinal], adaptaciones, activos, revisiones, hallazgos, resultado, estadoPaquete, costo);
  }

  private payload(
    p: ProducirParams,
    pieza: PiezaFuente,
    historialPiezas: PiezaFuente[],
    adaptaciones: Adaptacion[],
    activos: Activo[],
    revisiones: Revision[],
    hallazgos: Hallazgo[],
    resultado: ResultadoProduccion,
    estado: EstadoPaquete,
    costo: number,
  ): PayloadProducido {
    return {
      briefRef: p.briefId,
      marcaRef: p.marcaId,
      canal: p.canalesDestino.join(','),
      planRef: p.planId,
      campaniaRef: p.campaniaId,
      actividadRef: p.actividadId,
      pieza,
      historialPiezas,
      adaptaciones,
      activos,
      revisiones,
      hallazgos,
      resultado,
      huella: huellaPaquete(pieza, adaptaciones),
      costoProduccion: costo,
      estado,
    };
  }
}
