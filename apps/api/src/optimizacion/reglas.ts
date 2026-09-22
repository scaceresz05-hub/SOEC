/**
 * apps/api · OPTIMIZACIÓN AUTÓNOMA · motor de decisiones (funciones PURAS y reproducibles).
 *
 * DETERMINISTA PRIMERO. Ninguna decisión de este archivo necesita un modelo de lenguaje: todas se explican con
 * una regla, un umbral declarado por la empresa y unos números observados. El día que una capacidad exija
 * razonamiento generativo entrará por el puerto `ReasoningProvider` (Fase E) y su salida será una PROPUESTA,
 * nunca una medición ni una orden.
 *
 * LOS TRES ERRORES QUE ESTE ARCHIVO EVITA A PROPÓSITO:
 *
 *  1. **Pausar por «0 conversiones».** Una palabra sin conversiones puede no haber tenido tiempo, puede estar
 *     dentro del retardo de atribución o puede tener la medición rota. Se exige gasto improductivo POR ENCIMA
 *     del criterio que la empresa declaró, clics suficientes y medición sana.
 *  2. **Negativizar «precio», «valor» o «cuotas» por regla genérica.** Quien busca precio está evaluando
 *     comprar. Sólo se excluye lo que es de otra intención (empleo, formación) o lo que choca con algo que la
 *     empresa declaró que NO puede afirmar.
 *  3. **Perseguir el ruido.** Un cambio menor que la banda muerta no es una mejora: es una oscilación. Con
 *     cooldown, delta mínimo y memoria del último cambio, SOEC no entra en el bucle +10 % / −10 %.
 */
import type { RestriccionNegocio } from '../negocio/negocio-pg';
import type { PoliticaCompleta } from '../politica/politica-pg';
import { terminosDeRestriccion } from '../investigacion/intencion';
import { clasificarIntencion } from '../investigacion/intencion';
import type { SnapshotObservacion } from './optimizacion-pg';
import {
  DEADBAND_PORCENTUAL,
  RIESGO_BASE,
  normalizar,
  type AccionOptimizacion,
  type MetricasObservadas,
  type NivelRiesgo,
} from './optimizacion-tipos';

/** Una decisión propuesta, todavía sin identidad ni persistencia. */
export interface Propuesta {
  readonly accion: AccionOptimizacion;
  readonly objetivo: { readonly tipo: 'CAMPAIGN' | 'AD_GROUP' | 'KEYWORD' | 'SEARCH_TERM' | 'BUDGET'; readonly id: string | null; readonly nombre: string };
  readonly estadoActual: string;
  readonly estadoPropuesto: string;
  readonly evidenciaRefs: readonly string[];
  readonly politicaRefs: readonly string[];
  readonly efectoEsperado: string;
  readonly riesgo: NivelRiesgo;
  readonly confianza: 'ALTA' | 'MEDIA' | 'BAJA';
  readonly reversible: boolean;
  readonly motivo: string;
  readonly impactoMaximoClp: number | null;
}

export interface ContextoDecision {
  readonly snapshot: SnapshotObservacion;
  readonly politica: PoliticaCompleta;
  readonly restricciones: readonly RestriccionNegocio[];
  /** Nombres de los servicios del negocio: sirven para saber si un término es de su rubro. */
  readonly ofertas: readonly string[];
  readonly localidades: readonly string[];
  readonly marca: string;
  /** Permite decidir por conversiones. Si es `false`, las reglas que dependen de ellas no se aplican. */
  readonly permiteDecisionesDeConversion: boolean;
  /** Tope diario que autoriza el mandato humano (CLP/día). Ninguna propuesta puede superarlo. */
  readonly topeDiarioMandatoClp: number | null;
  /** Negativas ya aplicadas: no se vuelven a proponer. */
  readonly negativasExistentes: readonly string[];
  /** Cambios recientes por palanca, para la histéresis: `{ 'ADJUST_DAILY_BUDGET': {hace: horas, deltaPct} }`. */
  readonly cambiosRecientes: Readonly<Record<string, { readonly horas: number; readonly deltaPct: number | null }>>;
  readonly ahora: string;
}

const pct = (a: number, b: number): number => (b === 0 ? 0 : ((a - b) / b) * 100);

/** Umbral declarado por la empresa para una regla concreta (Fase C). Sin él, la regla NO se aplica. */
function umbral(politica: PoliticaCompleta, tipo: string, metrica?: string): { valor: number; id: string } | null {
  const r = politica.reglas.find((x) => x.tipo === tipo && (metrica === undefined || x.metrica === metrica) && x.valor !== null);
  return r === undefined || r.valor === null ? null : { valor: Number(r.valor), id: r.id };
}

// ── 1. SEGURIDAD: gasto sin resultado por encima del criterio declarado ─────────────────────────

/**
 * Pausa de seguridad de la campaña. Es la única acción que REDUCE exposición, y por eso se propone incluso
 * cuando otras no pueden. Exige el criterio de PAUSA que la empresa declaró: no hay un umbral inventado aquí.
 */
export function proponerPausaDeSeguridad(c: ContextoDecision): Propuesta | null {
  const u = umbral(c.politica, 'PAUSE');
  if (u === null) return null;
  const m = c.snapshot.campania;
  if (m.spend === null || m.spend < u.valor) return null;
  // Si hay conversiones, no es una campaña improductiva: no se pausa por gasto.
  if (m.conversions !== null && m.conversions > 0) return null;
  // Sin medición sana no se puede afirmar «cero conversiones»: sería pausar por un dato que no existe.
  if (!c.permiteDecisionesDeConversion) return null;
  if (c.snapshot.campania.estado === 'PAUSED') return null;

  return {
    accion: 'PAUSE_CAMPAIGN',
    objetivo: { tipo: 'CAMPAIGN', id: c.snapshot.campaignId, nombre: 'tu campaña' },
    estadoActual: 'ENABLED',
    estadoPropuesto: 'PAUSED',
    evidenciaRefs: [`snapshot:${c.snapshot.id}`],
    politicaRefs: [`regla:${u.id}`],
    efectoEsperado: 'dejar de gastar mientras se revisa por qué no llegan resultados',
    riesgo: RIESGO_BASE.PAUSE_CAMPAIGN,
    confianza: 'ALTA',
    reversible: true,
    motivo: `la campaña lleva ${Math.round(m.spend)} gastados sin una sola conversión, y tu criterio de pausa es ${u.valor}`,
    impactoMaximoClp: 0, // pausar no puede costar dinero
  };
}

// ── 2. NEGATIVAS: sólo lo que es de otra intención o choca con lo declarado ─────────────────────

export function proponerNegativas(c: ContextoDecision): readonly Propuesta[] {
  const yaExcluidas = new Set(c.negativasExistentes.map(normalizar));
  const ctx = {
    ofertas: c.ofertas, localidades: c.localidades, localidadesExcluidas: [],
    restricciones: c.restricciones, marca: c.marca,
  };
  const salida: Propuesta[] = [];

  for (const t of c.snapshot.terminos) {
    const clave = normalizar(t.termino);
    if (yaExcluidas.has(clave)) continue;
    if (t.clicks === null || t.clicks < 1) continue; // sin ni un clic, no hay gasto que evitar
    const clasificacion = clasificarIntencion(t.termino, ctx);

    // Sólo se excluye lo que NO es un cliente posible: empleo, formación o algo incompatible con lo declarado.
    const excluible = clasificacion.intencion === 'EMPLOYMENT' || clasificacion.intencion === 'EDUCATIONAL' || clasificacion.intencion === 'IRRELEVANT';
    if (!excluible) continue;
    // Si convirtió, no se toca: la realidad gana sobre la regla.
    if (t.conversions !== null && t.conversions > 0) continue;

    const conflicto = c.restricciones.find((r) => (r.tipo === 'PROHIBITED_CLAIM' || r.tipo === 'RESTRICTION')
      && terminosDeRestriccion(r.texto).some((k) => clave.includes(k)));

    salida.push({
      accion: 'ADD_NEGATIVE_KEYWORD',
      objetivo: { tipo: 'SEARCH_TERM', id: null, nombre: t.termino },
      estadoActual: 'recibe clics',
      estadoPropuesto: 'excluida',
      evidenciaRefs: [`snapshot:${c.snapshot.id}`, `termino:${clave}`],
      politicaRefs: conflicto === undefined ? ['reglas:intencion-v1'] : [`restriccion:${conflicto.id}`],
      efectoEsperado: `dejar de pagar por «${t.termino}», que ${clasificacion.intencion === 'EMPLOYMENT' ? 'busca empleo' : clasificacion.intencion === 'EDUCATIONAL' ? 'quiere formarse' : 'no corresponde a lo que ofreces'}`,
      riesgo: RIESGO_BASE.ADD_NEGATIVE_KEYWORD,
      confianza: clasificacion.confianza === 'HIGH' ? 'ALTA' : clasificacion.confianza === 'MEDIUM' ? 'MEDIA' : 'BAJA',
      reversible: true,
      motivo: conflicto === undefined
        ? `«${t.termino}» recibió ${t.clicks} clic(s) y ${clasificacion.evidencia}`
        : `«${t.termino}» choca con algo que declaraste: «${conflicto.texto}»`,
      impactoMaximoClp: t.spend === null ? null : Math.round(t.spend),
    });
  }
  return salida;
}

// ── 3. PAUSA DE PALABRA: nunca por «0 conversiones» a secas ─────────────────────────────────────

/**
 * Propone dejar de pujar por una palabra. Exige TODO a la vez: gasto improductivo por encima del criterio de
 * la empresa, clics suficientes para que la ausencia de conversiones signifique algo, y medición sana.
 */
export function proponerPausaDePalabras(c: ContextoDecision): readonly Propuesta[] {
  if (!c.permiteDecisionesDeConversion) return [];
  const u = umbral(c.politica, 'PAUSE');
  if (u === null) return [];
  const minClics = Math.max(10, Math.round((umbral(c.politica, 'EVIDENCE_MINIMUM', 'CLICKS')?.valor ?? 0)));

  return c.snapshot.palabras
    .filter((k) => k.estado !== 'PAUSED')
    .filter((k) => k.spend !== null && k.spend >= u.valor)
    .filter((k) => k.clicks !== null && k.clicks >= minClics)
    .filter((k) => k.conversions !== null && k.conversions === 0)
    .map((k) => ({
      accion: 'PAUSE_KEYWORD' as const,
      objetivo: { tipo: 'KEYWORD' as const, id: k.criterionId, nombre: k.texto },
      estadoActual: 'ENABLED',
      estadoPropuesto: 'PAUSED',
      evidenciaRefs: [`snapshot:${c.snapshot.id}`, `keyword:${normalizar(k.texto)}`],
      politicaRefs: [`regla:${u.id}`],
      efectoEsperado: `dejar de gastar en «${k.texto}» y concentrar el presupuesto en lo que sí trae clientes`,
      riesgo: RIESGO_BASE.PAUSE_KEYWORD,
      confianza: 'MEDIA' as const,
      reversible: true,
      motivo: `«${k.texto}» lleva ${Math.round(k.spend!)} gastados con ${k.clicks} clics y ninguna conversión; tu criterio de pausa es ${u.valor}`,
      impactoMaximoClp: 0,
    }));
}

// ── 4. PRESUPUESTO: acotado, con banda muerta y techo del mandato ───────────────────────────────

export interface ResultadoPresupuesto {
  readonly propuesta: Propuesta | null;
  /** Cuando la subida se recorta por el mandato, se dice — no se silencia. */
  readonly recortadoPorMandato: boolean;
}

/**
 * Ajuste acotado del presupuesto diario. Subir exige resultados; bajar puede hacerse con menos ceremonia
 * porque reduce exposición. Nunca por encima del mandato, nunca sin límite, nunca por ruido.
 */
export function proponerAjusteDePresupuesto(c: ContextoDecision, maxCambioPct: number): ResultadoPresupuesto {
  const m = c.snapshot.campania;
  const actual = m.presupuestoDiarioMicros === null ? null : m.presupuestoDiarioMicros / 1_000_000;
  if (actual === null || actual <= 0 || maxCambioPct <= 0) return { propuesta: null, recortadoPorMandato: false };
  if (!c.permiteDecisionesDeConversion) return { propuesta: null, recortadoPorMandato: false };

  const exito = umbral(c.politica, 'SUCCESS');
  const reciente = c.cambiosRecientes.ADJUST_DAILY_BUDGET;
  const conversiones = m.conversions ?? 0;
  const cpa = m.cpa;

  // SUBIR: sólo si hay conversiones reales y el costo por resultado está dentro del criterio declarado.
  const vaBien = conversiones > 0 && exito !== null && cpa !== null && cpa <= exito.valor;
  // BAJAR: gasto con muy poco retorno, sin llegar a la pausa de seguridad.
  const vaMal = conversiones === 0 && m.spend !== null && exito !== null && m.spend >= exito.valor * 2;

  if (!vaBien && !vaMal) return { propuesta: null, recortadoPorMandato: false };

  // HISTÉRESIS: si el último cambio fue en sentido contrario y hace poco, no se oscila.
  if (reciente !== undefined && reciente.deltaPct !== null && reciente.horas < 72) {
    const mismoSentido = (vaBien && reciente.deltaPct > 0) || (vaMal && reciente.deltaPct < 0);
    if (!mismoSentido) return { propuesta: null, recortadoPorMandato: false };
  }

  const deseado = vaBien ? actual * (1 + maxCambioPct / 100) : actual * (1 - maxCambioPct / 100);
  const tope = c.topeDiarioMandatoClp;
  const acotado = vaBien && tope !== null ? Math.min(deseado, tope) : deseado;
  const recortado = vaBien && tope !== null && deseado > tope;
  const cambioPct = pct(acotado, actual);

  // BANDA MUERTA: un cambio menor que esto es ruido, no mejora.
  if (Math.abs(cambioPct) < DEADBAND_PORCENTUAL) {
    return { propuesta: null, recortadoPorMandato: recortado };
  }

  return {
    recortadoPorMandato: recortado,
    propuesta: {
      accion: 'ADJUST_DAILY_BUDGET',
      objetivo: { tipo: 'BUDGET', id: c.snapshot.campaignId, nombre: 'presupuesto diario' },
      estadoActual: `${Math.round(actual)} CLP/día`,
      estadoPropuesto: `${Math.round(acotado)} CLP/día`,
      evidenciaRefs: [`snapshot:${c.snapshot.id}`],
      politicaRefs: exito === null ? [] : [`regla:${exito.id}`],
      efectoEsperado: vaBien
        ? 'conseguir más clientes al mismo costo por resultado, mientras siga funcionando'
        : 'reducir el gasto mientras no haya resultados',
      riesgo: RIESGO_BASE.ADJUST_DAILY_BUDGET,
      confianza: 'MEDIA',
      reversible: true,
      motivo: vaBien
        ? `hay ${conversiones} conversión(es) con un costo por resultado de ${Math.round(cpa!)}, dentro de tu criterio de ${exito!.valor}${recortado ? `; la subida se recorta al tope autorizado de ${tope} CLP/día` : ''}`
        : `se gastaron ${Math.round(m.spend!)} sin conversiones: conviene bajar el ritmo antes de tener que pausar`,
      impactoMaximoClp: Math.round(Math.max(0, acotado - actual) * 30),
    },
  };
}

// ── 5. PRECIO POR VISITA (CPC máximo) ───────────────────────────────────────────────────────────

/**
 * Ajuste del techo de CPC. Sólo tiene sentido en estrategias que lo usan; cambiar de estrategia (a maximizar
 * conversiones, tCPA, tROAS) es otra decisión, con otra evidencia, y NO se hace automáticamente.
 */
export function proponerAjusteDeCpc(c: ContextoDecision, maxCambioPct: number, estrategia: string | null): Propuesta | null {
  if (maxCambioPct <= 0) return null;
  if (estrategia !== null && !/TARGET_SPEND|MANUAL_CPC|MAXIMIZE_CLICKS/i.test(estrategia)) return null;
  const m = c.snapshot.campania;
  if (m.cpc === null || m.clicks === null || m.clicks < 10) return null;
  const exito = umbral(c.politica, 'SUCCESS');
  if (exito === null || m.conversions === null) return null;

  // Sin conversiones y con CPC por encima de lo que el negocio puede pagar por resultado: bajar el techo.
  const caro = m.conversions === 0 && m.cpc > exito.valor / 10;
  if (!caro) return null;
  const nuevo = m.cpc * (1 - maxCambioPct / 100);
  if (Math.abs(pct(nuevo, m.cpc)) < DEADBAND_PORCENTUAL) return null;

  return {
    accion: 'ADJUST_MAX_CPC',
    objetivo: { tipo: 'CAMPAIGN', id: c.snapshot.campaignId, nombre: 'precio máximo por visita' },
    estadoActual: `${Math.round(m.cpc)} CLP por visita`,
    estadoPropuesto: `${Math.round(nuevo)} CLP por visita`,
    evidenciaRefs: [`snapshot:${c.snapshot.id}`],
    politicaRefs: [`regla:${exito.id}`],
    efectoEsperado: 'pagar menos por cada visita mientras se comprueba si convierten',
    riesgo: RIESGO_BASE.ADJUST_MAX_CPC,
    confianza: 'MEDIA',
    reversible: true,
    motivo: `cada visita cuesta ${Math.round(m.cpc)} y todavía no hay conversiones; tu criterio de éxito es ${exito.valor} por resultado`,
    impactoMaximoClp: 0,
  };
}

// ── ORQUESTACIÓN DE REGLAS ──────────────────────────────────────────────────────────────────────

export interface EntradaMotor extends ContextoDecision {
  readonly maxCambioPresupuestoPct: number;
  readonly maxCambioCpcPct: number;
  readonly estrategiaPuja: string | null;
}

/**
 * Corre todas las reglas en orden de importancia: primero lo que reduce riesgo, después lo que mejora. El
 * resultado es una lista de propuestas explicables; decidir cuáles se pueden aplicar es de la capa de gobierno.
 */
export function decidir(e: EntradaMotor): readonly Propuesta[] {
  const seguridad = proponerPausaDeSeguridad(e);
  if (seguridad !== null) return [seguridad]; // si hay que parar, no se discute nada más

  const presupuesto = proponerAjusteDePresupuesto(e, e.maxCambioPresupuestoPct);
  return [
    ...proponerNegativas(e),
    ...proponerPausaDePalabras(e),
    ...(presupuesto.propuesta === null ? [] : [presupuesto.propuesta]),
    ...(proponerAjusteDeCpc(e, e.maxCambioCpcPct, e.estrategiaPuja) === null ? [] : [proponerAjusteDeCpc(e, e.maxCambioCpcPct, e.estrategiaPuja)!]),
  ];
}

/** Compara métricas antes/después para juzgar una decisión ya aplicada. Sin datos ⇒ no se juzga. */
export function juzgarEfecto(antes: MetricasObservadas, despues: MetricasObservadas | null): 'IMPROVED' | 'DEGRADED' | 'INCONCLUSIVE' | 'NOT_ENOUGH_TIME' {
  if (despues === null) return 'NOT_ENOUGH_TIME';
  if (antes.conversions !== null && despues.conversions !== null && (antes.conversions > 0 || despues.conversions > 0)) {
    if (antes.cpa !== null && despues.cpa !== null) return despues.cpa < antes.cpa ? 'IMPROVED' : despues.cpa > antes.cpa ? 'DEGRADED' : 'INCONCLUSIVE';
    return despues.conversions > antes.conversions ? 'IMPROVED' : despues.conversions < antes.conversions ? 'DEGRADED' : 'INCONCLUSIVE';
  }
  if (antes.spend !== null && despues.spend !== null && antes.conversions === 0 && despues.conversions === 0) {
    // Sin conversiones en ninguno de los dos lados, gastar menos es mejor que gastar más.
    return despues.spend < antes.spend ? 'IMPROVED' : despues.spend > antes.spend ? 'DEGRADED' : 'INCONCLUSIVE';
  }
  return 'INCONCLUSIVE';
}
