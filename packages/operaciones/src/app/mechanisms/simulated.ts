/**
 * Adaptador de inteligencia SIMULADA (Nivel C) — NO es un proveedor real de IA.
 *
 * Existe para demostrar la sustituibilidad del mecanismo: realiza el MISMO
 * contrato (`MecanismoOperacion`) por una vía distinta, conservando anatomía,
 * soberanía y anti-atrofia. Declara que "requiere salida de la organización" para
 * ejercitar la política de datos (el servicio la bloquea si debe permanecer interna).
 */
import type { RequestContext } from '@soec/contracts';
import type { ContextoMecanismo, MecanismoOperacion } from '../../domain/mechanism';
import type { ProductoIntelectual, TipoOperacion } from '../../domain/product';
import { abstener, baseProducto, construir } from '../product-builder';

export class MecanismoSimuladoIA implements MecanismoOperacion {
  readonly nombre = 'ia-simulada';
  readonly version = '0.1.0';
  readonly requiereSalidaDeOrg = true;

  soporta(_op: TipoOperacion): boolean {
    return true;
  }

  async ejecutar(_ctx: RequestContext, contexto: ContextoMecanismo): Promise<ProductoIntelectual> {
    const els = Object.values(contexto.eceState.elementos);
    if (els.length === 0) {
      return abstener(contexto, this, 'ausencia_critica', {
        faltante: ['el ECE no contiene elementos'],
        razones: ['sin comprensión disponible que operar'],
      });
    }
    const conteos = els.reduce<Record<string, number>>((acc, e) => {
      acc[e.tipo] = (acc[e.tipo] ?? 0) + 1;
      return acc;
    }, {});
    const evidencia = [...new Set(els.flatMap((e) => e.evidencia))];
    const faltante = els.filter((e) => e.noEvaluable).flatMap((e) => e.limitaciones);
    const base = baseProducto(contexto, this, {
      evidencia,
      faltante,
      limitaciones: ['producto simulado: estructura mínima verificable'],
      razones: [`síntesis simulada sobre ${els.length} elemento(s): ${JSON.stringify(conteos)}`],
      cuestionesJuicioHumano: ['la interpretación final corresponde a la persona'],
      incertidumbre: 'declarada por el mecanismo simulado',
    });
    // Estructura mínima por operación (mismo contrato que el determinístico).
    switch (contexto.operacion) {
      case 'esclarecer':
        return construir('esclarecer', base, {
          esclarecimiento: { elementoTipo: 'resumen', lados: [], relacionesExplicitas: Object.keys(conteos), contradiccionSinResolver: (conteos['contradiccion'] ?? 0) > 0 },
        });
      case 'detectar':
        return construir('detectar', base, {
          deteccion: { senales: (conteos['contradiccion'] ?? 0) > 0 ? [{ objeto: 'tensión', entradas: [], condiciones: [], incertidumbre: 'simulada', posibleFalsoPositivo: true, noEvaluable: false }] : [] },
        });
      case 'proyectar':
        return construir('proyectar', base, {
          proyeccion: { horizonte: contexto.horizonte ?? 'no declarado', estadoObservado: Object.keys(conteos), supuestos: ['modelo simulado'], factoresNoObservados: [], escenarios: [] },
        });
      case 'orientar':
        return construir('orientar', base, {
          orientacion: { asunto: contexto.proposito, consideraciones: [{ asunto: 'síntesis', razones: ['producto simulado'], consecuenciasConocidas: [] }], cuestionesReservadas: ['la decisión corresponde a la persona'], noVinculante: true },
        });
    }
  }
}
