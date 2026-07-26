/**
 * @soec/rubros · dominio · validación de una biblioteca de rubro.
 *
 * Comprueba integridad estructural sin conocer ninguna instancia: IDs únicos
 * dentro del rubro (criterio 6), integridad referencial de estrategias, coherencia
 * regulatoria (una regla RATIFIED no puede estar pendiente de verificación) y que
 * las preguntas diagnósticas no estén vacías.
 */
import type { RubroKnowledge } from './tipos';
import { todasLasEntradas } from './tipos';

export interface ErrorValidacion {
  readonly codigo: string;
  readonly mensaje: string;
  readonly id?: string;
}

export interface ValidacionRubro {
  readonly valido: boolean;
  readonly errores: readonly ErrorValidacion[];
}

export function validarBiblioteca(d: RubroKnowledge): ValidacionRubro {
  const errores: ErrorValidacion[] = [];

  // IDs únicos dentro del rubro.
  const vistos = new Set<string>();
  for (const e of todasLasEntradas(d)) {
    if (vistos.has(e.id)) {
      errores.push({
        codigo: 'id_duplicado',
        id: e.id,
        mensaje: `ID duplicado dentro del rubro: ${e.id}`,
      });
    }
    vistos.add(e.id);
  }

  // Integridad referencial: toda estrategia atiende objetivos existentes.
  const objIds = new Set(d.objetivos.map((o) => o.id));
  for (const est of d.estrategias) {
    for (const a of est.atiende) {
      if (!objIds.has(a)) {
        errores.push({
          codigo: 'referencia_invalida',
          id: est.id,
          mensaje: `${est.id} atiende un objetivo inexistente: ${a}`,
        });
      }
    }
  }

  // Coherencia regulatoria: RATIFIED exige verificación VERIFIED.
  for (const r of d.regulatorio) {
    if (r.estado === 'RATIFIED' && r.verificacion === 'PENDING_LEGAL_REVIEW') {
      errores.push({
        codigo: 'regulatorio_incoherente',
        id: r.id,
        mensaje: `${r.id} está RATIFIED pero su verificación jurídica sigue pendiente`,
      });
    }
  }

  // Producto: las preguntas diagnósticas no pueden estar vacías.
  const preguntas = new Set<string>();
  for (const p of d.producto) {
    if (p.clave === 'preguntas_diagnosticas') {
      if (!p.preguntas || p.preguntas.length === 0) {
        errores.push({
          codigo: 'preguntas_vacias',
          id: p.id,
          mensaje: `${p.id} no declara preguntas diagnósticas`,
        });
      }
      for (const q of p.preguntas ?? []) preguntas.add(q);
    }
  }

  // Señales: su pregunta debe existir entre las preguntas diagnósticas.
  const senalIds = new Set(d.senales.map((s) => s.id));
  for (const s of d.senales) {
    if (!preguntas.has(s.preguntaId)) {
      errores.push({
        codigo: 'senal_sin_pregunta',
        id: s.id,
        mensaje: `${s.id} referencia una pregunta inexistente`,
      });
    }
  }

  // Mapeos: señal, objetivo y estrategia deben existir (objetivo, además, RATIFIED).
  const estrIds = new Set(d.estrategias.map((e) => e.id));
  const objRatificados = new Set(
    d.objetivos.filter((o) => o.estado === 'RATIFIED').map((o) => o.id),
  );
  for (const m of d.mapeos) {
    if (!senalIds.has(m.senalId))
      errores.push({
        codigo: 'mapeo_senal_invalida',
        id: m.id,
        mensaje: `${m.id} referencia señal inexistente ${m.senalId}`,
      });
    if (!objRatificados.has(m.objetivoId))
      errores.push({
        codigo: 'mapeo_objetivo_invalido',
        id: m.id,
        mensaje: `${m.id} referencia un objetivo inexistente o no RATIFIED: ${m.objetivoId}`,
      });
    if (!estrIds.has(m.estrategiaId))
      errores.push({
        codigo: 'mapeo_estrategia_invalida',
        id: m.id,
        mensaje: `${m.id} referencia estrategia inexistente ${m.estrategiaId}`,
      });
  }

  return { valido: errores.length === 0, errores };
}

export class BibliotecaInvalidaError extends Error {
  readonly errores: readonly ErrorValidacion[];
  constructor(errores: readonly ErrorValidacion[]) {
    super('Biblioteca de rubro inválida: ' + errores.map((e) => e.mensaje).join('; '));
    this.name = 'BibliotecaInvalidaError';
    this.errores = errores;
  }
}
