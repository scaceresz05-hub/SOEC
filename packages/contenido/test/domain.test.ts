import { describe, expect, it } from 'vitest';
import {
  afirmacionBloquea,
  puedePresentarseComoHecho,
  validarBrief,
  transicionBriefValida,
  transicionPiezaValida,
  transicionAdaptacionValida,
  validarAdaptacion,
  hayBloqueante,
  corregiblesAutomaticamente,
  huellaPaquete,
  perfilCanal,
  esCanal,
  type Adaptacion,
  type ContenidoBrief,
  type ContextoValidacion,
  type PiezaFuente,
} from '../src';

function briefBase(over: Partial<ContenidoBrief> = {}): ContenidoBrief {
  return {
    organizationId: 'orgA',
    marcaId: 'm',
    objetivoComercial: 'vender',
    objetivoMarketing: 'leads',
    iniciativaId: 'i',
    campaniaId: 'c',
    planId: 'p',
    actividadId: 'a',
    audiencia: 'administradores',
    segmento: 's',
    etapaEmbudo: 'conversion',
    canalDestino: 'blog',
    proposito: 'informar',
    mensajePrincipal: 'mantención confiable',
    propuestaValor: 'respuesta en 24h',
    productoServicio: 'mantención preventiva',
    problemaCliente: 'fallas imprevistas',
    llamadaAccion: 'Solicita una cotización',
    tono: 'cercano',
    idioma: 'es',
    territorio: 'Chile',
    restricciones: [],
    afirmacionesPermitidas: [],
    afirmacionesProhibidas: [],
    requisitosLegales: [],
    fuentesDisponibles: [],
    fechaObjetivo: '2026-03-02T09:00:00.000Z',
    ...over,
  };
}

function adaptacionBase(over: Partial<Adaptacion> = {}): Adaptacion {
  return {
    id: 'adp-blog',
    canal: 'blog',
    formato: 'articulo',
    version: 1,
    titulo: 'Mantención confiable',
    cuerpo: 'mantención confiable con respuesta en 24h para administradores',
    descripcion: 'respuesta en 24h',
    altText: 'edificio',
    hashtags: [],
    llamadaAccion: 'Solicita una cotización',
    urlObjetivo: '',
    metadatos: { idioma: 'es' },
    instruccionesVisuales: '',
    duracionEstimadaSeg: 0,
    afirmaciones: [],
    advertencias: [],
    activosRequeridos: [],
    estado: 'adaptada',
    motivoBloqueo: null,
    procedencia: 'prompt:x',
    ...over,
  };
}

describe('Dominio de la fábrica de contenido', () => {
  it('clasifica afirmaciones por procedencia y bloquea las prohibidas / no sustentadas', () => {
    expect(puedePresentarseComoHecho('hecho_confirmado')).toBe(true);
    expect(puedePresentarseComoHecho('propuesta_creativa')).toBe(false);
    expect(afirmacionBloquea({ id: '1', texto: 'x', tipo: 'prohibida', fuente: 'f', confianza: 0, politicaAplicable: null, riesgo: 'alto', estado: 'pendiente' })).toBe(true);
    expect(afirmacionBloquea({ id: '2', texto: 'x', tipo: 'no_sustentada', fuente: 'f', confianza: 0, politicaAplicable: null, riesgo: 'medio', estado: 'pendiente' })).toBe(true);
    expect(afirmacionBloquea({ id: '3', texto: 'x', tipo: 'declarada_empresa', fuente: 'f', confianza: 0.7, politicaAplicable: null, riesgo: 'bajo', estado: 'validada' })).toBe(false);
  });

  it('un brief incompleto NO inventa: queda incompleto con los faltantes visibles', () => {
    expect(validarBrief(briefBase()).completo).toBe(true);
    const v = validarBrief(briefBase({ propuestaValor: '', productoServicio: '' }));
    expect(v.completo).toBe(false);
    expect(v.faltantes).toContain('propuestaValor');
    expect(v.faltantes).toContain('productoServicio');
  });

  it('respeta las máquinas de estado (brief, pieza, adaptación)', () => {
    expect(transicionBriefValida('evaluando', 'listo')).toBe(true);
    expect(transicionBriefValida('listo', 'evaluando')).toBe(false);
    expect(transicionPiezaValida('en_validacion', 'valida')).toBe(true);
    expect(transicionPiezaValida('valida', 'generando')).toBe(false);
    expect(transicionAdaptacionValida('validando', 'lista')).toBe(true);
    expect(transicionAdaptacionValida('lista', 'pendiente')).toBe(false);
  });

  it('la validación produce HALLAZGOS estructurados y detecta la afirmación prohibida (bloqueante)', () => {
    const ctx: ContextoValidacion = { brief: briefBase(), marca: null, afirmacionesProhibidas: ['oferta imperdible'], canalesAutorizados: ['blog'] };
    const limpia = validarAdaptacion(adaptacionBase(), ctx);
    expect(hayBloqueante(limpia)).toBe(false);
    const sucia = validarAdaptacion(adaptacionBase({ cuerpo: 'Oferta imperdible: mantención confiable con respuesta en 24h' }), ctx);
    const prohibida = sucia.find((h) => h.codigo === 'afirmacion.prohibida');
    expect(prohibida).toBeDefined();
    expect(prohibida?.bloqueante).toBe(true);
    expect(corregiblesAutomaticamente(sucia).length).toBeGreaterThan(0);
  });

  it('los perfiles de canal existen y la huella del paquete es determinista', () => {
    expect(esCanal('meta_ads')).toBe(true);
    expect(esCanal('youtube')).toBe(false);
    expect(perfilCanal('meta_ads')?.esPagado).toBe(true);
    const pieza: PiezaFuente = { version: 1, tituloInterno: 't', tesis: '', estructura: [], mensaje: 'm', cuerpo: 'cuerpo', llamadaAccion: 'cta', hechosUtilizados: [], afirmaciones: [], referencias: [], supuestos: [], advertencias: [], idioma: 'es', procedencia: '', estado: 'valida' };
    const a = adaptacionBase();
    expect(huellaPaquete(pieza, [a])).toBe(huellaPaquete(pieza, [a]));
  });
});
