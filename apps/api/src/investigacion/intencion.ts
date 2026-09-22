/**
 * apps/api · INVESTIGACIÓN AUTÓNOMA · intención de búsqueda y candidatos a exclusión.
 *
 * REGLAS REPRODUCIBLES, no opiniones. Cada clasificación dice con qué patrón coincidió, de modo que se puede
 * auditar, discutir y mejorar. Nada de esto necesita un modelo de lenguaje; el día que lo necesite, entrará por
 * el puerto `ReasoningProvider` y su salida seguirá siendo `ASSUMED`, no una medición.
 *
 * DOS ERRORES QUE ESTE ARCHIVO EVITA A PROPÓSITO:
 *
 *  1. Confundir una palabra con una intención. «precio implante dental» es alguien evaluando comprar —intención
 *     COMERCIAL—, no basura por contener «precio». Excluir esa búsqueda sería tirar al cliente más cercano a la
 *     decisión.
 *  2. Convertir una sospecha en una exclusión. Un candidato a negativa NO es una negativa activa: lleva su
 *     motivo y su evidencia, y quien decide es una persona. Y si una restricción («no atendemos Fonasa») no está
 *     persistida, no se asume: sin ese dato, no hay candidato derivado de ella.
 */
import type { RestriccionNegocio } from '../negocio/negocio-pg';
import {
  normalizarTermino,
  raicesDeTexto,
  type Confianza,
  type ElegibilidadTermino,
  type IntencionBusqueda,
  type MetodoClasificacion,
} from './investigacion-tipos';

export interface ContextoClasificacion {
  /** Nombres de las ofertas del negocio, tal como las declaró. */
  readonly ofertas: readonly string[];
  /** Comunas o ciudades del territorio comercial. */
  readonly localidades: readonly string[];
  /** Localidades EXCLUIDAS explícitamente (ámbito `EXCLUSION`). */
  readonly localidadesExcluidas: readonly string[];
  readonly restricciones: readonly RestriccionNegocio[];
  /** Nombre comercial del negocio: sirve para detectar búsquedas de marca. */
  readonly marca: string;
}

export interface Clasificacion {
  readonly intencion: IntencionBusqueda;
  readonly metodo: MetodoClasificacion;
  readonly confianza: Confianza;
  /** Con qué coincidió. Sin esto, la clasificación no se puede auditar. */
  readonly evidencia: string;
  /** Oferta con la que el término se relaciona, si alguna. */
  readonly ofertaRelacionada: string | null;
}

/** Palabras que delatan búsqueda de EMPLEO. Gana sobre cualquier otra intención: no es un cliente. */
const EMPLEO = ['trabajo', 'trabajos', 'empleo', 'empleos', 'vacante', 'vacantes', 'curriculum', 'cv', 'sueldo', 'salario', 'postular', 'practica profesional', 'se busca'];

/** Búsqueda de FORMACIÓN: quiere aprender el oficio, no contratarlo. */
const EDUCACION = ['curso', 'cursos', 'carrera', 'estudiar', 'diplomado', 'magister', 'universidad', 'capacitacion', 'certificacion', 'tutorial', 'como ser', 'como hacerse'];

/** Búsqueda INFORMATIVA: quiere entender algo. Puede ser futuro cliente, pero hoy no compra. */
const INFORMACION = ['que es', 'que son', 'como', 'por que', 'para que', 'sintomas', 'cuidados', 'significado', 'pdf', 'wikipedia', 'diferencia entre', 'tipos de'];

/** Acción explícita de contratar o comprar. */
const TRANSACCION = ['comprar', 'contratar', 'agendar', 'pedir hora', 'reservar', 'reserva', 'cotizar', 'cotizacion', 'solicitar', 'pedir presupuesto', 'online'];

/** Señales de evaluación comercial: compara, pregunta precio, busca un proveedor. */
const COMERCIAL = ['precio', 'precios', 'valor', 'valores', 'cuanto cuesta', 'cuanto vale', 'costo', 'costos', 'presupuesto', 'mejor', 'mejores', 'recomendado', 'bueno', 'buena', 'barato', 'economico', 'opiniones'];

/** Señales de proximidad: quiere resolverlo cerca. */
const LOCALIDAD_GENERICA = ['cerca de mi', 'cerca', 'a domicilio', 'en mi ciudad'];

/** Señales de navegación a un sitio o app concretos. */
const NAVEGACION = ['iniciar sesion', 'login', 'inicio de sesion', 'app', 'www', 'sitio web', '.cl', '.com'];

const contiene = (t: string, palabras: readonly string[]): string | null =>
  palabras.find((p) => t === p || t.includes(` ${p}`) || t.startsWith(`${p} `) || t.includes(`${p} `) || t.endsWith(` ${p}`)) ?? null;

/**
 * Oferta con la que se relaciona un término, comparando RAÍCES: «implante dental» y «Implantes dentales» son lo
 * mismo para un cliente, y tratarlos como distintos dejaría fuera del plan justo las búsquedas que más valen.
 *
 * Se elige la MEJOR oferta, no la primera que coincida. Con ofertas que comparten una palabra genérica
 * («Implantes dentales» y «Prótesis dental» comparten «dental»), quedarse con la primera mandaría
 * «prótesis dental Curicó» al grupo de implantes: el anuncio no correspondería a la búsqueda y la otra oferta
 * parecería no tener demanda. Gana la que comparte más palabras y, a igualdad, la que queda mejor cubierta.
 */
function ofertaRelacionada(termino: string, ofertas: readonly string[]): string | null {
  const raices = new Set(raicesDeTexto(termino));
  let mejor: { oferta: string; coincidencias: number; cobertura: number } | null = null;
  for (const oferta of ofertas) {
    const propias = raicesDeTexto(oferta);
    if (propias.length === 0) continue;
    const coincidencias = termino.includes(normalizarTermino(oferta))
      ? propias.length // el término contiene el nombre completo de la oferta
      : propias.filter((p) => raices.has(p)).length;
    if (coincidencias === 0) continue;
    const cobertura = coincidencias / propias.length;
    const gana = mejor === null
      || coincidencias > mejor.coincidencias
      || (coincidencias === mejor.coincidencias && cobertura > mejor.cobertura);
    if (gana) mejor = { oferta, coincidencias, cobertura };
  }
  return mejor?.oferta ?? null;
}

/**
 * Palabras significativas de una restricción. «no atendemos Fonasa» ⇒ `fonasa`: lo que NO se puede afirmar se
 * convierte en algo que tampoco conviene comprar. Se ignoran las palabras vacías y las negaciones.
 */
export function terminosDeRestriccion(texto: string): readonly string[] {
  const vacias = new Set(['no', 'ni', 'nunca', 'atendemos', 'atiende', 'ofrecemos', 'ofrece', 'hacemos', 'hace', 'tenemos', 'tiene', 'somos', 'es', 'son', 'con', 'sin', 'para', 'por', 'del', 'las', 'los', 'una', 'uno', 'que', 'nos', 'ningun', 'ninguna', 'convenio', 'convenios']);
  return normalizarTermino(texto)
    .split(' ')
    .filter((p) => p.length > 3 && !vacias.has(p))
    .slice(0, 6);
}

/**
 * Clasifica un término. El ORDEN de las reglas es la parte importante: empleo y formación ganan porque quien
 * busca trabajo o estudiar no es cliente, y la relación con la oferta se evalúa antes de llamar a algo
 * irrelevante.
 */
export function clasificarIntencion(terminoOriginal: string, ctx: ContextoClasificacion): Clasificacion {
  const t = normalizarTermino(terminoOriginal);
  const oferta = ofertaRelacionada(t, ctx.ofertas);
  const base = { metodo: 'RULES_V1' as MetodoClasificacion, ofertaRelacionada: oferta };

  const empleo = contiene(t, EMPLEO);
  if (empleo !== null) return { ...base, intencion: 'EMPLOYMENT', confianza: 'HIGH', evidencia: `contiene «${empleo}» (búsqueda de empleo)` };

  const educacion = contiene(t, EDUCACION);
  if (educacion !== null) return { ...base, intencion: 'EDUCATIONAL', confianza: 'HIGH', evidencia: `contiene «${educacion}» (quiere formarse, no contratar)` };

  // Restricción declarada por el negocio: lo que no se puede afirmar tampoco conviene comprar.
  for (const r of ctx.restricciones) {
    if (r.tipo !== 'PROHIBITED_CLAIM' && r.tipo !== 'RESTRICTION') continue;
    const claves = terminosDeRestriccion(r.texto);
    const coincidencia = claves.find((c) => t.includes(c));
    if (coincidencia !== undefined) {
      return { ...base, intencion: 'IRRELEVANT', confianza: 'HIGH', evidencia: `coincide con una restricción declarada: «${r.texto}»` };
    }
  }

  // Territorio excluido explícitamente.
  const excluida = ctx.localidadesExcluidas.find((l) => t.includes(normalizarTermino(l)));
  if (excluida !== undefined) {
    return { ...base, intencion: 'IRRELEVANT', confianza: 'HIGH', evidencia: `menciona un territorio excluido: «${excluida}»` };
  }

  const marca = normalizarTermino(ctx.marca);
  if (marca.length > 3 && t.includes(marca)) {
    return { ...base, intencion: 'NAVIGATIONAL', confianza: 'HIGH', evidencia: 'contiene el nombre del propio negocio' };
  }
  const navegacion = contiene(t, NAVEGACION);
  if (navegacion !== null) return { ...base, intencion: 'NAVIGATIONAL', confianza: 'MEDIUM', evidencia: `contiene «${navegacion}»` };

  const transaccion = contiene(t, TRANSACCION);
  if (transaccion !== null) return { ...base, intencion: 'TRANSACTIONAL', confianza: 'HIGH', evidencia: `contiene «${transaccion}» (acción de contratar o comprar)` };

  const localidad = ctx.localidades.find((l) => t.includes(normalizarTermino(l))) ?? null;
  const localGenerica = contiene(t, LOCALIDAD_GENERICA);
  if ((localidad !== null || localGenerica !== null) && oferta !== null) {
    return {
      ...base,
      intencion: 'LOCAL',
      confianza: 'HIGH',
      evidencia: localidad !== null ? `menciona «${localidad}», dentro del territorio del negocio` : `contiene «${localGenerica}»`,
    };
  }

  const comercial = contiene(t, COMERCIAL);
  if (comercial !== null && oferta !== null) {
    // «precio implante dental»: evaluar el precio de algo que SÍ se ofrece es intención comercial, no ruido.
    return { ...base, intencion: 'COMMERCIAL', confianza: 'HIGH', evidencia: `contiene «${comercial}» junto a la oferta «${oferta}»` };
  }
  if (comercial !== null) {
    return { ...base, intencion: 'COMMERCIAL', confianza: 'LOW', evidencia: `contiene «${comercial}», pero no se relaciona con ninguna oferta declarada` };
  }

  const informacion = contiene(t, INFORMACION);
  if (informacion !== null) return { ...base, intencion: 'INFORMATIONAL', confianza: 'MEDIUM', evidencia: `contiene «${informacion}»` };

  if (oferta !== null) {
    // Menciona lo que el negocio vende, sin más señales: comercial con confianza baja (no se infla).
    return { ...base, intencion: 'COMMERCIAL', confianza: 'LOW', evidencia: `menciona la oferta «${oferta}» sin otras señales` };
  }
  return { ...base, intencion: 'INFORMATIONAL', confianza: 'LOW', evidencia: 'sin señales reconocibles ni relación con la oferta declarada' };
}

export interface CandidatoNegativo {
  readonly termino: string;
  readonly motivo: string;
  /** Referencia a lo que lo justifica: una restricción persistida, un territorio excluido, la intención. */
  readonly evidencia: string;
}

export interface VeredictoTermino {
  readonly elegibilidad: ElegibilidadTermino;
  readonly motivoExclusion: string | null;
  readonly candidatoNegativo: CandidatoNegativo | null;
}

/**
 * Qué hacer con un término: candidato a comprar, candidato a EXCLUIR o para revisión humana.
 *
 * `CANDIDATE` ≠ activo, y `EXCLUDED` ≠ negativa aplicada: son propuestas con su justificación. Un término sin
 * relación con la oferta no se excluye a ciegas: se manda a revisión, porque quien conoce el negocio es el dueño.
 */
export function evaluarTermino(terminoOriginal: string, c: Clasificacion): VeredictoTermino {
  if (c.intencion === 'EMPLOYMENT' || c.intencion === 'EDUCATIONAL') {
    return {
      elegibilidad: 'EXCLUDED',
      motivoExclusion: c.evidencia,
      candidatoNegativo: { termino: terminoOriginal, motivo: c.intencion === 'EMPLOYMENT' ? 'busca empleo, no un servicio' : 'quiere formarse, no contratar', evidencia: c.evidencia },
    };
  }
  if (c.intencion === 'IRRELEVANT') {
    return {
      elegibilidad: 'EXCLUDED',
      motivoExclusion: c.evidencia,
      candidatoNegativo: { termino: terminoOriginal, motivo: 'incompatible con lo que el negocio declara', evidencia: c.evidencia },
    };
  }
  if (c.intencion === 'NAVIGATIONAL' && c.ofertaRelacionada === null) {
    return {
      elegibilidad: 'NEEDS_REVIEW',
      motivoExclusion: 'parece una búsqueda de otro sitio o marca',
      candidatoNegativo: null,
    };
  }
  if (c.ofertaRelacionada === null) {
    return { elegibilidad: 'NEEDS_REVIEW', motivoExclusion: 'no se relaciona con ninguna oferta declarada', candidatoNegativo: null };
  }
  if (c.intencion === 'INFORMATIONAL') {
    return { elegibilidad: 'NEEDS_REVIEW', motivoExclusion: 'intención informativa: puede traer visitas que aún no contratan', candidatoNegativo: null };
  }
  return { elegibilidad: 'CANDIDATE', motivoExclusion: null, candidatoNegativo: null };
}
