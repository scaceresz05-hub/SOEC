/**
 * Autonomy Fase 0 · GOBIERNO de mutaciones externas: una sola semántica para modos, kill switch y pausa de
 * seguridad. Si esta suite pasa, la frase «EXTERNAL_MUTATIONS_ALLOWED = NO» es verificable, no una promesa.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluarMutacionExterna,
  modoDeOrganizacion,
  estadoKillSwitch,
  mutacionesExternasHabilitadas,
  type ClaseMutacion,
} from '../src/gobierno';
import { derivarFlagsDeModo, validateAuthorizedExecution, construirEnvelope, aprobar, type AccionSolicitada, type FinancialState, type ProviderState } from '../src/campana/authorized-execution-envelope';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';

const CLASES_MUTACION: readonly ClaseMutacion[] = ['CREACION', 'PRESUPUESTO', 'PUJA', 'KEYWORD', 'ANUNCIO', 'ESTADO'];
const base = { mutacionesExternasHabilitadas: true } as const;

describe('modos · traducción del valor almacenado', () => {
  it('PILOT y cualquier valor desconocido son OBSERVE (fail-closed)', () => {
    expect(modoDeOrganizacion('PILOT')).toBe('OBSERVE');
    expect(modoDeOrganizacion(null)).toBe('OBSERVE');
    expect(modoDeOrganizacion(undefined)).toBe('OBSERVE');
    expect(modoDeOrganizacion('LO_QUE_SEA')).toBe('OBSERVE');
    expect(modoDeOrganizacion('SUPERVISED_REAL')).toBe('SUPERVISED_REAL');
    expect(modoDeOrganizacion('AUTONOMOUS_REAL')).toBe('AUTONOMOUS_REAL');
  });
});

describe('OBSERVE · ninguna mutación externa', () => {
  it('deniega todas las clases, incluso con autorización y mandato presentes', () => {
    for (const clase of CLASES_MUTACION) {
      const v = evaluarMutacionExterna(clase, { ...base, modo: 'OBSERVE', autorizacionExplicita: true, mandatoVigente: true });
      expect(v.permitido, clase).toBe(false);
      expect(v.permitido === false && v.motivo).toBe('MODE_OBSERVE_NO_MUTATIONS');
    }
  });
});

describe('SUPERVISED_REAL · sólo con autorización explícita', () => {
  it('sin envelope aprobado ⇒ denegado', () => {
    for (const clase of CLASES_MUTACION) {
      const v = evaluarMutacionExterna(clase, { ...base, modo: 'SUPERVISED_REAL', autorizacionExplicita: false });
      expect(v.permitido, clase).toBe(false);
      expect(v.permitido === false && v.motivo).toBe('NO_EXPLICIT_AUTHORIZATION');
    }
  });

  it('con autorización explícita ⇒ permitido', () => {
    for (const clase of CLASES_MUTACION) {
      const v = evaluarMutacionExterna(clase, { ...base, modo: 'SUPERVISED_REAL', autorizacionExplicita: true });
      expect(v.permitido, clase).toBe(true);
      expect(v.permitido === true && v.motivo).toBe('EXPLICIT_AUTHORIZATION');
    }
  });
});

describe('AUTONOMOUS_REAL · contrato: sin mandato no hay autonomía', () => {
  it('sin mandato vigente ⇒ denegado', () => {
    for (const clase of CLASES_MUTACION) {
      const v = evaluarMutacionExterna(clase, { ...base, modo: 'AUTONOMOUS_REAL', mandatoVigente: false, autorizacionExplicita: true });
      expect(v.permitido, clase).toBe(false);
      expect(v.permitido === false && v.motivo).toBe('NO_ACTIVE_MANDATE');
    }
  });

  it('con mandato vigente ⇒ permitido (contrato definido; la ejecución completa llega en fases posteriores)', () => {
    const v = evaluarMutacionExterna('PRESUPUESTO', { ...base, modo: 'AUTONOMOUS_REAL', mandatoVigente: true });
    expect(v.permitido).toBe(true);
    expect(v.permitido === true && v.motivo).toBe('ACTIVE_MANDATE');
  });
});

describe('KILL SWITCH · manda sobre todo', () => {
  it('apagado ⇒ ninguna clase pasa, ni siquiera la pausa de seguridad', () => {
    for (const clase of [...CLASES_MUTACION, 'SAFETY_PAUSE' as const]) {
      const v = evaluarMutacionExterna(clase, {
        modo: 'AUTONOMOUS_REAL', mutacionesExternasHabilitadas: false,
        autorizacionExplicita: true, mandatoVigente: true, pausaSeguridadHabilitada: true,
      });
      expect(v.permitido, clase).toBe(false);
      expect(v.permitido === false && v.motivo).toBe('EXTERNAL_MUTATIONS_DISABLED');
    }
  });

  it('lee el entorno con valores razonables y por defecto deja las mutaciones habilitadas', () => {
    for (const valor of ['off', 'OFF', 'false', 'no', 'disabled', '0', ' off ']) {
      expect(mutacionesExternasHabilitadas({ SOEC_EXTERNAL_MUTATIONS: valor } as NodeJS.ProcessEnv), valor).toBe(false);
    }
    expect(mutacionesExternasHabilitadas({} as NodeJS.ProcessEnv)).toBe(true);
    expect(mutacionesExternasHabilitadas({ SOEC_EXTERNAL_MUTATIONS: 'on' } as NodeJS.ProcessEnv)).toBe(true);
    expect(estadoKillSwitch({ SOEC_EXTERNAL_MUTATIONS: 'off' } as NodeJS.ProcessEnv)).toEqual({ mutacionesExternasHabilitadas: false, valorDeclarado: 'off' });
  });
});

describe('SAFETY_PAUSE · política explícita de la organización', () => {
  it('habilitada ⇒ permitida en cualquier modo (pausar reduce exposición)', () => {
    for (const modo of ['OBSERVE', 'SUPERVISED_REAL', 'AUTONOMOUS_REAL'] as const) {
      const v = evaluarMutacionExterna('SAFETY_PAUSE', { ...base, modo, pausaSeguridadHabilitada: true });
      expect(v.permitido, modo).toBe(true);
      expect(v.permitido === true && v.motivo).toBe('SAFETY_PAUSE_ENABLED');
    }
  });

  it('deshabilitada o no declarada ⇒ denegada (nunca implícita)', () => {
    for (const politica of [false, undefined]) {
      const v = evaluarMutacionExterna('SAFETY_PAUSE', { ...base, modo: 'SUPERVISED_REAL', pausaSeguridadHabilitada: politica });
      expect(v.permitido).toBe(false);
      expect(v.permitido === false && v.motivo).toBe('SAFETY_PAUSE_NOT_ENABLED');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El kill switch también corta el ÚNICO camino de creación real (canary): gate central del envelope.
// Se usa el MISMO constructor de plan y envelope que producción, para no probar una maqueta.
// ─────────────────────────────────────────────────────────────────────────────
const T0 = '2026-08-25T00:00:00.000Z';
const ORG = 'org-smileflow';
const DISP: ChannelAvailability[] = [
  { canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' },
  { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' },
];
const READY: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' },
  sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' }, diagnosisCompletedAt: T0, evidenceSource: 'chrome', findings: [],
  validatedDestinations: [
    { url: 'https://x/#plans-trial', intent: 'plans', validated: true, public: true, available: true },
    { url: 'https://x/#features-how', intent: 'features', validated: true, public: true, available: true },
  ],
  valueProps: [
    { id: '1', capability: 'Agenda dental inteligente' },
    { id: '2', capability: 'Relleno automático de agenda' },
    { id: '3', capability: 'Ficha e historial clínico' },
  ],
  brandName: 'SmileFlow',
};
const ENTRADA: EntradaMarketingPlan = {
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10,
  startAt: T0, endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP', canalesSolicitados: ['google', 'meta'] as CanalId[], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'administracion clinica dental', impresiones: 300, clics: 12 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }, { termino: 'exocad', impresiones: 50, clics: 1 }] },
  readiness: READY, historicalCpa: null,
};
const PLAN = construirMarketingPlan(ENTRADA);
const ENVELOPE = aprobar(construirEnvelope(PLAN, ORG, 'plan:x', T0).envelope, PLAN, 'humano', '2026-08-25T01:00:00.000Z', ['google']).envelope;

describe('gate de ejecución autorizada · el kill switch corta antes que cualquier otra capa', () => {
  const prov: ProviderState = { executionEligibleChannels: ['google'], providerConnected: true, trackingValid: true, landingAvailable: true, now: '2026-08-26T00:00:00.000Z', contacts: 3 };
  const fin: FinancialState = { historicalSpend: 0, envelopeSpend: 0, committedSpend: 0 };
  const accion: AccionSolicitada = { canal: 'google', tipo: 'CREATE_CAMPAIGN' };

  it('con SUPERVISED_REAL y envelope aprobado, el kill switch deniega EXTERNAL_MUTATIONS_DISABLED', () => {
    const flags = derivarFlagsDeModo('SUPERVISED_REAL', { SOEC_EXTERNAL_MUTATIONS: 'off' } as NodeJS.ProcessEnv);
    expect(flags.mutacionesExternasHabilitadas).toBe(false);
    const r = validateAuthorizedExecution(ENVELOPE, PLAN, prov, fin, accion, flags);
    expect(r.decision).toBe('DENY');
    expect(r.reasonCode).toBe('EXTERNAL_MUTATIONS_DISABLED');
  });

  it('en OBSERVE (PILOT) deniega por modo aunque las mutaciones estén habilitadas', () => {
    const flags = derivarFlagsDeModo('PILOT', {} as NodeJS.ProcessEnv);
    const r = validateAuthorizedExecution(ENVELOPE, PLAN, prov, fin, accion, flags);
    expect(r.decision).toBe('DENY');
    expect(r.reasonCode).toBe('SUPERVISED_REAL_DISABLED');
  });

  it('en SUPERVISED_REAL con mutaciones habilitadas y envelope vigente, el gate permite la acción autorizada', () => {
    const flags = derivarFlagsDeModo('SUPERVISED_REAL', {} as NodeJS.ProcessEnv);
    const r = validateAuthorizedExecution(ENVELOPE, PLAN, prov, fin, accion, flags);
    expect(r.reasonCode).toBeNull();
    expect(r.decision).toBe('ALLOW');
  });
});
