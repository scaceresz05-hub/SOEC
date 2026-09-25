/**
 * Autonomy Fase G · OPTIMIZACIÓN AUTÓNOMA — pruebas deterministas (sin base, sin red).
 *
 * Lo que se demuestra aquí es, sobre todo, cuándo SOEC NO debe hacer nada:
 *  1. con poca evidencia, con datos viejos o con señales contradictorias, no se decide;
 *  2. una palabra no se pausa por «0 conversiones» a secas, y nunca con la medición enferma;
 *  3. «precio» no se excluye por contener la palabra precio: quien pregunta precio está evaluando comprar;
 *  4. el presupuesto no supera el mandato ni persigue el ruido (banda muerta, histéresis, cooldown);
 *  5. encender una campaña exige un permiso explícito — jamás se infiere del presupuesto ni del modo;
 *  6. la misma intención repetida es un NOOP, no un segundo cambio.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { evaluarEvidencia, minimoDeEvidencia } from '../src/optimizacion/evidencia';
import { ventanaDe } from '../src/optimizacion/observacion';
import { decidir, juzgarEfecto, proponerAjusteDeCpc, proponerAjusteDePresupuesto, proponerNegativas, proponerPausaDePalabras, proponerPausaDeSeguridad, type ContextoDecision, type Propuesta } from '../src/optimizacion/reglas';
import { gobernar, puedeActivarse, acotarPorMandato, type ContextoGobierno } from '../src/optimizacion/gobierno';
import { claveIdempotencia, numeroDe } from '../src/optimizacion/ejecutor-acciones';
import { derivar, RIESGO_BASE, type MetricasObservadas } from '../src/optimizacion/optimizacion-tipos';
import { POLITICA_AUTONOMIA_POR_DEFECTO, type DecisionOptimizacion, type PoliticaAutonomia, type SnapshotObservacion } from '../src/optimizacion/optimizacion-pg';
import type { PoliticaCompleta } from '../src/politica/politica-pg';
import type { RestriccionNegocio } from '../src/negocio/negocio-pg';
import type { Mandato } from '../src/accion/mandato';

const AQUI = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(AQUI, '..', 'src', rel), 'utf8');

const ORG = 'empresa-qa-optimizer';
const AHORA = '2026-09-22T12:00:00.000Z';

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const regla = (tipo: string, valor: number, metrica = 'IMPRESSIONS', id = `r-${tipo}`) => ({
  organizationId: ORG, id, tipo, metrica, comparador: 'GTE', valor, estado: 'DECLARED',
  procedencia: 'USER_DEFINED', nota: null,
} as unknown as PoliticaCompleta['reglas'][number]);

const politica = (reglas: PoliticaCompleta['reglas'] = [regla('EVIDENCE_MINIMUM', 1000), regla('PAUSE', 30_000, 'SPEND'), regla('SUCCESS', 25_000, 'CPA')]): PoliticaCompleta => ({
  politica: null, kpis: [], eventos: [], reglas, limites: null, canales: [],
});

const metricas = (over: Partial<MetricasObservadas> = {}): MetricasObservadas => ({
  ...derivar({ spend: 50_000, impressions: 5_000, clicks: 200, conversions: 0, conversionValue: null }),
  ...over,
});

const snapshot = (over: Partial<SnapshotObservacion> = {}): SnapshotObservacion => ({
  organizationId: ORG, id: 'snap-1', cicloId: 'ciclo-1', proveedor: 'GOOGLE_ADS', campaignId: '111',
  ventana: { desde: '2026-09-08', hasta: '2026-09-21', dias: 14 },
  campania: { ...metricas(), estado: 'ENABLED', presupuestoDiarioMicros: 10_000_000_000 },
  gruposAnuncio: [], palabras: [], terminos: [], anuncios: [],
  saludMedicion: 'HEALTHY', fuente: 'GOOGLE_ADS_API', datosHasta: '2026-09-21T23:59:59.000Z', observadoEn: AHORA,
  ...over,
});

const contexto = (over: Partial<ContextoDecision> = {}): ContextoDecision => ({
  snapshot: snapshot(), politica: politica(), restricciones: [], ofertas: ['Implantes dentales'],
  localidades: ['Curicó'], marca: 'Clínica QA', permiteDecisionesDeConversion: true,
  topeDiarioMandatoClp: 15_000, negativasExistentes: [], cambiosRecientes: {}, ahora: AHORA, ...over,
});

const mandato = (over: Partial<Mandato> = {}): Mandato => ({
  id: 'm1', organizationId: ORG, objective: 'captar', currency: 'CLP', authorizedBudgetMinor: 300_000, dailyCapMinor: null, provider: 'GOOGLE_ADS',
  spentMinor: 0, periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-12-01T00:00:00.000Z',
  allowedMetaAssets: [], allowedActionTypes: ['CREATE_CAMPAIGN'], status: 'AUTHORIZED', killSwitch: false,
  authorizedBy: 'duena@clinica.cl', authorizedAt: AHORA, createdAt: AHORA, version: 1, ...over,
});

const politicaAutonomia = (over: Partial<PoliticaAutonomia> = {}): PoliticaAutonomia => ({
  ...POLITICA_AUTONOMIA_POR_DEFECTO(ORG, AHORA),
  accionesPermitidas: ['PAUSE_CAMPAIGN', 'ADD_NEGATIVE_KEYWORD', 'PAUSE_KEYWORD', 'ADJUST_DAILY_BUDGET'],
  maxCambioPresupuestoPct: 10, maxCambioCpcPct: 10, maxCambiosPorDia: 3, cooldownHoras: 24, version: 1,
  ...over,
});

const gob = (over: Partial<ContextoGobierno> = {}): ContextoGobierno => ({
  modo: 'AUTONOMOUS', modoOperativo: 'AUTONOMOUS_REAL', politica: politicaAutonomia(), mandato: mandato(),
  capacidadEscritura: true, gobiernoExternalMutations: true, gobiernoCampaignExecution: true,
  killSwitchAbierto: true, lineaBaseConfirmada: true, cambiosHoy: 0, horasDesdeUltimoCambioDeLaPalanca: null, horaLocal: 12, ahora: AHORA,
  ...over,
});

// ── 1. PORTERO DE EVIDENCIA ─────────────────────────────────────────────────────────────────────

/**
 * SEGURIDAD DE LA LÍNEA BASE. «Todavía no sé qué número sería bueno» NO puede leerse como «cualquier resultado
 * es bueno»: mientras no haya meta, lo que sólo se puede juzgar contra una meta no se hace solo.
 */
describe('0 · sin meta aprendida, nada que dependa de la meta se decide solo', () => {
  const propuesta = (accion: Propuesta['accion'], over: Partial<Propuesta> = {}): Propuesta => ({
    accion,
    objetivo: { tipo: accion === 'ADD_NEGATIVE_KEYWORD' ? 'SEARCH_TERM' : 'CAMPAIGN', id: '900', nombre: 'campaña' },
    estadoActual: 'x', estadoPropuesto: 'y', evidenciaRefs: [], politicaRefs: [],
    efectoEsperado: 'x', riesgo: RIESGO_BASE[accion], confianza: 'MEDIA', reversible: true,
    motivo: 'prueba', impactoMaximoClp: 0,
    ...over,
  });

  const conTodo = {
    accionesPermitidas: ['PAUSE_CAMPAIGN', 'ADD_NEGATIVE_KEYWORD', 'ADJUST_DAILY_BUDGET', 'ADJUST_MAX_CPC', 'ENABLE_CAMPAIGN'] as Propuesta['accion'][],
    activacionAutonomaPermitida: true,
  };

  it.each(['ADJUST_DAILY_BUDGET', 'ADJUST_MAX_CPC', 'ENABLE_CAMPAIGN'] as const)(
    '%s espera a que exista la meta, y la decide una persona',
    (accion) => {
      const r = gobernar(propuesta(accion), gob({ lineaBaseConfirmada: false, politica: politicaAutonomia(conTodo) }));
      expect(r.puerta).toBe('ESPERANDO_LINEA_BASE');
      expect(r.veredicto).toBe('PEDIR_APROBACION');
      expect(r.motivo).toContain('meta');
    },
  );

  it('lo que reduce exposición sigue funcionando sin meta: pausar y negativizar', () => {
    for (const accion of ['PAUSE_CAMPAIGN', 'ADD_NEGATIVE_KEYWORD'] as const) {
      const r = gobernar(propuesta(accion), gob({ lineaBaseConfirmada: false, politica: politicaAutonomia(conTodo) }));
      expect(r.puerta, accion).not.toBe('ESPERANDO_LINEA_BASE');
    }
  });

  it('con la meta confirmada, subir presupuesto vuelve a estar dentro de lo autorizado', () => {
    const r = gobernar(propuesta('ADJUST_DAILY_BUDGET'), gob({ lineaBaseConfirmada: true, politica: politicaAutonomia(conTodo) }));
    expect(r.puerta).not.toBe('ESPERANDO_LINEA_BASE');
    expect(r.veredicto).toBe('EJECUTAR');
  });
});

describe('portero de evidencia', () => {
  const base = {
    politica: politica(), ventana: { desde: '2026-09-08', hasta: '2026-09-21', dias: 14 },
    metricas: metricas(), saludMedicion: 'HEALTHY' as const, datosHasta: '2026-09-21T23:59:59.000Z',
    ahora: AHORA, horasDesdeUltimoCambio: null,
  };

  /**
   * LA REGLA QUE USAN LOS FIXTURES DE LAS PRUEBAS PG, probada a cualquier hora del día.
   *
   * Aquellos fixtures escribían la fecha de las métricas a mano («2026-09-21») y, al cruzar la medianoche UTC,
   * sus datos pasaron a tener 49 horas: la evidencia caía a `STALE` y once pruebas empezaron a fallar sin que
   * nadie hubiera tocado el código. Ahora la derivan del reloj —el día que la ventana de observación toma como
   * cierre— y esto fija que esa derivación sirve SIEMPRE: a medianoche, a mediodía y en seis meses.
   *
   * No se cambia el umbral productivo de 48 h: se comprueba que el fixture vive holgadamente por debajo.
   */
  it('un fixture derivado del reloj nunca queda rancio, a ninguna hora ni en ninguna fecha', () => {
    const DIA = 86_400_000;
    const instantes: string[] = [];
    for (const dia of ['2026-09-23', '2026-12-31', '2027-03-01', '2028-02-29']) {
      for (const hora of [0, 1, 6, 12, 18, 23]) {
        instantes.push(`${dia}T${String(hora).padStart(2, '0')}:00:30.000Z`);
      }
    }

    for (const ahora of instantes) {
      // Exactamente lo que hace el fixture: la fecha de las métricas es el cierre de la ventana (ayer).
      const fechaMetricas = new Date(Date.parse(ahora) - DIA).toISOString().slice(0, 10);
      const ventana = ventanaDe(ahora, 14);
      expect(fechaMetricas, `la fecha de las métricas debe caer dentro de la ventana en ${ahora}`)
        .toBe(ventana.hasta);
      expect(fechaMetricas >= ventana.desde && fechaMetricas <= ventana.hasta).toBe(true);

      const r = evaluarEvidencia({
        ...base, ventana, datosHasta: `${fechaMetricas}T23:59:59.000Z`, ahora,
      });
      expect(r.veredicto, `en ${ahora} la evidencia no puede quedar rancia`).not.toBe('STALE');
      expect(r.veredicto).toBe('SUFFICIENT');
    }
  });

  it('con datos suficientes y medición sana, se puede decidir por conversiones', () => {
    const r = evaluarEvidencia(base);
    expect(r.veredicto).toBe('SUFFICIENT');
    expect(r.permiteDecisionesDeConversion).toBe(true);
    expect(r.minimoExigido).toEqual({ metrica: 'IMPRESSIONS', valor: 1000, procedencia: 'USER_DEFINED' });
  });

  it('por debajo del mínimo que declaró la empresa, NO se decide', () => {
    const r = evaluarEvidencia({ ...base, metricas: metricas({ impressions: 300 }) });
    expect(r.veredicto).toBe('INSUFFICIENT');
    expect(r.motivo).toContain('1000');
  });

  it('sin mínimo declarado no se optimiza: no se inventa un umbral', () => {
    const r = evaluarEvidencia({ ...base, politica: politica([]) });
    expect(r.veredicto).toBe('INSUFFICIENT');
    expect(r.motivo).toContain('no declaró');
    expect(minimoDeEvidencia(politica([]))).toBeNull();
  });

  it('con datos viejos del proveedor el veredicto es STALE', () => {
    const r = evaluarEvidencia({ ...base, datosHasta: '2026-09-15T00:00:00.000Z' });
    expect(r.veredicto).toBe('STALE');
  });

  it('conversiones sin clics es una contradicción: no se decide', () => {
    const r = evaluarEvidencia({ ...base, metricas: metricas({ clicks: 0, conversions: 3 }) });
    expect(r.veredicto).toBe('CONFLICTING');
  });

  it('el cooldown impide decidir antes de ver el efecto del último cambio', () => {
    const r = evaluarEvidencia({ ...base, horasDesdeUltimoCambio: 5, cooldownHoras: 24 });
    expect(r.veredicto).toBe('INSUFFICIENT');
    expect(r.motivo).toContain('todavía no se puede ver su efecto');
  });

  it('con la medición degradada hay evidencia de tráfico, pero NO para decidir por conversiones', () => {
    const r = evaluarEvidencia({ ...base, saludMedicion: 'DEGRADED' });
    expect(r.veredicto).toBe('SUFFICIENT');
    expect(r.permiteDecisionesDeConversion).toBe(false);
  });
});

// ── 2. REGLAS DETERMINISTAS ─────────────────────────────────────────────────────────────────────

describe('pausa de seguridad', () => {
  it('propone pausar cuando el gasto supera el criterio declarado sin ninguna conversión', () => {
    const p = proponerPausaDeSeguridad(contexto())!;
    expect(p.accion).toBe('PAUSE_CAMPAIGN');
    expect(p.riesgo).toBe('SAFETY');
    expect(p.impactoMaximoClp).toBe(0);
    expect(p.motivo).toContain('30000');
  });

  it('NO pausa si hay conversiones: la realidad gana sobre la regla', () => {
    expect(proponerPausaDeSeguridad(contexto({ snapshot: snapshot({ campania: { ...metricas({ conversions: 2 }), estado: 'ENABLED', presupuestoDiarioMicros: 10_000_000_000 } }) }))).toBeNull();
  });

  it('NO pausa con la medición enferma: «cero conversiones» no sería un dato, sería un hueco', () => {
    expect(proponerPausaDeSeguridad(contexto({ permiteDecisionesDeConversion: false }))).toBeNull();
  });

  it('sin criterio de pausa declarado, no hay pausa automática', () => {
    expect(proponerPausaDeSeguridad(contexto({ politica: politica([regla('EVIDENCE_MINIMUM', 1000)]) }))).toBeNull();
  });
});

describe('negativas', () => {
  const conTerminos = (terminos: { termino: string; clicks: number; conversions?: number; spend?: number }[]) =>
    contexto({
      snapshot: snapshot({
        campania: { ...metricas({ spend: 1000 }), estado: 'ENABLED', presupuestoDiarioMicros: 10_000_000_000 },
        terminos: terminos.map((t) => ({
          termino: t.termino, palabraQueLoDisparo: null,
          ...derivar({ spend: t.spend ?? 2000, impressions: 100, clicks: t.clicks, conversions: t.conversions ?? 0, conversionValue: null }),
        })),
      }),
    });

  it('«precio implante dental» NO se excluye: quien pregunta precio está evaluando comprar', () => {
    const ps = proponerNegativas(conTerminos([{ termino: 'precio implante dental', clicks: 5 }]));
    expect(ps).toHaveLength(0);
  });

  it('excluye búsquedas de empleo y de formación, con su motivo', () => {
    const ps = proponerNegativas(conTerminos([
      { termino: 'trabajo dentista curico', clicks: 3 },
      { termino: 'curso de implantes dentales', clicks: 2 },
    ]));
    expect(ps).toHaveLength(2);
    expect(ps.every((p) => p.accion === 'ADD_NEGATIVE_KEYWORD')).toBe(true);
    expect(ps[0]!.motivo).toContain('trabajo');
    expect(ps[0]!.riesgo).toBe('LOW_RISK');
  });

  it('excluye lo que choca con una restricción declarada, citándola', () => {
    const restricciones: RestriccionNegocio[] = [{ organizationId: ORG, id: 'r1', tipo: 'PROHIBITED_CLAIM', texto: 'No atendemos Fonasa', alcance: null }];
    const ps = proponerNegativas({ ...conTerminos([{ termino: 'implantes fonasa curico', clicks: 4 }]), restricciones });
    expect(ps).toHaveLength(1);
    expect(ps[0]!.motivo).toContain('No atendemos Fonasa');
    expect(ps[0]!.politicaRefs[0]).toContain('restriccion:');
  });

  it('un término que CONVIRTIÓ no se excluye aunque la regla lo señale', () => {
    const ps = proponerNegativas(conTerminos([{ termino: 'trabajo dentista curico', clicks: 3, conversions: 1 }]));
    expect(ps).toHaveLength(0);
  });

  it('no se propone lo que ya está excluido', () => {
    const c = conTerminos([{ termino: 'trabajo dentista curico', clicks: 3 }]);
    expect(proponerNegativas({ ...c, negativasExistentes: ['Trabajo Dentista Curico'] })).toHaveLength(0);
  });

  it('un término sin ni un clic no se excluye: no hay gasto que evitar', () => {
    expect(proponerNegativas(conTerminos([{ termino: 'trabajo dentista curico', clicks: 0 }]))).toHaveLength(0);
  });
});

describe('pausa de palabras', () => {
  const conPalabras = (palabras: { texto: string; spend: number; clicks: number; conversions: number }[]) =>
    contexto({
      snapshot: snapshot({
        palabras: palabras.map((k) => ({
          adGroupId: '1', criterionId: `c-${k.texto}`, texto: k.texto, concordancia: 'PHRASE', estado: 'ENABLED',
          cpcMaximoMicros: null,
          ...derivar({ spend: k.spend, impressions: 500, clicks: k.clicks, conversions: k.conversions, conversionValue: null }),
        })),
      }),
    });

  it('NO pausa por «0 conversiones» si el gasto no llega al criterio declarado', () => {
    expect(proponerPausaDePalabras(conPalabras([{ texto: 'implante dental', spend: 5_000, clicks: 40, conversions: 0 }]))).toHaveLength(0);
  });

  it('NO pausa si no hay clics suficientes, aunque el gasto sea alto', () => {
    expect(proponerPausaDePalabras(conPalabras([{ texto: 'implante dental', spend: 40_000, clicks: 3, conversions: 0 }]))).toHaveLength(0);
  });

  it('pausa cuando hay gasto improductivo por encima del criterio y clics suficientes', () => {
    const ps = proponerPausaDePalabras(conPalabras([{ texto: 'implante dental', spend: 40_000, clicks: 30, conversions: 0 }]));
    expect(ps).toHaveLength(1);
    expect(ps[0]!.accion).toBe('PAUSE_KEYWORD');
    expect(ps[0]!.motivo).toContain('ninguna conversión');
  });

  it('con la medición enferma NO se pausa ninguna palabra', () => {
    const c = { ...conPalabras([{ texto: 'implante dental', spend: 40_000, clicks: 30, conversions: 0 }]), permiteDecisionesDeConversion: false };
    expect(proponerPausaDePalabras(c)).toHaveLength(0);
  });
});

describe('presupuesto', () => {
  const conResultados = (conversions: number, cpa: number | null, spend = 50_000) =>
    contexto({
      snapshot: snapshot({
        campania: {
          ...derivar({ spend, impressions: 5000, clicks: 200, conversions, conversionValue: null }),
          ...(cpa === null ? {} : { cpa }),
          estado: 'ENABLED', presupuestoDiarioMicros: 10_000_000_000,
        } as SnapshotObservacion['campania'],
      }),
    });

  it('sube un máximo del porcentaje autorizado cuando el costo por resultado está dentro del criterio', () => {
    const r = proponerAjusteDePresupuesto(conResultados(4, 12_000), 10);
    expect(r.propuesta?.accion).toBe('ADJUST_DAILY_BUDGET');
    expect(r.propuesta?.estadoPropuesto).toBe('11000 CLP/día');
    expect(r.propuesta?.riesgo).toBe('MEDIUM_RISK');
  });

  it('NUNCA supera el tope diario que permite el mandato, y lo dice', () => {
    const c = { ...conResultados(4, 12_000), topeDiarioMandatoClp: 10_400 };
    const r = proponerAjusteDePresupuesto(c, 10);
    expect(r.recortadoPorMandato).toBe(true);
    expect(r.propuesta).toBeNull(); // 10.400 sobre 10.000 es menos que la banda muerta ⇒ no se toca
  });

  it('baja el presupuesto cuando hay gasto sin resultados', () => {
    const r = proponerAjusteDePresupuesto(conResultados(0, null, 80_000), 10);
    expect(r.propuesta?.estadoPropuesto).toBe('9000 CLP/día');
    expect(r.propuesta?.motivo).toContain('sin conversiones');
  });

  it('BANDA MUERTA: un cambio menor al 5 % es ruido y no se propone', () => {
    expect(proponerAjusteDePresupuesto(conResultados(4, 12_000), 3).propuesta).toBeNull();
  });

  it('HISTÉRESIS: no se deshace un cambio reciente en sentido contrario', () => {
    const c = { ...conResultados(4, 12_000), cambiosRecientes: { ADJUST_DAILY_BUDGET: { horas: 10, deltaPct: -10 } } };
    expect(proponerAjusteDePresupuesto(c, 10).propuesta).toBeNull();
  });

  it('con la medición enferma no se toca el presupuesto', () => {
    const c = { ...conResultados(4, 12_000), permiteDecisionesDeConversion: false };
    expect(proponerAjusteDePresupuesto(c, 10).propuesta).toBeNull();
  });

  it('sin porcentaje autorizado no hay ajuste posible', () => {
    expect(proponerAjusteDePresupuesto(conResultados(4, 12_000), 0).propuesta).toBeNull();
  });
});

describe('precio por visita', () => {
  it('sólo ajusta el techo en estrategias que lo usan', () => {
    const c = contexto({ snapshot: snapshot({ campania: { ...derivar({ spend: 60_000, impressions: 4000, clicks: 20, conversions: 0, conversionValue: null }), estado: 'ENABLED', presupuestoDiarioMicros: 10_000_000_000 } }) });
    expect(proponerAjusteDeCpc(c, 10, 'MAXIMIZE_CONVERSIONS')).toBeNull();
    const p = proponerAjusteDeCpc(c, 10, 'TARGET_SPEND');
    expect(p?.accion).toBe('ADJUST_MAX_CPC');
    expect(p?.efectoEsperado).toContain('pagar menos');
  });

  it('no cambia la ESTRATEGIA de puja automáticamente: eso es otra decisión', () => {
    const fuente = src('optimizacion/reglas.ts');
    expect(fuente).not.toContain('biddingStrategyType:');
    expect(fuente).toContain('cambiar de estrategia');
  });
});

describe('orquestación', () => {
  it('si hay que parar, no se discute nada más', () => {
    const ps = decidir({ ...contexto(), maxCambioPresupuestoPct: 10, maxCambioCpcPct: 10, estrategiaPuja: 'TARGET_SPEND' });
    expect(ps).toHaveLength(1);
    expect(ps[0]!.accion).toBe('PAUSE_CAMPAIGN');
  });

  it('sin nada que hacer devuelve la lista vacía (y eso es un final sano)', () => {
    const tranquilo = contexto({
      snapshot: snapshot({ campania: { ...derivar({ spend: 5_000, impressions: 3000, clicks: 100, conversions: 2, conversionValue: null }), estado: 'ENABLED', presupuestoDiarioMicros: 10_000_000_000 } }),
      politica: politica([regla('EVIDENCE_MINIMUM', 1000), regla('PAUSE', 30_000, 'SPEND')]),
    });
    expect(decidir({ ...tranquilo, maxCambioPresupuestoPct: 0, maxCambioCpcPct: 0, estrategiaPuja: null })).toHaveLength(0);
  });
});

// ── 3. GOBIERNO ─────────────────────────────────────────────────────────────────────────────────

const propuestaNegativa = { ...proponerNegativas(contexto({
  snapshot: snapshot({ terminos: [{ termino: 'trabajo dentista curico', palabraQueLoDisparo: null, ...derivar({ spend: 2000, impressions: 100, clicks: 3, conversions: 0, conversionValue: null }) }] }),
}))[0]! };

describe('gobierno de las decisiones', () => {
  it('en modo SOMBRA nunca se ejecuta: se registra qué se habría hecho', () => {
    const r = gobernar(propuestaNegativa, gob({ modo: 'SHADOW' }));
    expect(r.veredicto).toBe('SOLO_REGISTRAR');
  });

  it('en modo observación todo se propone y nada se aplica', () => {
    expect(gobernar(propuestaNegativa, gob({ modo: 'SUPERVISED', modoOperativo: 'PILOT' })).veredicto).toBe('PEDIR_APROBACION');
  });

  it('en modo supervisado todo espera a una persona', () => {
    expect(gobernar(propuestaNegativa, gob({ modo: 'SUPERVISED', modoOperativo: 'SUPERVISED_REAL' })).veredicto).toBe('PEDIR_APROBACION');
  });

  it('en automático ejecuta sólo lo que la política permite', () => {
    expect(gobernar(propuestaNegativa, gob()).veredicto).toBe('EJECUTAR');
    const sinPermiso = gob({ politica: politicaAutonomia({ accionesPermitidas: ['PAUSE_CAMPAIGN'] }) });
    expect(gobernar(propuestaNegativa, sinPermiso).veredicto).toBe('PEDIR_APROBACION');
  });

  it.each([
    ['el interruptor del despliegue', { killSwitchAbierto: false }, 'KILL_SWITCH'],
    ['la postura de la empresa', { gobiernoExternalMutations: false }, 'GOBIERNO_EMPRESA'],
    ['el permiso de escritura', { capacidadEscritura: false }, 'CAPACIDAD_ESCRITURA'],
  ])('%s bloquea la ejecución', (_caso, cambio, puerta) => {
    const r = gobernar(propuestaNegativa, gob(cambio as Partial<ContextoGobierno>));
    expect(r.veredicto).toBe('BLOQUEAR');
    expect(r.puerta).toBe(puerta);
  });

  it('el tope diario y el cooldown devuelven la decisión a una persona', () => {
    expect(gobernar(propuestaNegativa, gob({ cambiosHoy: 3 })).puerta).toBe('TOPE_DIARIO');
    expect(gobernar(propuestaNegativa, gob({ horasDesdeUltimoCambioDeLaPalanca: 2 })).puerta).toBe('COOLDOWN');
  });

  it('el horario autorizado se respeta', () => {
    const r = gobernar(propuestaNegativa, gob({ politica: politicaAutonomia({ horasPermitidas: [9, 10, 11] }), horaLocal: 23 }));
    expect(r.puerta).toBe('HORARIO');
  });

  it('un cambio que compromete más de lo que queda autorizado se BLOQUEA', () => {
    const cara = { ...propuestaNegativa, accion: 'ADJUST_DAILY_BUDGET' as const, impactoMaximoClp: 500_000 };
    const r = gobernar(cara, gob({ politica: politicaAutonomia({ accionesPermitidas: ['ADJUST_DAILY_BUDGET'] }) }));
    expect(r.veredicto).toBe('BLOQUEAR');
    expect(r.puerta).toBe('MANDATO_INSUFICIENTE');
  });

  it('sin mandato vigente, nada que comprometa gasto se ejecuta', () => {
    const cara = { ...propuestaNegativa, accion: 'ADJUST_DAILY_BUDGET' as const, impactoMaximoClp: 10_000 };
    for (const m of [null, mandato({ killSwitch: true }), mandato({ periodEnd: '2026-09-01T00:00:00.000Z' })]) {
      const r = gobernar(cara, gob({ mandato: m, politica: politicaAutonomia({ accionesPermitidas: ['ADJUST_DAILY_BUDGET'] }) }));
      expect(r.veredicto).toBe('BLOQUEAR');
    }
  });

  it('ENCENDER una campaña exige permiso EXPLÍCITO: el presupuesto no lo concede', () => {
    const encender = { ...propuestaNegativa, accion: 'ENABLE_CAMPAIGN' as const, riesgo: RIESGO_BASE.ENABLE_CAMPAIGN, impactoMaximoClp: 0 };
    const sinPermiso = gob({ politica: politicaAutonomia({ accionesPermitidas: ['ENABLE_CAMPAIGN'], activacionAutonomaPermitida: false }) });
    expect(gobernar(encender, sinPermiso).puerta).toBe('ACTIVACION_NO_AUTORIZADA');
    const conPermiso = gob({ politica: politicaAutonomia({ accionesPermitidas: ['ENABLE_CAMPAIGN'], activacionAutonomaPermitida: true }) });
    expect(gobernar(encender, conPermiso).veredicto).toBe('EJECUTAR');
  });

  it('el tope del mandato acota un presupuesto propuesto', () => {
    expect(acotarPorMandato(20_000, mandato({ authorizedBudgetMinor: 100_000 }), 10)).toEqual({ valor: 10_000, recortado: true });
    expect(acotarPorMandato(5_000, mandato({ authorizedBudgetMinor: 100_000 }), 10)).toEqual({ valor: 5_000, recortado: false });
  });
});

describe('activación de campaña', () => {
  const todo = {
    reconciliacionOk: true, medicionVerificada: true, mandatoVigente: true, requisitosEjecucionOk: true,
    conexionValida: true, capacidadEscritura: true, gobiernoExternalMutations: true, killSwitchAbierto: true,
  };

  it('con las ocho condiciones se puede encender', () => {
    expect(puedeActivarse(todo)).toEqual({ puede: true, faltan: [] });
  });

  it.each(Object.keys(todo))('sin %s no se puede encender', (clave) => {
    const r = puedeActivarse({ ...todo, [clave]: false });
    expect(r.puede).toBe(false);
    expect(r.faltan.length).toBeGreaterThan(0);
  });
});

// ── 4. IDEMPOTENCIA Y APRENDIZAJE ───────────────────────────────────────────────────────────────

describe('idempotencia', () => {
  const decision = (over: Partial<DecisionOptimizacion> = {}): DecisionOptimizacion => ({
    organizationId: ORG, id: 'd1', cicloId: 'c1', accion: 'ADD_NEGATIVE_KEYWORD',
    objetivo: { tipo: 'SEARCH_TERM', id: null, nombre: 'curso de implantes' },
    estadoActual: 'recibe clics', estadoPropuesto: 'excluida', evidenciaRefs: [], politicaRefs: [],
    efectoEsperado: 'x', riesgo: 'LOW_RISK', confianza: 'ALTA', reversible: true, motivo: 'x',
    impactoMaximoClp: null, creadoEn: AHORA, ...over,
  });

  it('la misma intención produce la misma clave', () => {
    expect(claveIdempotencia(decision(), '111')).toBe(claveIdempotencia(decision({ id: 'd2', cicloId: 'c2' }), '111'));
  });

  it('un estado propuesto distinto es otra intención', () => {
    const a = claveIdempotencia(decision({ accion: 'ADJUST_DAILY_BUDGET', estadoPropuesto: '11000 CLP/día' }), '111');
    const b = claveIdempotencia(decision({ accion: 'ADJUST_DAILY_BUDGET', estadoPropuesto: '12000 CLP/día' }), '111');
    expect(a).not.toBe(b);
  });

  it('la clave separa empresas y campañas', () => {
    expect(claveIdempotencia(decision(), '111')).not.toBe(claveIdempotencia(decision(), '222'));
    expect(claveIdempotencia(decision({ organizationId: 'otra' }), '111')).not.toBe(claveIdempotencia(decision(), '111'));
  });

  it('lee números de frases en lenguaje humano', () => {
    expect(numeroDe('11000 CLP/día')).toBe(11000);
    expect(numeroDe('$12.500 al día')).toBe(12500);
    expect(numeroDe('sin número')).toBeNull();
  });
});

describe('aprendizaje', () => {
  it('sin observación posterior no se juzga nada', () => {
    expect(juzgarEfecto(metricas(), null)).toBe('NOT_ENOUGH_TIME');
  });

  it('mejor costo por resultado es una mejora; peor, un empeoramiento', () => {
    const antes = derivar({ spend: 100_000, impressions: 1000, clicks: 100, conversions: 4, conversionValue: null });
    const mejor = derivar({ spend: 100_000, impressions: 1000, clicks: 100, conversions: 8, conversionValue: null });
    const peor = derivar({ spend: 200_000, impressions: 1000, clicks: 100, conversions: 2, conversionValue: null });
    expect(juzgarEfecto(antes, mejor)).toBe('IMPROVED');
    expect(juzgarEfecto(antes, peor)).toBe('DEGRADED');
  });

  it('sin conversiones en ninguno de los dos lados, gastar menos es mejor', () => {
    const antes = derivar({ spend: 100_000, impressions: 1000, clicks: 50, conversions: 0, conversionValue: null });
    const despues = derivar({ spend: 40_000, impressions: 500, clicks: 20, conversions: 0, conversionValue: null });
    expect(juzgarEfecto(antes, despues)).toBe('IMPROVED');
  });
});

// ── 5. ARQUITECTURA ─────────────────────────────────────────────────────────────────────────────

describe('arquitectura', () => {
  it('las decisiones son deterministas: ningún módulo del optimizador depende de un modelo de lenguaje', () => {
    for (const archivo of ['reglas.ts', 'evidencia.ts', 'gobierno.ts', 'optimizacion-service.ts', 'ejecutor-acciones.ts']) {
      const fuente = src(`optimizacion/${archivo}`);
      expect(fuente.toLowerCase()).not.toContain('openai');
      expect(fuente.toLowerCase()).not.toContain('anthropic');
      expect(fuente.toLowerCase()).not.toContain('gemini');
      expect(fuente).not.toMatch(/\bllm\b/i);
    }
  });

  it('una métrica ausente es null, nunca cero inventado', () => {
    const d = derivar({ spend: null, impressions: null, clicks: null, conversions: null, conversionValue: null });
    expect(Object.values(d).every((v) => v === null)).toBe(true);
    expect(derivar({ spend: 100, impressions: 0, clicks: 0, conversions: null, conversionValue: null }).ctr).toBeNull();
  });

  it('el optimizador usa el mismo transporte de la fase anterior: no hay un segundo camino de escritura', () => {
    const fuente = src('optimizacion/ejecutor-acciones.ts');
    expect(fuente).toContain('mutarGrafo');
    expect(fuente).not.toContain('fetch(');
    expect(fuente).not.toContain('googleads.googleapis.com');
  });

  it('el monitor de seguridad conserva su camino independiente', () => {
    const fuente = src('campana/stop-monitor.ts');
    expect(fuente).not.toContain('optimizacion/');
    expect(fuente).toContain('STOP_CAMPAIGN');
  });

  it('la política de autonomía no guarda dinero: el cuánto vive en el mandato', () => {
    const fuente = src('optimizacion/optimizacion-pg.ts');
    expect(fuente).toContain('El CUÁNTO es del mandato financiero');
    expect(fuente).not.toMatch(/authorized_budget|presupuesto_autorizado/);
  });
});
