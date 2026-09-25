/**
 * Autonomy Fase F · EJECUCIÓN DE CAMPAÑAS — pruebas deterministas (sin base, sin red).
 *
 * Lo que se demuestra aquí es, sobre todo, lo que NO puede pasar:
 *  1. ninguna campaña nace encendida — ni por defecto, ni por parámetro, ni por descuido (prueba de ARQUITECTURA);
 *  2. el presupuesto materializado jamás supera el mandato humano, y sin mandato no hay paquete;
 *  3. un texto que contradice lo que la empresa declaró bloquea la ejecución ANTES de publicar nada;
 *  4. los doce requisitos se evalúan siempre, con motivos, y basta uno para no intentar crear nada;
 *  5. una acción de conversión nunca se duplica: identidad estable y adopción de lo que ya existe;
 *  6. reintentar no crea una segunda campaña: se adopta la que hay, con cero escrituras;
 *  7. una medición «creada en Google» no es una medición verificada.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { materializarPaqueteGoogleAds, pujaGoogleDePaquete } from '../src/campana/google-ads-materializer';
import { construirPaquete, hashDePaquete, presupuestoDiarioDe, textosDelPaquete, type MaterialAprobado, type PaqueteDeEjecucion } from '../src/ejecucion/paquete';
import { validarClaims } from '../src/ejecucion/claims';
import { evaluarPrerrequisitos, puedeEjecutar, bloqueantes, type EntradaPrerrequisitos } from '../src/ejecucion/prerrequisitos';
import { asegurarAccionDeConversion, nombreExternoDe, tipoComercialDe, estadoDeMedicion, etiquetaDeSnippet, CONFIGURACION_GOOGLE } from '../src/ejecucion/conversiones';
import { compararConPaquete, ejecutarPaqueteGoogle, agruparRecursos, type CampaniaRemota } from '../src/ejecucion/ejecutor-google';
import { instalacionManual, fragmentoGoogle } from '../src/ejecucion/tracking';
import { EjecucionInvalidaError } from '../src/ejecucion/ejecucion-tipos';
import type { Mandato } from '../src/accion/mandato';
import type { GobiernoNegocio, OfertaNegocio, PerfilNegocio, RestriccionNegocio } from '../src/negocio/negocio-pg';
import type { GeoEjecutable } from '../src/investigacion/investigacion-pg';
import type { GrupoDelPlan, PlanCampania } from '../src/investigacion/plan-pg';

const AQUI = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(AQUI, '..', 'src', rel), 'utf8');

const ORG = 'empresa-qa-execution';
const AHORA = '2026-09-22T12:00:00.000Z';

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const perfil = (over: Partial<PerfilNegocio> = {}): PerfilNegocio => ({
  organizationId: ORG, businessKey: 'bk', displayName: 'Clínica QA', legalName: null, businessType: 'CLINICA',
  description: null, website: 'https://clinica-qa.example', country: 'CL', currency: 'CLP',
  timezone: 'America/Santiago', language: 'es', customerType: 'B2C', primaryObjective: 'conseguir pacientes',
  status: 'ACTIVE', origen: 'UI', createdAt: AHORA, updatedAt: AHORA, ...over,
});

const gobierno = (over: Partial<GobiernoNegocio> = {}): GobiernoNegocio => ({
  organizationId: ORG, externalMutations: true, autonomousSpend: false, automaticSafetyPause: true,
  campaignExecution: true, updatedAt: AHORA, ...over,
});

const oferta = (slug: string, name: string): OfertaNegocio => ({
  organizationId: ORG, id: `of-${slug}`, slug, name, description: null, category: null, status: 'ACTIVE',
  landingUrl: `https://clinica-qa.example/${slug}`, priority: 1, geographicScope: null,
  advertisingEligibility: 'ELIGIBLE', restrictions: [],
});

const plan = (over: Partial<PlanCampania> = {}): PlanCampania => ({
  organizationId: ORG, id: 'plan-v1-run1', version: 1, researchRunId: 'run1', estado: 'NON_EXECUTABLE',
  canal: 'GOOGLE_SEARCH', objetivo: 'conseguir pacientes', ofertas: ['implantes'],
  geografia: { targets: [{ nombre: 'Curicó', targetId: '1000341', tipo: 'CITY' }], noEjecutables: [], aproximaciones: [] },
  presupuesto: { techoDeclaradoClp: 300_000, modalidadTecho: 'MONTHLY', propuestoDiarioClp: 10_000, oportunidadDiariaClp: 20_000, costoPorClicEstimadoClp: 2_000, base: 'USER_CEILING', explicacion: 'tope del dueño' },
  puja: { estrategia: 'MAXIMIZE_CLICKS_WITH_CPC_CEILING', techoCpcClp: 2_000, justificacion: 'sin historial' },
  estructura: { tipo: 'UNA_CAMPANA_VARIOS_GRUPOS', justificacion: 'una oferta' },
  requisitosCreativos: ['RSA_REQUIRED'], requisitoConversion: 'CONVERSION_TRACKING_UNVERIFIED',
  prerequisitos: [], readiness: { RESEARCH_READY: true, LANDING_READY: true, MEASUREMENT_READY: false, BUDGET_READY: true, CREATIVE_READY: false, EXECUTION_READY: false },
  explicacion: [], creadoEn: AHORA, staleDesde: null, motivoStale: null, ...over,
});

const grupo = (over: Partial<GrupoDelPlan> = {}): GrupoDelPlan => ({
  organizationId: ORG, planId: 'plan-v1-run1', id: 'implantes', nombre: 'Implantes dentales', ofertaSlug: 'implantes',
  landing: 'https://clinica-qa.example/implantes',
  palabras: [
    { termino: 'implante dental curico', concordancia: 'EXACT', justificacion: 'intención local', volumenMensual: 320 },
    { termino: 'precio implante dental', concordancia: 'PHRASE', justificacion: 'intención comercial', volumenMensual: 210 },
  ],
  negativas: [{ termino: 'trabajo dentista', motivo: 'busca empleo' }],
  justificacion: '2 términos', ...over,
});

const geoEjecutable = (over: Partial<GeoEjecutable> = {}): GeoEjecutable => ({
  organizationId: ORG, id: 'geo-curico', runId: 'run1', solicitado: 'Curicó', disponible: true, targetId: '1000341',
  targetTipo: 'CITY', nombreCanonico: 'Curicó, Chile', aproximacion: false, riesgoDerrame: 'NONE', ...over,
});

const mandato = (over: Partial<Mandato> = {}): Mandato => ({
  id: 'mandato-1', organizationId: ORG, objective: 'captar pacientes', currency: 'CLP',
  authorizedBudgetMinor: 300_000, dailyCapMinor: null, provider: 'GOOGLE_ADS', spentMinor: 0, periodStart: '2026-09-01T00:00:00.000Z',
  periodEnd: '2026-10-01T00:00:00.000Z', allowedMetaAssets: [], allowedActionTypes: ['CREATE_CAMPAIGN'],
  status: 'AUTHORIZED', killSwitch: false, authorizedBy: 'duena@clinica.cl', authorizedAt: AHORA,
  createdAt: AHORA, version: 1, ...over,
});

const material = (over: Partial<MaterialAprobado> = {}): MaterialAprobado => ({
  ofertaSlug: 'implantes',
  titulares: ['Implantes dentales', 'Clínica en Curicó', 'Agenda tu evaluación'],
  descripciones: ['Rehabilitación oral con especialista.', 'Agenda tu hora por WhatsApp hoy mismo.'],
  sitelinks: [], callouts: [], ...over,
});

const paquete = (over: { plan?: PlanCampania; grupos?: readonly GrupoDelPlan[]; mandato?: Mandato; material?: readonly MaterialAprobado[]; geos?: readonly GeoEjecutable[] } = {}): PaqueteDeEjecucion =>
  construirPaquete({
    organizationId: ORG, perfil: perfil(), oferta: [oferta('implantes', 'Implantes dentales')],
    plan: over.plan ?? plan(), grupos: over.grupos ?? [grupo()], geos: over.geos ?? [geoEjecutable()],
    cuenta: { customerId: '1234567890', loginCustomerId: '9876543210' }, mandato: over.mandato ?? mandato(),
    conversiones: [{ eventKey: 'whatsapp_intent', externalId: '555', rol: 'PRIMARY' }],
    material: over.material ?? [material()], ahora: AHORA,
  });

// ── 1. ARQUITECTURA: nada nace encendido ────────────────────────────────────────────────────────

describe('arquitectura · CREAR ≠ ACTIVAR', () => {
  it('la campaña y sus grupos se materializan SIEMPRE en pausa', () => {
    const req = materializarPaqueteGoogleAds(paquete(), { validateOnly: false })!;
    const campania = req.mutateOperations.find((o) => 'campaignOperation' in o) as { campaignOperation: { create: Record<string, unknown> } };
    expect(campania.campaignOperation.create.status).toBe('PAUSED');
    const grupos = req.mutateOperations.filter((o) => 'adGroupOperation' in o) as Array<{ adGroupOperation: { create: Record<string, unknown> } }>;
    expect(grupos.length).toBeGreaterThan(0);
    for (const g of grupos) expect(g.adGroupOperation.create.status).toBe('PAUSED');
  });

  it('el tipo del paquete NO permite otro estado inicial que PAUSED', () => {
    const p = paquete();
    expect(p.estadoInicial).toBe('PAUSED');
    // El campo es un literal en el tipo: cualquier otro valor no compila. Se comprueba también en la fuente.
    expect(src('ejecucion/paquete.ts')).toContain("readonly estadoInicial: 'PAUSED'");
  });

  it('el materializador histórico también nace en pausa por defecto (no ENABLED)', () => {
    const fuente = src('campana/google-ads-materializer.ts');
    expect(fuente).toContain("status: opts.campaignStatus ?? 'PAUSED'");
    expect(fuente).not.toContain("status: opts.campaignStatus ?? 'ENABLED'");
  });

  it('ningún módulo de ejecución sabe encender una campaña', () => {
    for (const archivo of ['ejecucion-service.ts', 'ejecutor-google.ts', 'ejecucion-routes.ts', 'paquete.ts']) {
      const fuente = src(`ejecucion/${archivo}`);
      // Ni el verbo, ni el estado, ni la ruta.
      expect(fuente).not.toMatch(/status:\s*'ENABLED'\s*,?\s*\/\/?\s*campaign/i);
      expect(fuente.toLowerCase()).not.toContain('activarcampana');
      expect(fuente.toLowerCase()).not.toContain('enablecampaign');
    }
    expect(src('ejecucion/ejecucion-routes.ts')).not.toContain('activar');
  });

  it('el ejecutor usa el transporte atómico existente: no hay un segundo camino de escritura', () => {
    const fuente = src('ejecucion/ejecutor-google.ts');
    expect(fuente).toContain('materializarPaqueteGoogleAds');
    expect(fuente).toContain('mutarGrafo');
    // No construye peticiones HTTP por su cuenta.
    expect(fuente).not.toContain('fetch(');
    expect(fuente).not.toContain('googleads.googleapis.com');
  });
});

// ── 2. PAQUETE Y DINERO ─────────────────────────────────────────────────────────────────────────

describe('paquete congelado', () => {
  it('el presupuesto materializado es el MENOR entre el plan y el mandato', () => {
    // Mandato de 300.000 en 30 días ⇒ 10.000/día; el plan propone 10.000 ⇒ empatan.
    expect(presupuestoDiarioDe(plan(), mandato()).clp).toBe(10_000);
    // Si el plan pidiera más, manda el mandato.
    const caro = plan({ presupuesto: { ...plan().presupuesto, propuestoDiarioClp: 90_000 } });
    const r = presupuestoDiarioDe(caro, mandato());
    expect(r.clp).toBe(10_000);
    expect(r.origen).toBe('MANDATO');
    // Y jamás supera el tope autorizado en el período.
    expect(r.clp * 30).toBeLessThanOrEqual(mandato().authorizedBudgetMinor);
  });

  it('sin presupuesto autorizado suficiente no se construye paquete', () => {
    expect(() => paquete({ mandato: mandato({ authorizedBudgetMinor: 10 }) })).toThrow(EjecucionInvalidaError);
  });

  it('un grupo sin anuncios aprobados NO se materializa', () => {
    expect(() => paquete({ material: [] })).toThrow(EjecucionInvalidaError);
    expect(() => paquete({ material: [material({ titulares: ['solo uno'] })] })).toThrow(EjecucionInvalidaError);
  });

  it('sin territorio confirmado por la plataforma no se construye paquete', () => {
    expect(() => paquete({ geos: [geoEjecutable({ disponible: false, targetId: null })] })).toThrow(EjecucionInvalidaError);
  });

  it('el hash es determinista y NO depende de la hora de congelación', () => {
    const a = paquete();
    const b = construirPaquete({
      organizationId: ORG, perfil: perfil(), oferta: [oferta('implantes', 'Implantes dentales')], plan: plan(),
      grupos: [grupo()], geos: [geoEjecutable()], cuenta: { customerId: '1234567890', loginCustomerId: '9876543210' },
      mandato: mandato(), conversiones: [{ eventKey: 'whatsapp_intent', externalId: '555', rol: 'PRIMARY' }],
      material: [material()], ahora: '2027-01-01T00:00:00.000Z',
    });
    expect(b.hash).toBe(a.hash);
    // Cambiar el material cambia el hash: el paquete congelado es una fotografía, no una etiqueta.
    const c = paquete({ material: [material({ titulares: ['Otro titular', 'Y otro', 'Y uno más'] })] });
    expect(c.hash).not.toBe(a.hash);
    expect(hashDePaquete(a)).toBe(a.hash);
  });

  it('las palabras y las negativas del paquete son exactamente las del plan', () => {
    const p = paquete();
    expect(p.grupos[0]!.palabras.map((k) => k.texto)).toEqual(['implante dental curico', 'precio implante dental']);
    expect(p.grupos[0]!.palabras.map((k) => k.concordancia)).toEqual(['EXACT', 'PHRASE']);
    expect(p.negativas.map((n) => n.texto)).toEqual(['trabajo dentista']);
    expect(p.negativas[0]!.motivo).toBe('busca empleo');
  });

  it('la puja del plan se traduce a la de Google sin inventar otra', () => {
    expect(pujaGoogleDePaquete(paquete())).toEqual({ targetSpend: { cpcBidCeilingMicros: '2000000000' } });
    const conConversiones = paquete({ plan: plan({ puja: { estrategia: 'MAXIMIZE_CONVERSIONS', techoCpcClp: null, justificacion: 'hay historial' } }) });
    expect(pujaGoogleDePaquete(conConversiones)).toEqual({ maximizeConversions: {} });
  });

  it('la campaña sólo se muestra a quien está EN el territorio (sin «o con interés»)', () => {
    const req = materializarPaqueteGoogleAds(paquete(), { validateOnly: false })!;
    const campania = req.mutateOperations.find((o) => 'campaignOperation' in o) as { campaignOperation: { create: Record<string, unknown> } };
    expect(campania.campaignOperation.create.geoTargetTypeSetting).toEqual({ positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' });
    expect(campania.campaignOperation.create.networkSettings).toMatchObject({ targetContentNetwork: false, targetPartnerSearchNetwork: false });
  });

  it('el paquete lleva el mandato que lo autoriza: se puede auditar sin buscar en otra tabla', () => {
    const p = paquete();
    expect(p.mandato).toEqual({ id: 'mandato-1', autorizadoPor: 'duena@clinica.cl', topeMinor: 300_000, moneda: 'CLP', hasta: '2026-10-01T00:00:00.000Z' });
  });
});

// ── 3. AFIRMACIONES ─────────────────────────────────────────────────────────────────────────────

describe('validación de afirmaciones antes de publicar', () => {
  const restriccion = (texto: string, tipo: RestriccionNegocio['tipo']): RestriccionNegocio =>
    ({ organizationId: ORG, id: `r-${texto.slice(0, 6)}`, tipo, texto, alcance: null });

  it('un texto que contradice lo declarado produce conflicto (y no se publica)', () => {
    const p = paquete({ material: [material({ titulares: ['Implantes con Fonasa', 'Clínica en Curicó', 'Agenda hoy'] })] });
    const r = validarClaims(textosDelPaquete(p), [restriccion('No atendemos Fonasa', 'PROHIBITED_CLAIM')]);
    expect(r.ok).toBe(false);
    expect(r.conflictos[0]!.coincidencia).toBe('fonasa');
    expect(r.conflictos[0]!.donde).toContain('titular');
  });

  it('una afirmación APROBADA gana sobre la coincidencia léxica con una restricción', () => {
    const p = paquete({ material: [material({ titulares: ['Urgencias dentales', 'Clínica en Curicó', 'Agenda hoy'] })] });
    const sinAprobar = validarClaims(textosDelPaquete(p), [restriccion('No atendemos urgencias', 'RESTRICTION')]);
    expect(sinAprobar.ok).toBe(false);
    const aprobado = validarClaims(textosDelPaquete(p), [
      restriccion('No atendemos urgencias', 'RESTRICTION'),
      restriccion('Atendemos urgencias con hora previa', 'APPROVED_CLAIM'),
    ]);
    expect(aprobado.ok).toBe(true);
  });

  it('se revisan TODOS los textos, no sólo los titulares', () => {
    const p = paquete({ material: [material({ callouts: ['Convenio Fonasa'], sitelinks: [{ texto: 'Fonasa', url: 'https://x.example/f' }] })] });
    const r = validarClaims(textosDelPaquete(p), [restriccion('No atendemos Fonasa', 'PROHIBITED_CLAIM')]);
    expect(r.conflictos.length).toBeGreaterThanOrEqual(2);
    expect(r.revisados).toBe(textosDelPaquete(p).length);
  });
});

// ── 4. REQUISITOS ───────────────────────────────────────────────────────────────────────────────

const entradaOk = (over: Partial<EntradaPrerrequisitos> = {}): EntradaPrerrequisitos => ({
  perfil: perfil(), gobierno: gobierno(), plan: plan(), corrida: null,
  conexion: { estado: 'CONNECTED', customerId: '1234567890' }, capacidadEscritura: true,
  modoOperativo: 'SUPERVISED_REAL', killSwitchAbierto: true, mandato: mandato(),
  medicion: [{ eventKey: 'whatsapp_intent', estado: 'VERIFIED' }], ofertasConMaterial: ['implantes'], ofertasActivas: 1,
  geosEjecutables: 1, landingsListas: ['implantes'], claims: { ok: true, conflictos: [], revisados: 5 },
  ahora: AHORA, ...over,
});

describe('motor de requisitos', () => {
  it('con todo en regla, los doce pasan y se puede ejecutar', () => {
    const rs = evaluarPrerrequisitos(entradaOk());
    expect(rs).toHaveLength(12);
    expect(puedeEjecutar(rs)).toBe(true);
    for (const r of rs) expect(r.motivo.length).toBeGreaterThan(5);
  });

  it.each([
    ['sin permiso de escritura', { capacidadEscritura: false }, 'WRITE_CAPABILITY_ENABLED'],
    ['en modo observación', { modoOperativo: 'PILOT' }, 'OPERATING_MODE_ALLOWED'],
    ['con el interruptor cerrado', { killSwitchAbierto: false }, 'KILL_SWITCH_ALLOWED'],
    ['sin mandato', { mandato: null }, 'FINANCIAL_MANDATE_VALID'],
    ['con mandato vencido', { mandato: mandato({ periodEnd: '2026-09-01T00:00:00.000Z' }) }, 'FINANCIAL_MANDATE_VALID'],
    ['con mandato detenido', { mandato: mandato({ killSwitch: true }) }, 'FINANCIAL_MANDATE_VALID'],
    ['sin conexión', { conexion: null }, 'CONNECTION_VALID'],
    ['sin cuenta elegida', { conexion: { estado: 'CONNECTED', customerId: null } }, 'ACCOUNT_SELECTED'],
    ['sin territorio', { geosEjecutables: 0 }, 'GEO_EXECUTABLE'],
    ['sin landing', { landingsListas: [] }, 'LANDING_READY'],
    ['sin anuncios', { ofertasConMaterial: [] }, 'CREATIVE_READY'],
    ['con medición sin verificar', { medicion: [{ eventKey: 'whatsapp_intent', estado: 'ACTION_CREATED' as const }] }, 'CONVERSION_READY'],
    ['sin medición declarada', { medicion: [] }, 'CONVERSION_READY'],
    ['con plan viejo', { plan: plan({ estado: 'STALE', motivoStale: 'cambió el territorio' }) }, 'PLAN_CURRENT'],
    ['sin plan', { plan: null }, 'PLAN_CURRENT'],
    ['con mutaciones externas apagadas en la empresa', { gobierno: gobierno({ externalMutations: false }) }, 'OPERATING_MODE_ALLOWED'],
    ['sin autorizar a SOEC a crear campañas', { gobierno: gobierno({ campaignExecution: false }) }, 'WRITE_CAPABILITY_ENABLED'],
    ['sin servicios declarados', { ofertasActivas: 0 }, 'BUSINESS_READY'],
    ['sin objetivo declarado', { perfil: perfil({ primaryObjective: null }) }, 'BUSINESS_READY'],
  ])('%s ⇒ no se puede ejecutar y el motivo apunta a %s', (_caso, cambio, requisito) => {
    const rs = evaluarPrerrequisitos(entradaOk(cambio as Partial<EntradaPrerrequisitos>));
    expect(puedeEjecutar(rs)).toBe(false);
    expect(bloqueantes(rs).map((r) => r.requisito)).toContain(requisito);
  });

  it('un conflicto de afirmaciones BLOQUEA (no es un pendiente del usuario)', () => {
    const rs = evaluarPrerrequisitos(entradaOk({ claims: { ok: false, conflictos: [{ donde: 'titular 1', texto: 'Fonasa', restriccion: 'No atendemos Fonasa', tipo: 'PROHIBITED_CLAIM', coincidencia: 'fonasa' }], revisados: 5 } }));
    const creative = rs.find((r) => r.requisito === 'CREATIVE_READY')!;
    expect(creative.veredicto).toBe('BLOCKED');
  });

  it('el modo autónomo NO habilita crear campañas en esta fase', () => {
    const rs = evaluarPrerrequisitos(entradaOk({ modoOperativo: 'AUTONOMOUS_REAL' }));
    const modo = rs.find((r) => r.requisito === 'OPERATING_MODE_ALLOWED')!;
    expect(modo.veredicto).toBe('BLOCKED');
    expect(modo.motivo).toContain('supervisado');
  });
});

// ── 5. CONVERSIONES ─────────────────────────────────────────────────────────────────────────────

describe('acciones de conversión', () => {
  it('el nombre externo es estable: la misma empresa y el mismo evento dan el mismo nombre', () => {
    expect(nombreExternoDe('Clínica QA', 'whatsapp_intent')).toBe(nombreExternoDe('Clínica QA', 'whatsapp_intent'));
    expect(nombreExternoDe('Clínica QA', 'whatsapp_intent')).toContain('whatsapp_intent');
  });

  it('el tipo comercial se deduce del evento declarado, sin que el usuario escriba enums', () => {
    expect(tipoComercialDe('whatsapp_intent')).toBe('MENSAJERIA');
    expect(tipoComercialDe('phone_intent')).toBe('LLAMADA');
    expect(tipoComercialDe('form_submit')).toBe('CONTACTO_WEB');
    expect(tipoComercialDe('compra_online')).toBe('COMPRA');
    // Un contacto se cuenta UNA vez por clic; una compra, todas.
    expect(CONFIGURACION_GOOGLE.MENSAJERIA.conteo).toBe('ONE_PER_CLICK');
    expect(CONFIGURACION_GOOGLE.COMPRA.conteo).toBe('MANY_PER_CLICK');
  });

  it('si ya hay mapeo persistido NO se consulta ni se crea nada', async () => {
    const buscar = vi.fn();
    const crear = vi.fn();
    const r = await asegurarAccionDeConversion({
      cliente: { buscar, crearAccionDeConversion: crear } as never,
      customerId: '1', organizationId: ORG, proveedor: 'GOOGLE_ADS', eventKey: 'whatsapp_intent', rol: 'PRIMARY',
      nombreNegocio: 'Clínica QA', moneda: 'CLP', ahora: AHORA,
      existente: { organizationId: ORG, proveedor: 'GOOGLE_ADS', eventKey: 'whatsapp_intent', tipo: 'MENSAJERIA', rol: 'PRIMARY', nombreExterno: 'SOEC · Clínica QA · whatsapp_intent', externalId: '555', externalLabel: 'abc', semanticaValor: 'SIN_VALOR', valor: null, estado: 'ACTION_CREATED', verificacion: 'NO_VERIFICADA', verificadaEn: null, actualizadoEn: AHORA },
    });
    expect(buscar).not.toHaveBeenCalled();
    expect(crear).not.toHaveBeenCalled();
    expect(r.creada).toBe(false);
    expect(r.mapeo.externalId).toBe('555');
  });

  it('si la acción ya existe en la plataforma se ADOPTA: no se crea una segunda', async () => {
    const buscar = vi.fn().mockResolvedValue([{ conversionAction: { id: '777', name: 'SOEC · Clínica QA · whatsapp_intent', resourceName: 'customers/1/conversionActions/777', status: 'ENABLED', tagSnippets: [{ eventSnippet: "gtag('event','conversion',{'send_to':'AW-123/AbC-D_efG'})" }] } }]);
    const crear = vi.fn();
    const r = await asegurarAccionDeConversion({
      cliente: { buscar, crearAccionDeConversion: crear } as never,
      customerId: '1', organizationId: ORG, proveedor: 'GOOGLE_ADS', eventKey: 'whatsapp_intent', rol: 'PRIMARY',
      nombreNegocio: 'Clínica QA', moneda: 'CLP', existente: null, ahora: AHORA,
    });
    expect(crear).not.toHaveBeenCalled();
    expect(r.creada).toBe(false);
    expect(r.mapeo.externalId).toBe('777');
    expect(r.mapeo.externalLabel).toBe('AbC-D_efG');
  });

  it('sólo se crea cuando no existe, y una sola vez', async () => {
    const buscar = vi.fn().mockResolvedValue([]);
    const crear = vi.fn().mockResolvedValue({ resourceName: 'customers/1/conversionActions/999', requestId: 'req-1' });
    const r = await asegurarAccionDeConversion({
      cliente: { buscar, crearAccionDeConversion: crear } as never,
      customerId: '1', organizationId: ORG, proveedor: 'GOOGLE_ADS', eventKey: 'whatsapp_intent', rol: 'PRIMARY',
      nombreNegocio: 'Clínica QA', moneda: 'CLP', existente: null, ahora: AHORA,
    });
    expect(crear).toHaveBeenCalledTimes(1);
    expect(r.creada).toBe(true);
    expect(r.mapeo.externalId).toBe('999');
    expect(r.providerRequestId).toBe('req-1');
  });

  it('la etiqueta se extrae del fragmento de Google, no se inventa', () => {
    expect(etiquetaDeSnippet("send_to: 'AW-123456/AbC-D_efG'")).toBe('AbC-D_efG');
    expect(etiquetaDeSnippet('sin nada')).toBeNull();
  });
});

// ── 6. MEDICIÓN: creada ≠ verificada ────────────────────────────────────────────────────────────

describe('ciclo de vida de la medición', () => {
  it('sin acción externa el estado es ACTION_MISSING', () => {
    expect(estadoDeMedicion(null, null)).toBe('ACTION_MISSING');
  });

  it('una acción creada NO es medición verificada', () => {
    const mapeo = { externalId: '555', verificacion: 'NO_VERIFICADA', estado: 'ACTION_CREATED' } as never;
    expect(estadoDeMedicion(mapeo, null)).toBe('TRACKING_MISSING');
    expect(estadoDeMedicion(mapeo, 'TRACKING_INSTALLED')).toBe('TRACKING_INSTALLED');
    expect(estadoDeMedicion(mapeo, 'VERIFIED')).toBe('VERIFIED');
  });

  it('el proveedor manual NUNCA devuelve verificada, y da instrucciones en su lugar', async () => {
    const r = await instalacionManual.instalar({ organizationId: ORG, sitio: 'https://x.example', conversionId: '123', conversionLabel: 'abc', eventKey: 'whatsapp_intent' });
    expect(r.estado).toBe('TRACKING_MISSING');
    expect(r.instrucciones[0]!.fragmento).toContain('gtag');
    const v = await instalacionManual.verificar({ organizationId: ORG, eventKey: 'whatsapp_intent' });
    expect(v.verificada).toBe(false);
  });

  it('el fragmento de medición no contiene secretos', () => {
    const f = fragmentoGoogle('123456', 'AbC', 'whatsapp_intent');
    expect(f).toContain('AW-123456/AbC');
    expect(f).not.toMatch(/token|secret|password|refresh/i);
  });
});

// ── 7. EJECUTOR: idempotencia, atomicidad y verificación ────────────────────────────────────────

const remota = (over: Partial<CampaniaRemota> = {}): CampaniaRemota => ({
  id: '111', nombre: paquete().campania.nombre, estado: 'PAUSED', canal: 'SEARCH',
  presupuestoMicros: 10_000_000_000, grupos: [{ id: '222', nombre: 'Implantes dentales', estado: 'PAUSED' }],
  palabras: [{ texto: 'implante dental curico', concordancia: 'EXACT' }, { texto: 'precio implante dental', concordancia: 'PHRASE' }],
  negativas: [{ texto: 'trabajo dentista' }], geo: ['1000341'], anuncios: 1, ...over,
});

/** Cliente falso: responde a las consultas GAQL por el texto de la consulta. */
function clienteFalso(opciones: { readonly existente?: CampaniaRemota | null; readonly trasCrear?: CampaniaRemota | null; readonly falla?: boolean } = {}) {
  let creada = false;
  const mutarGrafo = vi.fn(async () => {
    creada = true;
    return opciones.falla === true
      ? { ok: false, httpStatus: 400, requestId: 'req-x', validateOnly: false, operationCount: 9, resultsCount: 0, errorStatus: 'INVALID_ARGUMENT', errorCode: 'CampaignError.DUPLICATE_CAMPAIGN_NAME', errorMessage: 'nombre duplicado', googleErrors: [], results: [], partialFailure: false as const }
      : { ok: true, httpStatus: 200, requestId: 'req-ok', validateOnly: false, operationCount: 9, resultsCount: 9, errorStatus: null, errorCode: null, errorMessage: null, googleErrors: [], results: [
        { resourceName: 'customers/1234567890/campaignBudgets/1' }, { resourceName: 'customers/1234567890/campaigns/111' },
        { resourceName: 'customers/1234567890/adGroups/222' }, { resourceName: 'customers/1234567890/adGroupAds/222~1' },
        { resourceName: 'customers/1234567890/adGroupCriteria/222~1' }, { resourceName: 'customers/1234567890/adGroupCriteria/222~2' },
        { resourceName: 'customers/1234567890/campaignCriteria/111~1' }, { resourceName: 'customers/1234567890/campaignCriteria/111~2' },
        { resourceName: 'customers/1234567890/campaignCriteria/111~3' },
      ], partialFailure: false as const };
  });
  const buscar = vi.fn(async (_cid: string, query: string) => {
    const actual = creada ? (opciones.trasCrear ?? remota()) : (opciones.existente ?? null);
    if (actual === null) return [];
    if (query.includes('from campaign ')) return [{ campaign: { id: actual.id, name: actual.nombre, status: actual.estado, advertisingChannelType: actual.canal }, campaignBudget: { amountMicros: actual.presupuestoMicros } }];
    if (query.includes('from ad_group ')) return actual.grupos.map((g) => ({ adGroup: { id: g.id, name: g.nombre, status: g.estado } }));
    if (query.includes('from ad_group_criterion')) return actual.palabras.map((k) => ({ adGroupCriterion: { keyword: { text: k.texto, matchType: k.concordancia } } }));
    if (query.includes("campaign_criterion.type = 'KEYWORD'")) return actual.negativas.map((n) => ({ campaignCriterion: { keyword: { text: n.texto } } }));
    if (query.includes("campaign_criterion.type = 'LOCATION'")) return actual.geo.map((g) => ({ campaignCriterion: { location: { geoTargetConstant: `geoTargetConstants/${g}` } } }));
    if (query.includes('from ad_group_ad')) return Array.from({ length: actual.anuncios }, () => ({ adGroupAd: { ad: { id: '1' } } }));
    return [];
  });
  return { cliente: { buscar, mutarGrafo } as never, buscar, mutarGrafo };
}

describe('ejecutor de Google Ads', () => {
  it('crea la campaña con UNA sola llamada atómica y la verifica en pausa', async () => {
    const c = clienteFalso();
    const r = await ejecutarPaqueteGoogle({ paquete: paquete(), cliente: c.cliente, pasosPrevios: [], ahora: () => AHORA });
    expect(c.mutarGrafo).toHaveBeenCalledTimes(1);
    expect(r.estado).toBe('CREATED_PAUSED');
    expect(r.escriturasProveedor).toBe(1);
    expect(r.reconciliacion?.coincide).toBe(true);
    expect(r.recursosExternos.campaigns).toEqual(['111']);
    expect(r.pasos.map((p) => p.paso)).toEqual(expect.arrayContaining(['VERIFY_REMOTE_STATE', 'BUDGET_CREATE', 'CAMPAIGN_CREATE', 'AD_GROUP_CREATE', 'KEYWORD_CREATE', 'NEGATIVE_CREATE']));
  });

  it('REINTENTAR no duplica: si la campaña ya existe se adopta con CERO escrituras', async () => {
    const c = clienteFalso({ existente: remota() });
    const r = await ejecutarPaqueteGoogle({ paquete: paquete(), cliente: c.cliente, pasosPrevios: [], ahora: () => AHORA });
    expect(c.mutarGrafo).not.toHaveBeenCalled();
    expect(r.escriturasProveedor).toBe(0);
    expect(r.estado).toBe('CREATED_PAUSED');
    expect(r.pasos.find((p) => p.paso === 'CAMPAIGN_CREATE')?.resultado).toBe('SKIPPED_IDEMPOTENT');
  });

  it('si la plataforma rechaza, no quedan recursos ni se reintenta solo', async () => {
    const c = clienteFalso({ falla: true });
    const r = await ejecutarPaqueteGoogle({ paquete: paquete(), cliente: c.cliente, pasosPrevios: [], ahora: () => AHORA });
    expect(r.estado).toBe('FAILED');
    expect(r.recursosExternos).toEqual({});
    expect(r.motivo).toContain('DUPLICATE_CAMPAIGN_NAME');
    expect(c.mutarGrafo).toHaveBeenCalledTimes(1);
  });

  it('una campaña que aparece ENCENDIDA no se declara creada-en-pausa', async () => {
    const c = clienteFalso({ existente: remota({ estado: 'ENABLED' }) });
    const r = await ejecutarPaqueteGoogle({ paquete: paquete(), cliente: c.cliente, pasosPrevios: [], ahora: () => AHORA });
    expect(r.estado).toBe('PARTIAL');
    expect(r.reconciliacion?.divergencias.map((d) => d.campo)).toContain('estado');
  });

  it('si el libro dice que se creó pero la plataforma no la tiene, NO se recrea a ciegas', async () => {
    const c = clienteFalso();
    const p = paquete();
    const r = await ejecutarPaqueteGoogle({
      paquete: p, cliente: c.cliente, ahora: () => AHORA,
      pasosPrevios: [{ paso: 'CAMPAIGN_CREATE', clave: p.hash, resultado: 'OK' }],
    });
    expect(c.mutarGrafo).not.toHaveBeenCalled();
    expect(r.estado).toBe('PARTIAL');
    expect(r.motivo).toContain('revísalo antes de reintentar');
  });

  it('la reconciliación detecta cambios hechos por fuera (drift) sin corregirlos', () => {
    const p = paquete();
    const r = compararConPaquete(p, remota({ estado: 'ENABLED', presupuestoMicros: 99_000_000_000, negativas: [] }), AHORA);
    expect(r.coincide).toBe(false);
    expect(r.divergencias.map((d) => d.campo)).toEqual(expect.arrayContaining(['estado', 'presupuesto diario', 'negativas']));
  });

  it('agrupa los recursos creados por colección, sin fabricar identificadores', () => {
    expect(agruparRecursos(['customers/1/campaigns/111', 'customers/1/adGroups/222', null])).toEqual({
      campaigns: ['customers/1/campaigns/111'], adGroups: ['customers/1/adGroups/222'],
    });
  });
});
