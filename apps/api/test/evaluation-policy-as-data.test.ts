/**
 * Autonomy Fase C · POLÍTICA DE EVALUACIÓN COMO DATO — pruebas deterministas (sin base, sin red).
 *
 * Lo que se demuestra aquí:
 *  1. la completitud dice EXACTAMENTE qué falta, con motivo y con cómo se resuelve;
 *  2. un indicador sin meta no cuenta como configurado (una meta invisible no es una meta);
 *  3. el modelo de KPI sirve a una clínica, a un SaaS y a una tienda sin una rama por industria;
 *  4. la reconstrucción del perfil respeta la semántica de cada campo (y los límites nacen restrictivos);
 *  5. la política NO contiene ningún permiso: completarla no autoriza mutar ni gastar.
 */
import { describe, expect, it } from 'vitest';
import {
  construirPerfilDeEvaluacion,
  evaluarCompletitud,
  modeloDeEvaluacion,
  type DatosDePolitica,
} from '../src/politica/politica-perfil';
import type { EventoConversion, Kpi, PoliticaCompleta, PoliticaEvaluacion, ReglaEvaluacion } from '../src/politica/politica-pg';
import { politicaMigrations } from '../src/politica/politica-pg';
import type { PerfilNegocio } from '../src/negocio/negocio-pg';

const ORG = 'clinica-qa-a1b2c3';

const perfilNegocio = (over: Partial<PerfilNegocio> = {}): PerfilNegocio => ({
  organizationId: ORG,
  businessKey: 'bk',
  displayName: 'Clínica QA',
  legalName: null,
  businessType: 'CLINICA',
  description: null,
  website: null,
  country: 'CL',
  currency: 'CLP',
  timezone: 'America/Santiago',
  language: 'es',
  customerType: 'B2C',
  primaryObjective: 'más pacientes nuevos',
  status: 'ACTIVE',
  origen: 'UI',
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
  ...over,
});

const politicaBase = (over: Partial<PoliticaEvaluacion> = {}): PoliticaEvaluacion => ({
  organizationId: ORG,
  objectiveId: `obj-${ORG}`,
  objectiveText: null,
  businessContext: 'clínica odontológica: el resultado son contactos de pacientes',
  vocabulary: ['paciente', 'contacto'],
  evaluationHorizonDays: 30,
  authorizedSpendClp: null,
  maxBudgetVariationPct: 0.2,
  cooldownDays: 1,
  scalingRequiresApproval: true,
  protectedCampaigns: [],
  nonModifiableActivities: [],
  notes: null,
  origen: 'UI',
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
  ...over,
});

const evento = (eventKey: string, rol: EventoConversion['rol'] = 'PRIMARY', orden = 0): EventoConversion => ({
  organizationId: ORG, eventKey, rol, orden, displayName: null, nota: null,
});

const kpi = (over: Partial<Kpi> = {}): Kpi => ({
  organizationId: ORG,
  id: 'principal',
  rol: 'PRIMARY',
  clave: 'contactos',
  displayName: 'contactos conseguidos',
  tipo: 'EVENT_COUNT',
  unidad: 'COUNT',
  direccion: 'HIGHER_IS_BETTER',
  eventKey: 'whatsapp_intent',
  targetValue: 20,
  baselineValue: 0,
  tolerance: 0.2,
  estado: 'CONFIGURED',
  procedencia: 'USER_DEFINED',
  nota: null,
  orden: 0,
  ...over,
});

const regla = (over: Partial<ReglaEvaluacion> = {}): ReglaEvaluacion => ({
  organizationId: ORG,
  id: 'evidencia-impresiones',
  tipo: 'EVIDENCE_MINIMUM',
  metrica: 'IMPRESSIONS',
  comparador: 'GTE',
  valor: 1000,
  estado: 'CONFIGURED',
  procedencia: 'USER_DEFINED',
  nota: null,
  ...over,
});

const vacia: PoliticaCompleta = { politica: null, kpis: [], eventos: [], reglas: [], limites: null, canales: [] };

const datos = (politica: PoliticaCompleta, over: Partial<DatosDePolitica> = {}): DatosDePolitica => ({
  perfil: perfilNegocio(),
  politica,
  ...over,
});

describe('1 · completitud: dice qué falta y cómo se resuelve', () => {
  it('una empresa sin política declara los cinco requisitos que le faltan', () => {
    const c = evaluarCompletitud(datos(vacia));
    expect(c.estado).toBe('EVALUATION_PROFILE_INCOMPLETE');
    expect(c.faltantes.map((f) => f.campo)).toEqual([
      'primaryObjective', 'primaryConversionEvent', 'primaryKpi', 'successCriterion', 'evidenceMinimum',
    ]);
    for (const f of c.faltantes) {
      expect(f.motivo.length).toBeGreaterThan(10);
      expect(f.comoSeResuelve.length).toBeGreaterThan(10);
    }
    expect(c.actualizadoEn).toBeNull();
  });

  it('cada pieza que se añade retira su motivo, y con las cinco queda evaluable', () => {
    const conObjetivo = evaluarCompletitud(datos({ ...vacia, politica: politicaBase() }));
    expect(conObjetivo.faltantes.map((f) => f.campo)).not.toContain('primaryObjective');

    const conEvento = evaluarCompletitud(datos({ ...vacia, politica: politicaBase(), eventos: [evento('whatsapp_intent')] }));
    expect(conEvento.faltantes.map((f) => f.campo)).toEqual(['primaryKpi', 'successCriterion', 'evidenceMinimum']);

    const completa = evaluarCompletitud(datos({
      politica: politicaBase(), eventos: [evento('whatsapp_intent')], kpis: [kpi()], reglas: [regla()], limites: null, canales: [],
    }));
    expect(completa.estado).toBe('EVALUATION_PROFILE_COMPLETE');
    expect(completa.faltantes).toEqual([]);
    expect(completa.actualizadoEn).toBe('2026-09-21T10:00:00.000Z');
  });

  it('un indicador sin meta NO cuenta como configurado: una meta invisible no es una meta', () => {
    const sinMeta = evaluarCompletitud(datos({
      politica: politicaBase(), eventos: [evento('whatsapp_intent')],
      kpis: [kpi({ targetValue: null, estado: 'UNKNOWN' })], reglas: [regla()], limites: null, canales: [],
    }));
    expect(sinMeta.faltantes.map((f) => f.campo)).toEqual(['primaryKpi', 'successCriterion']);
  });

  it('una regla de éxito explícita también sirve como criterio, aunque el KPI no tenga meta', () => {
    const c = evaluarCompletitud(datos({
      politica: politicaBase(), eventos: [evento('whatsapp_intent')],
      kpis: [kpi()],
      reglas: [regla(), regla({ id: 'exito', tipo: 'SUCCESS', metrica: 'CONVERSIONS', valor: 15 })],
      limites: null, canales: [],
    }));
    expect(c.estado).toBe('EVALUATION_PROFILE_COMPLETE');
  });

  it('un mínimo de evidencia NOT_APPLICABLE no cuenta como declarado: haría falta al menos uno configurado', () => {
    const c = evaluarCompletitud(datos({
      politica: politicaBase(), eventos: [evento('whatsapp_intent')], kpis: [kpi()],
      reglas: [regla({ valor: null, estado: 'NOT_APPLICABLE' })], limites: null, canales: [],
    }));
    expect(c.faltantes.map((f) => f.campo)).toEqual(['evidenceMinimum']);
  });

  it('las recomendaciones no bloquean, pero se informan', () => {
    const c = evaluarCompletitud(datos(
      { politica: politicaBase({ evaluationHorizonDays: null }), eventos: [evento('whatsapp_intent')], kpis: [kpi()], reglas: [regla()], limites: null, canales: [] },
      { tieneTerritorio: false, tienePrioridadesDeOferta: false },
    ));
    expect(c.estado).toBe('EVALUATION_PROFILE_COMPLETE');
    expect(c.recomendaciones.map((r) => r.campo)).toEqual(
      expect.arrayContaining(['evaluationHorizon', 'secondaryKpi', 'channelRules', 'geographicScope', 'offerPriorities', 'pauseCriterion']),
    );
  });
});

describe('2 · el modelo de KPI sirve a industrias distintas sin ramas de código', () => {
  const casos = [
    {
      nombre: 'clínica · contactos por WhatsApp',
      tipoNegocio: 'CLINICA' as const,
      evento: 'whatsapp_intent',
      kpi: kpi({ clave: 'contactos', tipo: 'EVENT_COUNT', unidad: 'COUNT', direccion: 'HIGHER_IS_BETTER', targetValue: 20 }),
      modelo: 'SERVICIOS',
      indicador: 'contactos',
    },
    {
      nombre: 'clínica · costo por contacto (menos es mejor)',
      tipoNegocio: 'CLINICA' as const,
      evento: 'phone_intent',
      kpi: kpi({ id: 'cpa', clave: 'cpa', tipo: 'COST_PER', unidad: 'CURRENCY', direccion: 'LOWER_IS_BETTER', targetValue: 8000, eventKey: 'phone_intent' }),
      modelo: 'SERVICIOS',
      indicador: 'cpa',
    },
    {
      nombre: 'SaaS · demos solicitadas',
      tipoNegocio: 'SAAS' as const,
      evento: 'demo_requested',
      kpi: kpi({ id: 'demos', clave: 'demos', tipo: 'EVENT_COUNT', unidad: 'COUNT', targetValue: 10, eventKey: 'demo_requested' }),
      modelo: 'SAAS_FUNNEL',
      indicador: 'demos',
    },
    {
      nombre: 'e-commerce · ROAS',
      tipoNegocio: 'ECOMMERCE' as const,
      evento: 'purchase',
      kpi: kpi({ id: 'roas', clave: 'roas', tipo: 'RATIO', unidad: 'RATIO', direccion: 'HIGHER_IS_BETTER', targetValue: 3, eventKey: 'purchase' }),
      modelo: 'ECOMMERCE_DISTRIBUCION',
      indicador: 'roas',
    },
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      const d = datos(
        { politica: politicaBase(), eventos: [evento(caso.evento)], kpis: [caso.kpi], reglas: [regla()], limites: null, canales: [] },
        { perfil: perfilNegocio({ businessType: caso.tipoNegocio }) },
      );
      const perfil = construirPerfilDeEvaluacion(d);
      expect(perfil).not.toBeNull();
      expect(perfil!.modeloDeNegocio).toBe(caso.modelo);
      expect(perfil!.criterio.indicador).toBe(caso.indicador);
      expect(perfil!.criterio.meta).toBe(caso.kpi.targetValue);
      expect(perfil!.directorContext.conversionPrimaria).toBe(caso.evento);
    });
  }

  it('el mapeo tipo de negocio → modelo de evaluación es total y estable', () => {
    expect(modeloDeEvaluacion('SAAS')).toBe('SAAS_FUNNEL');
    expect(modeloDeEvaluacion('ECOMMERCE')).toBe('ECOMMERCE_DISTRIBUCION');
    expect(modeloDeEvaluacion('CLINICA')).toBe('SERVICIOS');
    expect(modeloDeEvaluacion('LOCAL')).toBe('SERVICIOS');
    expect(modeloDeEvaluacion('OTRO')).toBe('SERVICIOS');
  });
});

describe('3 · reconstrucción del perfil: semántica de cada campo', () => {
  const completa: PoliticaCompleta = {
    politica: politicaBase(),
    eventos: [evento('whatsapp_intent'), evento('appointment_intent', 'SECONDARY', 1), evento('phone_intent', 'SECONDARY', 2)],
    kpis: [kpi()],
    reglas: [
      regla(),
      regla({ id: 'pausa', tipo: 'PAUSE', metrica: 'CONVERSION_RATE', comparador: 'LTE', valor: 0.005 }),
      regla({ id: 'escalamiento', tipo: 'ESCALATION', metrica: 'CONVERSION_RATE', valor: 0.05 }),
    ],
    limites: {
      organizationId: ORG, maxDailyBudgetClp: 5000, maxCpcClp: 900, maxVariationPct: 0.15,
      maxChangesPerDay: 2, cooldownHours: 72, minTermImpressionsForNegative: 30,
      irrelevancePatterns: [], updatedAt: '2026-09-21T10:00:00.000Z',
    },
    canales: [],
  };

  it('el criterio, la política de optimización y el embudo salen de los datos', () => {
    const p = construirPerfilDeEvaluacion(datos(completa))!;
    expect(p.objetivoId).toBe(`obj-${ORG}`);
    expect(p.criterio).toEqual({ objetivoId: `obj-${ORG}`, indicador: 'contactos', lineaBase: 0, meta: 20, tolerancia: 0.2, muestraMinima: 1000 });
    expect(p.policy).toEqual({
      muestraMinima: 1000, umbralPausaTasaConversion: 0.005, umbralEscalamiento: 0.05,
      variacionMaxPresupuesto: 0.2, cooldownDias: 1, campaniasProtegidas: [], actividadesNoModificables: [],
      escalamientoRequiereAprobacion: true,
    });
    expect(p.directorContext.conversionPrimaria).toBe('whatsapp_intent');
    expect(p.directorContext.conversionesSecundarias).toEqual(['appointment_intent', 'phone_intent']);
    expect(p.gastoAutorizado).toBeNull(); // null = SOEC observa, no es la autoridad del presupuesto
  });

  it('sin patrones de irrelevancia la clave NO se declara: ninguna negativa automática (fail-closed)', () => {
    const p = construirPerfilDeEvaluacion(datos(completa))!;
    expect('politicaIrrelevancia' in p.limitesAutonomia).toBe(false);
    const conPatrones = construirPerfilDeEvaluacion(datos({
      ...completa, limites: { ...completa.limites!, irrelevancePatterns: ['software'] },
    }))!;
    expect(conPatrones.limitesAutonomia.politicaIrrelevancia).toEqual(['software']);
  });

  it('sin límites declarados los topes quedan en 0: el valor MÁS restrictivo, no el más permisivo', () => {
    const p = construirPerfilDeEvaluacion(datos({ ...completa, limites: null }))!;
    expect(p.limitesAutonomia).toEqual({
      presupuestoMaxDiarioCLP: 0, cpcTechoMaxCLP: 0, variacionMaxPct: 0,
      maxCambiosPorDia: 0, cooldownHoras: 0, muestraMinimaNegativaImpresiones: 0,
    });
  });

  it('una política incompleta NO produce perfil a medias: devuelve null', () => {
    expect(construirPerfilDeEvaluacion(datos(vacia))).toBeNull();
    expect(construirPerfilDeEvaluacion(datos({ ...completa, kpis: [] }))).toBeNull();
    expect(construirPerfilDeEvaluacion(datos({ ...completa, reglas: [] }))).toBeNull();
  });
});

describe('4 · frontera con el gobierno: la política no autoriza nada', () => {
  it('el esquema de la política no contiene ningún permiso de mutación, gasto o ejecución', () => {
    const sql = politicaMigrations.map((m) => m.sql).join('\n');
    for (const prohibido of ['external_mutations', 'autonomous_spend', 'campaign_execution', 'automatic_safety_pause']) {
      expect(sql).not.toContain(prohibido);
    }
    // Y tampoco guarda métricas observadas: no hay columnas de resultados medidos.
    for (const prohibido of ['observed_', 'measured_', 'actual_ctr', 'snapshot']) {
      expect(sql).not.toContain(prohibido);
    }
  });

  it('el perfil reconstruido no expone ninguna autorización: sólo objetivo, criterio, política y topes', () => {
    const p = construirPerfilDeEvaluacion(datos({
      politica: politicaBase(), eventos: [evento('whatsapp_intent')], kpis: [kpi()], reglas: [regla()], limites: null, canales: [],
    }))!;
    expect(Object.keys(p).sort()).toEqual([
      'criterio', 'cuentasExternas', 'directorContext', 'externalResourceRefs', 'gastoAutorizado',
      'limitesAutonomia', 'modeloDeNegocio', 'objetivoId', 'organizationId', 'policy',
    ]);
  });
});
