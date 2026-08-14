/**
 * SOEC · HARDENING MULTIEMPRESA — verificación de la corrección de D-1…D-4 (FASE 4).
 *
 * La FASE 1 demostró que el NÚCLEO estaba aislado pero la SUPERFICIE DE EXPERIENCIA no: cuatro
 * puntos resolvían la organización desde constantes de módulo. Este archivo verifica, de extremo a
 * extremo, que eso ya no ocurre y —lo más importante— que la ausencia de configuración NUNCA se
 * resuelve con la de SmileFlow.
 *
 *   D-1  /medicion resuelve la organización del contexto autenticado
 *   D-2  la decisión de piloto es tenant-scoped
 *   D-3  el Director evalúa con el perfil de negocio de SU organización, o no evalúa
 *   D-4  toda experiencia REAL exige binding explícito organización↔experiencia
 *
 * `org-cyp` se usa como SEGUNDA ORGANIZACIÓN DE PRUEBA (aún NO creada en SOEC). Precisamente por
 * eso sirve: representa el caso "organización que todavía no está configurada", que es donde un
 * fallback silencioso a SmileFlow sería catastrófico.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import {
  ActorId,
  OrganizationId,
  ScopeMismatchError,
  type Attribution,
  type RequestContext,
} from '@soec/contracts';
import { buildApp } from '../src/app';
import {
  BindingDeExperienciaInvalidoError,
  IdentidadOrganizacionInvalidaError,
  OrganizacionNoRegistradaError,
  ORG_SMILEFLOW,
  BUSINESS_KEY_SMILEFLOW,
  assertTenantIdCanonico,
  bindExperienciaReal,
  buscarFuente,
  buscarNegocio,
  buscarProfile,
  canonizarAliasLegado,
  esAliasLegado,
  getBusiness,
  getProfile,
  getRecursoGoogleAds,
  getSources,
  organizacionesRegistradas,
} from '../src/plataforma';
import { LecturaDirectorRealService } from '../src/real-director/lectura-director-real';
import { PlanAccionDryRunService } from '../src/autonomia-ads/plan-accion-service';
import {
  adsSnapshotStreamId,
  EVENTO_ADS_SNAPSHOT,
} from '../src/ingesta/ingesta-google-ads-service';

/** Organización de prueba NO registrada: representa a C Y P antes de su alta. */
const ORG_CYP = 'org-cyp';
const AHORA = '2026-08-13T12:00:00.000Z';
const ATR: Attribution = {
  source: 't',
  purpose: 't',
  assumptions: [],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('t'),
    scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
    correlationId: `c-${org}`,
  };
}

/** Cabeceras del contexto vertical. En producción las inyecta el gateway tras validar la membresía. */
const H = (org: string) => ({
  'x-organization-id': org,
  'x-actor-id': 'usuario-prueba',
  'x-scope': 'events:read,events:append',
});

function makeApp(store = new InMemoryEventStore()) {
  return {
    app: buildApp({
      store,
      intelligence: new DeterministicIntelligenceProvider(),
      legacyDemoAccess: true,
    }),
    store,
  };
}

/** Siembra un snapshot REAL de SmileFlow: si hubiera fuga, su nombre de campaña aparecería. */
async function sembrarSmileFlow(store: InMemoryEventStore): Promise<void> {
  const c = ctx(ORG_SMILEFLOW);
  await store.append(c, adsSnapshotStreamId(ORG_SMILEFLOW), 0, [
    {
      type: EVENTO_ADS_SNAPSHOT,
      payload: {
        campaignId: '24120966895',
        campaignName: 'SmileFlow Search Chile',
        status: 'ENABLED',
        impressions: 273,
        clicks: 7,
        cost: 6028,
        at: AHORA,
      },
      attribution: ATR,
      occurredAt: AHORA,
    },
  ]);
}

const sinRastroDeSmileFlow = (cuerpo: unknown): void => {
  expect(JSON.stringify(cuerpo).toLowerCase()).not.toContain('smileflow');
  expect(JSON.stringify(cuerpo)).not.toContain('24120966895');
  expect(JSON.stringify(cuerpo)).not.toContain('8605539300');
};

// ─────────────────────────────────────────────────────────────────────────────
// IDENTIDAD CANÓNICA — CANONICAL_ORG_ID ╪ BUSINESS_KEY ╪ LEGACY_ALIAS
// ─────────────────────────────────────────────────────────────────────────────
describe('IDENTIDAD · una sola identidad canónica de organización', () => {
  it('CANONICAL_ORG_ID es el único tenant válido; los alias legados NO lo son', () => {
    expect(assertTenantIdCanonico(ORG_SMILEFLOW)).toBe('org-smileflow');
    // `smileflow-clinic` y `smileflow` son businessKey/alias, jamás claves de tenant.
    expect(() => assertTenantIdCanonico(BUSINESS_KEY_SMILEFLOW)).toThrow(
      IdentidadOrganizacionInvalidaError,
    );
    expect(() => assertTenantIdCanonico('smileflow')).toThrow(IdentidadOrganizacionInvalidaError);
    expect(esAliasLegado('smileflow-clinic')).toBe(true);
    expect(esAliasLegado(ORG_SMILEFLOW)).toBe(false);
  });

  it('la canonización de un alias es EXPLÍCITA y nunca ocurre en el camino de autorización', () => {
    expect(canonizarAliasLegado('smileflow-clinic')).toBe(ORG_SMILEFLOW);
    expect(canonizarAliasLegado('org-cyp')).toBeNull();
    // El registro sólo conoce claves canónicas.
    expect(organizacionesRegistradas()).toEqual([ORG_SMILEFLOW]);
    expect(buscarNegocio(BUSINESS_KEY_SMILEFLOW)).toBeNull();
  });

  it('el BUSINESS_KEY vive en el negocio, separado de la clave de tenant', () => {
    const negocio = getBusiness(ORG_SMILEFLOW);
    expect(negocio.organizationId).toBe(ORG_SMILEFLOW);
    expect(negocio.businessKey).toBe(BUSINESS_KEY_SMILEFLOW);
    expect(negocio.organizationId).not.toBe(negocio.businessKey);
    expect(negocio.legacyAliases).toContain('smileflow');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRO DE NEGOCIOS — FAIL-CLOSED, sin fallback
// ─────────────────────────────────────────────────────────────────────────────
describe('REGISTRO · organización desconocida ⇒ FAIL-CLOSED', () => {
  it('UNKNOWN_ORG = FAIL_CLOSED — negocio, perfil y fuentes lanzan; nunca devuelven los de otra', () => {
    expect(() => getBusiness(ORG_CYP)).toThrow(OrganizacionNoRegistradaError);
    expect(() => getProfile(ORG_CYP)).toThrow(OrganizacionNoRegistradaError);
    expect(() => getSources(ORG_CYP)).toThrow(OrganizacionNoRegistradaError);
    expect(buscarProfile(ORG_CYP)).toBeNull();
    expect(buscarNegocio(ORG_CYP)).toBeNull();
  });

  it('CYP_CANNOT_RESOLVE_SMILEFLOW_ADS_ACCOUNT — no hay forma de alcanzar la cuenta de Ads ajena', () => {
    expect(() => getRecursoGoogleAds(ORG_CYP)).toThrow(OrganizacionNoRegistradaError);
    expect(buscarFuente(ORG_CYP, 'google-ads')).toBeNull();
    expect(buscarFuente(ORG_CYP, 'smileflow-growth')).toBeNull();
    // La cuenta de SmileFlow sigue resolviéndose para SmileFlow, y sólo para SmileFlow.
    expect(getRecursoGoogleAds(ORG_SMILEFLOW).customerId).toMatch(/^\d{10}$/);
  });

  it('CYP_WITHOUT_PROFILE — sin política, sin campaña, sin credencial y sin fuente de SmileFlow', () => {
    let capturado: unknown = null;
    try {
      getProfile(ORG_CYP);
    } catch (e) {
      capturado = e;
    }
    expect(capturado).toBeInstanceOf(OrganizacionNoRegistradaError);
    sinRastroDeSmileFlow({ mensaje: (capturado as Error).message });
    expect(buscarFuente(ORG_CYP, 'google-ads')).toBeNull();
  });

  it('el registro no contiene NINGÚN valor de secreto, sólo referencias opacas', () => {
    const perfil = getProfile(ORG_SMILEFLOW);
    const serializado = JSON.stringify({ perfil, fuentes: getSources(ORG_SMILEFLOW) });
    for (const ref of perfil.cuentasExternas.map((c) => c.credentialRef).filter(Boolean)) {
      expect(ref).toMatch(/^(env|vault):/); // referencia, no valor
    }
    // Ningún material de credencial real puede aparecer serializado.
    expect(serializado).not.toMatch(/1\/\/0|ya29\.|-----BEGIN/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-4 — BINDING ORGANIZACIÓN ↔ EXPERIENCIA
// ─────────────────────────────────────────────────────────────────────────────
describe('D-4 · binding explícito organización↔experiencia', () => {
  it('EXPERIENCE_BINDING_REQUIRED — una organización registrada obtiene un binding coherente', () => {
    const b = bindExperienciaReal(ctx(ORG_SMILEFLOW), 'medicion-real');
    expect(b.organizationId).toBe(ORG_SMILEFLOW);
    expect(b.negocio.organizationId).toBe(ORG_SMILEFLOW);
    expect(b.perfil.organizationId).toBe(ORG_SMILEFLOW);
    expect(b.fuentes.every((f) => f.organizationId === ORG_SMILEFLOW)).toBe(true);
  });

  it('NO_IMPLICIT_SMILEFLOW_BINDING — una organización no registrada no obtiene binding alguno', () => {
    for (const exp of [
      'medicion-real',
      'director-real',
      'autonomia-ads',
      'piloto-decision',
    ] as const) {
      expect(() => bindExperienciaReal(ctx(ORG_CYP), exp)).toThrow(OrganizacionNoRegistradaError);
    }
  });

  it('FORGED_EXPERIENCE_ORG_BLOCKED — un contexto con alcance forjado se rechaza antes de resolver nada', () => {
    // Dice ser org-cyp pero lleva el alcance de org-smileflow.
    const forjado: RequestContext = {
      organizationId: OrganizationId(ORG_CYP),
      actor: ActorId('t'),
      scope: { organizationId: OrganizationId(ORG_SMILEFLOW), permissions: ['events:read'] },
      correlationId: 'forjado',
    };
    expect(() => bindExperienciaReal(forjado, 'medicion-real')).toThrow(ScopeMismatchError);

    // Y un alias legado usado como tenant tampoco entra.
    const alias: RequestContext = {
      organizationId: OrganizationId(BUSINESS_KEY_SMILEFLOW),
      actor: ActorId('t'),
      scope: {
        organizationId: OrganizationId(BUSINESS_KEY_SMILEFLOW),
        permissions: ['events:read'],
      },
      correlationId: 'alias',
    };
    expect(() => bindExperienciaReal(alias, 'medicion-real')).toThrow(
      IdentidadOrganizacionInvalidaError,
    );
  });

  it('una experiencia no habilitada para la organización se deniega explícitamente', () => {
    const negocio = getBusiness(ORG_SMILEFLOW);
    // Invariante del registro: sólo se habilitan experiencias declaradas.
    expect(negocio.experienciasHabilitadas).toContain('medicion-real');
    // Un binding con una experiencia fuera de la lista debe denegarse (se fuerza el tipo a propósito).
    expect(() =>
      bindExperienciaReal(ctx(ORG_SMILEFLOW), 'experiencia-inexistente' as never),
    ).toThrow(BindingDeExperienciaInvalidoError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-3 — DIRECTOR POR PERFIL DE NEGOCIO
// ─────────────────────────────────────────────────────────────────────────────
describe('D-3 · el Director evalúa con el perfil de SU organización o no evalúa', () => {
  it('MISSING_BUSINESS_PROFILE_FAILS_CLOSED — recalcular sobre una organización sin perfil LANZA', async () => {
    const store = new InMemoryEventStore();
    await sembrarSmileFlow(store);
    const svc = new LecturaDirectorRealService(store);
    await expect(svc.recalcular(ORG_CYP, AHORA)).rejects.toThrow(OrganizacionNoRegistradaError);
    // Nada se escribió en el stream del segundo tenant: no hay lectura fabricada.
    expect(await svc.leerUltima(ORG_CYP)).toBeNull();
  });

  it('CYP_DIRECTOR_NEVER_USES_SMILEFLOW_POLICY/CAMPAIGN — ni el plan de acción se genera', async () => {
    const store = new InMemoryEventStore();
    await sembrarSmileFlow(store);
    const plan = new PlanAccionDryRunService(store);
    await expect(plan.generar(ORG_CYP, AHORA)).rejects.toThrow(OrganizacionNoRegistradaError);
    expect(await plan.leerUltimo(ORG_CYP)).toBeNull();
  });

  it('SMILEFLOW_PROFILE_STILL_WORKS — la organización registrada sigue evaluándose igual', async () => {
    const store = new InMemoryEventStore();
    await sembrarSmileFlow(store);
    const lectura = await new LecturaDirectorRealService(store).recalcular(ORG_SMILEFLOW, AHORA);
    expect(lectura.naturaleza).toBe('REAL');
    expect(lectura.campaignId).toBe('24120966895');
    expect(lectura.hechos.impresiones).toBe(273);
    expect(lectura.veredicto).toBe('OBSERVAR');
    // Y su plan de acción sigue siendo dry-run sin propuestas (evidencia insuficiente).
    const plan = await new PlanAccionDryRunService(store).generar(ORG_SMILEFLOW, AHORA);
    expect(plan.modo).toBe('DRY_RUN');
    expect(plan.autonomousReal).toBe(false);
    expect(plan.totalPropuestas).toBe(0);
  });

  it('el perfil declara el modelo de negocio y su conversión primaria (no un universal)', () => {
    const perfil = getProfile(ORG_SMILEFLOW);
    expect(perfil.modeloDeNegocio).toBe('SAAS_FUNNEL');
    expect(perfil.directorContext.conversionPrimaria).toBe('demo_requested');
    // `demo_requested` es de SmileFlow, no de la plataforma: vive en SU perfil.
    expect(perfil.organizationId).toBe(ORG_SMILEFLOW);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-1 — SUPERFICIE HTTP DE MEDICIÓN
// ─────────────────────────────────────────────────────────────────────────────
describe('D-1 · /medicion es tenant-scoped de extremo a extremo', () => {
  it('D1_MEASUREMENT_CROSS_TENANT = BLOCKED — org-cyp no recibe NADA de SmileFlow', async () => {
    const { app, store } = makeApp();
    await sembrarSmileFlow(store);

    for (const url of [
      '/medicion/panel',
      '/medicion/reales',
      '/medicion/lectura-director',
      '/medicion/plan-accion',
      '/medicion/g2a-bandeja',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: H(ORG_CYP) });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'ORGANIZATION_NOT_CONFIGURED' });
      sinRastroDeSmileFlow(res.json());
    }
    await app.close();
  });

  it('SMILEFLOW_MEASUREMENT_CANNOT_READ_CYP — la respuesta de SmileFlow declara su propia organización', async () => {
    const { app, store } = makeApp();
    await sembrarSmileFlow(store);
    const res = await app.inject({
      method: 'GET',
      url: '/medicion/panel',
      headers: H(ORG_SMILEFLOW),
    });
    expect(res.statusCode).toBe(200);
    const cuerpo = res.json() as { organizationId: string; campaign: { id: string | null } };
    expect(cuerpo.organizationId).toBe(ORG_SMILEFLOW);
    expect(cuerpo.campaign.id).toBe('24120966895');
    await app.close();
  });

  it('UNKNOWN_ORG_FAILS_CLOSED — una organización inventada recibe 404, no los datos de SmileFlow', async () => {
    const { app, store } = makeApp();
    await sembrarSmileFlow(store);
    const res = await app.inject({
      method: 'GET',
      url: '/medicion/panel',
      headers: H('org-inventada-9'),
    });
    expect(res.statusCode).toBe(404);
    sinRastroDeSmileFlow(res.json());
    await app.close();
  });

  it('NO_DEFAULT_SMILEFLOW_ORG — sin contexto de organización no hay datos, hay rechazo', async () => {
    const { app, store } = makeApp();
    await sembrarSmileFlow(store);
    const res = await app.inject({ method: 'GET', url: '/medicion/panel' });
    expect(res.statusCode).toBe(403);
    sinRastroDeSmileFlow(res.json());
    await app.close();
  });

  it('un alias legado usado como organización se rechaza (400), no se canoniza en silencio', async () => {
    const { app, store } = makeApp();
    await sembrarSmileFlow(store);
    const res = await app.inject({
      method: 'GET',
      url: '/medicion/panel',
      headers: H(BUSINESS_KEY_SMILEFLOW),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVALID_ORGANIZATION_IDENTIFIER' });
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-2 — SUPERFICIE HTTP DE LA DECISIÓN DE PILOTO
// ─────────────────────────────────────────────────────────────────────────────
describe('D-2 · la decisión de piloto es tenant-scoped', () => {
  it('D2_PILOT_CROSS_TENANT = BLOCKED — org-cyp no puede preparar ni leer el expediente ajeno', async () => {
    const { app } = makeApp();
    const prep = await app.inject({
      method: 'POST',
      url: '/piloto/decision/preparar',
      headers: H(ORG_CYP),
    });
    expect(prep.statusCode).toBe(404);
    const est = await app.inject({
      method: 'GET',
      url: '/piloto/decision/estado',
      headers: H(ORG_CYP),
    });
    expect(est.statusCode).toBe(404);
    sinRastroDeSmileFlow(est.json());
    await app.close();
  });

  it('PILOT_EXPERIENCE_TENANT_SCOPED — SmileFlow sigue funcionando y declara su organización', async () => {
    const { app } = makeApp();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/piloto/decision/preparar',
          headers: H(ORG_SMILEFLOW),
        })
      ).statusCode,
    ).toBe(201);
    const est = await app.inject({
      method: 'GET',
      url: '/piloto/decision/estado',
      headers: H(ORG_SMILEFLOW),
    });
    expect(est.statusCode).toBe(200);
    const cuerpo = est.json() as { organizationId: string; empresa: string; existe: boolean };
    expect(cuerpo.organizationId).toBe(ORG_SMILEFLOW);
    expect(cuerpo.empresa).toBe('SmileFlow Clinic');
    expect(cuerpo.existe).toBe(true);
    await app.close();
  });

  it('CROSS_TENANT_PILOT_READ_BLOCKED — preparar en SmileFlow no hace visible nada en el otro tenant', async () => {
    const { app } = makeApp();
    await app.inject({
      method: 'POST',
      url: '/piloto/decision/preparar',
      headers: H(ORG_SMILEFLOW),
    });
    const est = await app.inject({
      method: 'GET',
      url: '/piloto/decision/estado',
      headers: H(ORG_CYP),
    });
    expect(est.statusCode).toBe(404);
    sinRastroDeSmileFlow(est.json());
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESIÓN DE GOBERNANZA — el endurecimiento no abrió nada
// ─────────────────────────────────────────────────────────────────────────────
describe('GOBERNANZA · el endurecimiento no abrió ninguna puerta', () => {
  it('SMILEFLOW_REGRESSION — la activación real del piloto sigue BLOQUEADA (409)', async () => {
    const { app } = makeApp();
    await app.inject({
      method: 'POST',
      url: '/piloto/decision/preparar',
      headers: H(ORG_SMILEFLOW),
    });
    const act = await app.inject({
      method: 'POST',
      url: '/piloto/decision/activar',
      headers: H(ORG_SMILEFLOW),
    });
    expect(act.statusCode).toBe(409);
    expect((act.json() as { permitida: boolean }).permitida).toBe(false);
    await app.close();
  });

  it('AUTONOMOUS_REAL sigue cerrado y el plan de acción sigue en DRY-RUN', async () => {
    const { app, store } = makeApp();
    await sembrarSmileFlow(store);
    const res = await app.inject({
      method: 'POST',
      url: '/medicion/plan-accion/generar',
      headers: H(ORG_SMILEFLOW),
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const plan = res.json() as { modo: string; autonomousReal: boolean };
    expect(plan.modo).toBe('DRY_RUN');
    expect(plan.autonomousReal).toBe(false);
    await app.close();
  });
});
