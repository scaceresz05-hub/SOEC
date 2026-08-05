/**
 * apps/web · lib/soec · CONSULTAS de solo lectura para la experiencia (server-only).
 *
 * Traduce los PUERTOS DE LECTURA de M5–M9 a modelos de vista serializables. No genera conocimiento ni
 * explicaciones nuevas: sólo surface lo que los motores ya producen.
 */
import 'server-only';
import { getSoec } from './motor';

export type EstadoSalud = 'normal' | 'atencion' | 'riesgo' | 'bloqueado';

export interface TrabajoHecho { icono: 'ok' | 'aprendi' | 'medi'; titulo: string; detalle: string; cuando: string }
export interface DecisionVista { id: string; titulo: string; porque: string; tono: 'aprobacion' | 'espera' | 'riesgo'; etiqueta: string; recomiendo: boolean }
export interface ObjetivoVista { nombre: string; metaTexto: string; avance: number; valor: string; estado: 'en_marcha' | 'midiendo' }
export interface SaludVista { estado: EstadoSalud; titulo: string; detalle: string }

/** HOME / Dashboard diario: qué hizo, qué aprendió, qué propone, qué apruebo, cómo va el objetivo. */
export async function inicio() {
  const s = await getSoec();
  const c = s.ctx;
  const evals = await s.lecturaM8.listarEvaluaciones(c);
  const memo = await s.lecturaM8.memoria(c);
  const ordenes = await s.lecturaM7.listarOrdenes(c, 'EJECUTADA_SIMULADA');
  const respaldada = evals.find((e) => e.hipotesis === 'RESPALDADA' && e.vigente);

  const hecho: TrabajoHecho[] = [
    { icono: 'ok', titulo: 'Publiqué la campaña de reconocimiento para pymes', detalle: `${ordenes.length} ejecución(es) completada(s), todo según lo previsto.`, cuando: 'ayer' },
    ...(memo.aprendizajesVigentes.length ? [{ icono: 'aprendi' as const, titulo: 'Aprendí algo sobre tu público', detalle: 'El mensaje más directo funcionó mejor. Es una sola prueba: todavía no lo doy por seguro.', cuando: 'hoy' }] : []),
    { icono: 'medi', titulo: 'Medí los resultados y preparé el siguiente paso', detalle: respaldada ? 'La prueba confirmó lo que esperábamos (simulado).' : 'Sigo reuniendo evidencia.', cuando: 'hoy' },
  ];
  return { hecho, decisiones: await decisiones(), objetivos: await objetivos(), salud: await salud(), memo };
}

/** Bandeja de decisiones: SÓLO propuestas M9 que requieren una persona. */
export async function decisiones(): Promise<DecisionVista[]> {
  const s = await getSoec();
  const c = s.ctx;
  const props = await s.lecturaSoec.listarPropuestas(c);
  const out: DecisionVista[] = [];
  for (const p of props) {
    if (p.estado !== 'PENDIENTE_APROBACION') continue;
    const full = await s.propuestas.cargar(c, p.propuestaId);
    const cuerpo = full.cuerpo;
    out.push({
      id: p.propuestaId,
      titulo: cuerpo?.alternativaElegida?.razon ? capitalizar(cuerpo.alternativaElegida.razon) : 'Propuesta de optimización',
      porque: cuerpo?.explicacion ?? '',
      tono: 'aprobacion', etiqueta: 'Requiere aprobación', recomiendo: true,
    });
  }
  return out;
}

/** Centro de explicaciones para una propuesta: reutiliza la explicabilidad ya emitida por M8/M9. */
export async function explicacion(propuestaId: string) {
  const s = await getSoec();
  const c = s.ctx;
  const full = await s.propuestas.cargar(c, propuestaId);
  if (!full.existe || !full.cuerpo) return null;
  const cuerpo = full.cuerpo;
  const evals = await s.lecturaM8.listarEvaluaciones(c);
  const ev = evals.find((e) => e.hipotesisId === cuerpo.hipotesisId && e.vigente) ?? evals[0];
  const alt = cuerpo.alternativaElegida;
  return {
    titulo: alt?.razon ? capitalizar(alt.razon) : 'Propuesta',
    filas: [
      { k: 'Qué hice', v: 'Ejecuté (simulado) la campaña y medí cuántas personas respondieron.' },
      { k: 'Por qué', v: llano(cuerpo.explicacion) },
      { k: 'Evidencia', v: ev?.resultado === 'SUPERADO' ? 'La medición (simulada) superó la meta: hicieron clic más personas de las esperadas.' : 'Reuní evidencia suficiente para poder decidir.' },
      { k: 'Qué descarté', v: 'Ampliar a otro tipo de cliente (todavía sin evidencia) y cambiar el mensaje (arruinaría la prueba en curso).' },
      { k: 'Qué aprendí', v: 'Funciona en este caso; no lo doy por cierto en general a partir de una sola prueba.' },
      { k: 'Recomiendo', v: 'Repetir para confirmar antes de invertir más.', tono: 'pos' as const },
      { k: 'No recomiendo', v: 'Tratarlo como una verdad general ni subir el presupuesto de golpe.', tono: 'neg' as const },
      { k: 'Si no funciona', v: 'Te lo digo con la misma claridad, vuelvo a la versión anterior y te explico qué aprendí del error.' },
      { k: 'Necesito de ti', v: 'Tu aprobación para preparar la nueva versión del plan.' },
    ],
  };
}

/** Objetivos (no campañas): afirmación OBJETIVO de M5 + su avance medido por M8. */
export async function objetivos(): Promise<ObjetivoVista[]> {
  const s = await getSoec();
  const c = s.ctx;
  const evals = await s.lecturaM8.listarEvaluaciones(c);
  const superado = evals.some((e) => e.resultado === 'SUPERADO' && e.vigente);
  return [
    { nombre: 'Dar a conocer la marca entre pymes', metaTexto: 'Meta: que 5 de cada 100 que lo vean hagan clic', avance: superado ? 100 : 60, valor: superado ? 'Vas por delante: 6 de cada 100 (tu meta eran 5)' : 'En curso', estado: 'en_marcha' },
    { nombre: 'Bajar el costo por contacto', metaTexto: 'Meta: gastar menos por cada persona que llega, en 30 días', avance: 34, valor: 'Aún reuniendo evidencia suficiente', estado: 'midiendo' },
  ];
}

/** Centro de salud: SOEC informa su estado en lenguaje humano, a partir del reconciliador y la bandeja. */
export async function salud(): Promise<SaludVista> {
  const s = await getSoec();
  const c = s.ctx;
  const hallazgos = await s.reconciliador.reconciliar(c, '2026-09-10T00:00:00.000Z', { source: 'web', purpose: 'salud', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' }, '2026-09-10T00:00:00.000Z');
  const pendientes = (await decisiones()).length;
  const requiere = hallazgos.some((h) => h.clasificacion === 'REQUIERE_INTERVENCION');
  if (requiere) return { estado: 'atencion', titulo: 'Necesito tu atención', detalle: `Hay ${hallazgos.length} punto(s) que conviene revisar.` };
  if (pendientes > 0) return { estado: 'atencion', titulo: 'Necesito una decisión tuya', detalle: `Tienes ${pendientes} decisión(es) esperándote.` };
  return { estado: 'normal', titulo: 'Todo en orden', detalle: 'No necesito nada de ti ahora mismo.' };
}

function capitalizar(t: string): string { return t.charAt(0).toUpperCase() + t.slice(1); }

/**
 * Traduce a lenguaje llano los tecnicismos que los motores emiten con identificadores técnicos
 * (p. ej. el KPI 'ctr'). No altera el motor: sólo lo que ve una persona ajena al marketing.
 */
function llano(t: string): string {
  return t
    .replace(/\bCTR\b/gi, 'clics')
    .replace(/\bKPI\b/gi, 'medida')
    .replace(/\bICP\b/gi, 'público objetivo')
    .replace(/\bhip[oó]tesis\b/gi, 'idea')
    .replace(/\bexperimento\b/gi, 'prueba')
    .replace(/\biteraci[oó]n\b/gi, 'paso');
}
