/**
 * Autonomy Fase H · PREPARACIÓN COMERCIAL (read model puro).
 *
 * Lo que se prueba aquí no es que el informe sea bonito: es que **no miente en ninguna de las dos direcciones**.
 * Ni dice que falta algo que ya está, ni pinta de verde algo que no está, ni le atribuye a una persona un
 * trabajo que SOEC puede hacer solo.
 */
import { describe, expect, it } from 'vitest';
import { evaluarPreparacionComercial, ITEMS, type DatosPreparacion } from '../src/aceptacion/preparacion-comercial';
import type { BusinessReadiness, DominioEvaluado, DominioReadiness, EstadoDominio } from '../src/onboarding/readiness';
import { DOMINIOS, NIVELES } from '../src/onboarding/readiness';

const ORG = 'org-qa';
const AHORA = '2026-09-22T12:00:00.000Z';

function readiness(estados: Partial<Record<DominioReadiness, EstadoDominio>> = {}, negocioListo = true): BusinessReadiness {
  const dominios: DominioEvaluado[] = DOMINIOS.map((d) => ({ dominio: d, estado: estados[d] ?? 'COMPLETE', motivos: [] }));
  return {
    organizationId: ORG,
    dominios,
    niveles: NIVELES.map((n) => ({ nivel: n, listo: n === 'BUSINESS_READY' ? negocioListo : false, bloqueos: [] })),
    resumen: 'LISTO',
  };
}

/** Una empresa que ya recorrió todo: nada debería aparecer como pendiente. */
const completa = (over: Partial<DatosPreparacion> = {}): DatosPreparacion => ({
  organizationId: ORG,
  ahora: AHORA,
  readiness: readiness(),
  sitio: { url: 'https://clinica.example', estado: 'OK', paginas: 6 },
  sitioDeclarado: 'https://clinica.example',
  landings: [{ ofertaSlug: 'implantes-dentales', estado: 'READY', url: 'https://clinica.example/implantes' }],
  conexionGoogle: { estado: 'CONNECTED', cuenta: '1234567890' },
  capacidades: ['MEDICION_REAL', 'ESCRITURA_ADS'],
  modoOperativo: 'SUPERVISED_REAL',
  gobierno: { externalMutations: true, campaignExecution: true, autonomousSpend: false },
  mandato: { vigente: true, topeMinor: 900_000, moneda: 'CLP', hasta: '2026-12-01T00:00:00.000Z' },
  investigacion: { estado: 'COMPLETE', fresca: true, terminos: 24 },
  plan: { estado: 'DRAFT', vigente: true, grupos: 3 },
  medicion: [{ eventKey: 'whatsapp_intent', estado: 'VERIFIED' }],
  campana: { estado: 'CREATED_PAUSED', campaignId: '900', reconciliada: true },
  politicaAutonomia: { accionesPermitidas: ['PAUSE_CAMPAIGN'], activacionAutonomaPermitida: false },
  ...over,
});

describe('preparación comercial · forma del informe', () => {
  it('son siempre los mismos 18 ítems, en el mismo orden', () => {
    const r = evaluarPreparacionComercial(completa());
    expect(ITEMS).toHaveLength(18);
    expect(r.items.map((x) => x.item)).toEqual(ITEMS);
    expect(Object.values(r.conteo).reduce((a, b) => a + b, 0)).toBe(18);
  });

  it('una empresa que ya recorrió todo aparece lista para crear y para encender, no para autonomía', () => {
    const r = evaluarPreparacionComercial(completa());
    expect(r.items.filter((x) => x.estado !== 'READY' && x.estado !== 'OPTIONAL')).toEqual([]);
    expect(r.hitos.find((h) => h.hito === 'CREAR_CAMPANA')!.listo).toBe(true);
    expect(r.hitos.find((h) => h.hito === 'ENCENDER_CAMPANA')!.listo).toBe(true);
    // La autonomía exige permisos que NADIE concedió: no se infiere de haber llegado hasta aquí.
    const autonomia = r.hitos.find((h) => h.hito === 'OPERAR_CON_AUTONOMIA')!;
    expect(autonomia.listo).toBe(false);
    expect(autonomia.bloqueos).toContain('falta autorizar que SOEC encienda campañas sin preguntar');
    expect(autonomia.bloqueos).toContain('falta habilitar el gasto autónomo');
    expect(r.siguienteAccion).toBeNull();
  });
});

describe('preparación comercial · quién resuelve cada cosa', () => {
  it('lo que falta por responder es de la empresa y se marca MISSING', () => {
    const r = evaluarPreparacionComercial(completa({ readiness: readiness({ OFFER: 'INCOMPLETE' }, false) }));
    expect(r.items.find((x) => x.item === 'OFERTA_DECLARADA')!.estado).toBe('MISSING');
    expect(r.siguienteAccion?.de).toBe('LA_EMPRESA');
  });

  it('conectar la cuenta, firmar el dinero y abrir el gobierno son actos humanos', () => {
    const r = evaluarPreparacionComercial(completa({
      conexionGoogle: null, mandato: null,
      gobierno: { externalMutations: false, campaignExecution: false, autonomousSpend: false },
      capacidades: ['MEDICION_REAL'], modoOperativo: 'PILOT',
    }));
    for (const item of ['CONEXION_GOOGLE_ADS', 'MANDATO_FINANCIERO', 'GOBIERNO_DE_EJECUCION', 'CAPACIDAD_DE_ESCRITURA', 'MODO_OPERATIVO'] as const) {
      expect(r.items.find((x) => x.item === item)!.estado, item).toBe('HUMAN_ACTION_REQUIRED');
    }
    expect(r.hitos.find((h) => h.hito === 'CREAR_CAMPANA')!.listo).toBe(false);
  });

  it('investigar, planificar y crear la campaña son trabajo de SOEC, no del dueño', () => {
    const r = evaluarPreparacionComercial(completa({ investigacion: null, plan: null, campana: null }));
    expect(r.items.find((x) => x.item === 'INVESTIGACION_Y_PLAN')!.estado).toBe('SYSTEM_ACTION_REQUIRED');
    expect(r.items.find((x) => x.item === 'CAMPANA_CREADA')!.estado).toBe('SYSTEM_ACTION_REQUIRED');
    expect(r.siguienteAccion?.de).toBe('SOEC');
  });

  it('sin los datos del negocio, investigar no es trabajo pendiente de SOEC: es un dato que falta', () => {
    const r = evaluarPreparacionComercial(completa({
      readiness: readiness({ BUSINESS_PROFILE: 'INCOMPLETE' }, false), investigacion: null, plan: null,
    }));
    expect(r.items.find((x) => x.item === 'INVESTIGACION_Y_PLAN')!.estado).toBe('MISSING');
  });
});

describe('preparación comercial · no pinta de verde lo que no está', () => {
  it('un plan desactualizado no cuenta como plan', () => {
    const r = evaluarPreparacionComercial(completa({ plan: { estado: 'STALE', vigente: false, grupos: 3 } }));
    expect(r.items.find((x) => x.item === 'INVESTIGACION_Y_PLAN')!.estado).toBe('SYSTEM_ACTION_REQUIRED');
  });

  it('una medición que dejó de registrar es una acción humana, no un READY', () => {
    const r = evaluarPreparacionComercial(completa({ medicion: [{ eventKey: 'whatsapp_intent', estado: 'DEGRADED' }] }));
    const item = r.items.find((x) => x.item === 'MEDICION_VERIFICADA')!;
    expect(item.estado).toBe('HUMAN_ACTION_REQUIRED');
    expect(item.observado).toContain('dejaron de registrar');
    expect(r.hitos.find((h) => h.hito === 'ENCENDER_CAMPANA')!.listo).toBe(false);
  });

  it('una acción de conversión creada pero sin señal observada no es medición verificada', () => {
    const r = evaluarPreparacionComercial(completa({ medicion: [{ eventKey: 'whatsapp_intent', estado: 'TRACKING_INSTALLED' }] }));
    expect(r.items.find((x) => x.item === 'MEDICION_VERIFICADA')!.estado).toBe('HUMAN_ACTION_REQUIRED');
  });

  it('un mandato vencido no es un mandato', () => {
    const r = evaluarPreparacionComercial(completa({ mandato: { vigente: false, topeMinor: 900_000, moneda: 'CLP', hasta: '2026-09-02T00:00:00.000Z' } }));
    const item = r.items.find((x) => x.item === 'MANDATO_FINANCIERO')!;
    expect(item.estado).toBe('HUMAN_ACTION_REQUIRED');
    expect(item.observado).toContain('2026-09-02');
  });

  it('una campaña cambiada por fuera se avisa antes de seguir', () => {
    const r = evaluarPreparacionComercial(completa({ campana: { estado: 'CREATED_PAUSED', campaignId: '900', reconciliada: false } }));
    expect(r.items.find((x) => x.item === 'CAMPANA_CREADA')!.estado).toBe('HUMAN_ACTION_REQUIRED');
  });

  it('un sitio que no responde bloquea encender: es donde aterriza el clic', () => {
    const r = evaluarPreparacionComercial(completa({ sitio: { url: 'https://clinica.example', estado: 'UNREACHABLE', paginas: 0 }, landings: [] }));
    expect(r.items.find((x) => x.item === 'SITIO_WEB_OBSERVADO')!.estado).toBe('HUMAN_ACTION_REQUIRED');
    expect(r.hitos.find((h) => h.hito === 'ENCENDER_CAMPANA')!.bloqueos).toContain('falta un sitio que responda: es donde aterriza el clic');
  });

  it('una empresa recién dada de alta no aparece lista para nada, y nadie la rellena', () => {
    const vacia: DatosPreparacion = {
      organizationId: ORG, ahora: AHORA,
      readiness: readiness({
        BUSINESS_PROFILE: 'INCOMPLETE', OFFER: 'INCOMPLETE', GEOGRAPHY: 'INCOMPLETE', OBJECTIVE: 'INCOMPLETE',
        CONVERSIONS: 'INCOMPLETE', RESTRICTIONS: 'OPTIONAL', EVALUATION: 'INCOMPLETE',
        CONNECTIONS: 'ACTION_REQUIRED', FINANCIAL_MANDATE: 'INCOMPLETE', GOVERNANCE: 'INCOMPLETE',
      }, false),
      sitio: null, sitioDeclarado: null, landings: [], conexionGoogle: null, capacidades: [], modoOperativo: 'PILOT', gobierno: null, mandato: null,
      investigacion: null, plan: null, medicion: [], campana: null, politicaAutonomia: null,
    };
    const r = evaluarPreparacionComercial(vacia);
    expect(r.hitos.every((h) => !h.listo)).toBe(true);
    expect(r.conteo.READY).toBe(0);
    expect(r.items.find((x) => x.item === 'LIMITES_DE_COMUNICACION')!.estado).toBe('OPTIONAL');
  });
});
