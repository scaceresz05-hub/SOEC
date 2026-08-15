/**
 * Demostración SHADOW del motor de adquisición sobre perfiles reales (FASES 45-47, 53).
 *
 * Ejecuta el planner y el modelo de estrategia sobre configuraciones de negocio como DATOS
 * (SmileFlow, C Y P y un tercer negocio de prueba), sin `if SmileFlow`/`if Cyp` y sin inventar
 * datos de Meta. Certifica: el tercer negocio funciona sin tocar el core; C Y P (GA4 pendiente) da
 * FOUNDATION_REQUIRED; ninguno hereda la configuración del otro; y Meta permanece NOT_CONNECTED.
 */
import { describe, expect, it } from 'vitest';
import {
  planificarAdquisicion,
  evaluarHipotesis,
  decisionAccionable,
  cuentaNoConfigurada,
  cuentaNoConectada,
  type EntradaPlanner,
  type HipotesisContenido,
  type DecisionEstrategiaCanal,
  type CanalDisponible,
} from '../src/index';

/** Perfil de negocio como configuración pura (lo que el motor consume; sin ramas por identidad). */
interface PerfilAdquisicion {
  readonly organizationId: string;
  readonly entrada: EntradaPlanner;
}

// SmileFlow: Google conectado (read-only), Meta NO conectado, medición vía Growth, sin mandato de presupuesto.
const SMILEFLOW: PerfilAdquisicion = {
  organizationId: 'org-smileflow',
  entrada: {
    organizationId: 'org-smileflow',
    objetivo: 'GENERATE_LEADS',
    medicionEvaluable: true,
    canales: [
      { canal: 'GOOGLE_SEARCH', estado: 'CONNECTED_READ_ONLY' },
      { canal: 'META_INSTAGRAM', estado: 'NOT_CONFIGURED' },
      { canal: 'ORGANIC_INSTAGRAM', estado: 'NOT_CONFIGURED' },
    ],
    tieneBrandPolicy: true,
    tieneStopLoss: true,
    tieneMandatoPresupuesto: false,
  },
};

// C Y P: GA4 pendiente ⇒ medición NO evaluable; Meta/IG/FB NO conectados; objetivo de venta.
const CYP: PerfilAdquisicion = {
  organizationId: 'org-cyp',
  entrada: {
    organizationId: 'org-cyp',
    objetivo: 'GENERATE_SALES',
    medicionEvaluable: false,
    canales: [
      { canal: 'WEBSITE', estado: 'NOT_CONFIGURED' },
      { canal: 'META_FACEBOOK', estado: 'NOT_CONFIGURED' },
      { canal: 'META_INSTAGRAM', estado: 'NOT_CONFIGURED' },
      { canal: 'ORGANIC_FACEBOOK', estado: 'NOT_CONFIGURED' },
    ],
    tieneBrandPolicy: false,
    tieneStopLoss: false,
    tieneMandatoPresupuesto: false,
  },
};

// Tercer negocio (SERVICIOS): canal orgánico listo en shadow, con BrandPolicy. Nada tocado en el core.
const TERCERO: PerfilAdquisicion = {
  organizationId: 'org-negocio-3',
  entrada: {
    organizationId: 'org-negocio-3',
    objetivo: 'GENERATE_LEADS',
    medicionEvaluable: true,
    canales: [{ canal: 'ORGANIC_INSTAGRAM', estado: 'SHADOW_READY' }],
    tieneBrandPolicy: true,
    tieneStopLoss: false,
    tieneMandatoPresupuesto: false,
  },
};

describe('SHADOW demo · SmileFlow', () => {
  it('propone acción sólo con lo conectado (Google) y NO inventa Meta', () => {
    const plan = planificarAdquisicion(SMILEFLOW.entrada);
    // Google está conectado pero falta mandato de presupuesto ⇒ requiere aprobación, no PAID autónomo.
    expect(plan.tipo).toBe('APPROVAL_REQUIRED');
    // Meta no aparece como listo: NOT_CONNECTED nunca se convierte en dato.
    expect(plan.canalesPagadosListos).not.toContain('META_INSTAGRAM');
    expect(plan.canalesOrganicosListos).toHaveLength(0);
  });

  it('una hipótesis de contenido exige evidencia comercial real', () => {
    const conEvidencia: HipotesisContenido = {
      organizationId: 'org-smileflow',
      objetivo: 'GENERATE_LEADS',
      canal: 'GOOGLE_SEARCH',
      audiencia: 'clínicas dentales que evalúan software de gestión',
      problemaONecesidad: 'agenda y ficha dispersas',
      productoServicio: 'SmileFlow — gestión clínica',
      evidenciaComercial: ['leads_reales_growth'],
      cta: 'Solicita una demo',
      resultadoEsperado: 'DEMO',
    };
    expect(evaluarHipotesis(conEvidencia).evaluable).toBe(true);
    expect(evaluarHipotesis({ ...conEvidencia, evidenciaComercial: [] }).evaluable).toBe(false);
  });
});

describe('SHADOW demo · C Y P', () => {
  it('sin GA4 la medición no es evaluable ⇒ FOUNDATION_REQUIRED', () => {
    const plan = planificarAdquisicion(CYP.entrada);
    expect(plan.tipo).toBe('FOUNDATION_REQUIRED');
    expect(plan.razones.join(' ')).toContain('instrumentar');
  });

  it('todos los canales Meta/IG/FB están NO conectados (no hay datos ficticios)', () => {
    const meta = cuentaNoConfigurada('org-cyp', 'distribuidora-cyp', 'meta', 'META_INSTAGRAM');
    expect(cuentaNoConectada(meta)).toBe(true);
  });

  it('una decisión de canal sin evidencia no es accionable (no se recomienda invertir a ciegas)', () => {
    const sinEvidencia: DecisionEstrategiaCanal = {
      organizationId: 'org-cyp',
      objetivo: 'GENERATE_SALES',
      canal: 'META_INSTAGRAM',
      why: 'hipótesis inicial',
      evidencia: [],
      resultadoEsperado: 'PURCHASE',
      riesgo: 'HIGH',
      rangoCosto: { moneda: 'CLP', min: null, max: null },
      preparacionMedicion: 'NOT_READY',
      confianza: 'NULA',
    };
    expect(decisionAccionable(sinEvidencia)).toBe(false);
  });
});

describe('SHADOW demo · tercer negocio sin cambios de core', () => {
  it('THIRD_BUSINESS_WORKS_WITHOUT_CORE_CHANGE: el mismo planner sirve a un negocio nuevo', () => {
    const plan = planificarAdquisicion(TERCERO.entrada);
    expect(plan.tipo).toBe('ORGANIC_EXPERIMENT');
    expect(plan.canalesOrganicosListos).toContain('ORGANIC_INSTAGRAM');
  });

  it('CYP_DOES_NOT_INHERIT_SMILEFLOW / SMILEFLOW_DOES_NOT_INHERIT_CYP: perfiles independientes', () => {
    // Mismos objetivos distintos, mismas funciones, resultados distintos y coherentes con cada config.
    expect(planificarAdquisicion(SMILEFLOW.entrada).tipo).not.toBe(planificarAdquisicion(CYP.entrada).tipo);
    // Cambiar la config de CYP no altera el resultado de SmileFlow (funciones puras sin estado global).
    const cypComoSmileflow = planificarAdquisicion({ ...CYP.entrada, medicionEvaluable: true });
    expect(cypComoSmileflow.tipo).not.toBe('FOUNDATION_REQUIRED');
    expect(planificarAdquisicion(SMILEFLOW.entrada).tipo).toBe('APPROVAL_REQUIRED');
  });
});
