/**
 * SOEC · INCORPORACIÓN DE LA SEGUNDA ORGANIZACIÓN REAL — Distribuidora C Y P SpA (FASE 5).
 *
 * Verifica que C Y P existe como negocio INDEPENDIENTE de SmileFlow y que, al no tener todavía
 * fuentes ni perfil, SOEC lo dice honestamente en vez de:
 *   · mostrar datos de SmileFlow,
 *   · fabricar ceros,
 *   · o inventar objetivos, criterios, cuentas o credenciales.
 *
 * Incluye la prueba de EXTENSIBILIDAD: una TERCERA organización (ficticia, sólo de prueba) puede
 * registrarse por configuración, sin tocar el núcleo.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import { buildApp } from '../src/app';
import {
  BusinessProfileNoConfiguradoError,
  OrganizacionNoRegistradaError,
  ORG_SMILEFLOW,
  bindExperienciaReal,
  buscarFuente,
  buscarFuentes,
  buscarProfile,
  crearResolutorDeNegocios,
  getBusiness,
  getProfile,
  getRecursoGoogleAds,
  getSources,
  organizacionesRegistradas,
  type ConfiguracionOrganizacion,
} from '../src/plataforma';
import {
  ORG_CYP,
  BUSINESS_KEY_CYP,
  CONFIGURACION_ORG_CYP,
} from '../src/plataforma/negocios/org-cyp';
import { CONFIGURACION_ORG_SMILEFLOW } from '../src/plataforma/negocios/org-smileflow';
import { LecturaDirectorRealService } from '../src/real-director/lectura-director-real';
import { PlanAccionDryRunService } from '../src/autonomia-ads/plan-accion-service';
import { G2AService } from '../src/autonomia-ads/g2a-service';
import {
  adsSnapshotStreamId,
  EVENTO_ADS_SNAPSHOT,
} from '../src/ingesta/ingesta-google-ads-service';

const AHORA = '2026-08-14T12:00:00.000Z';
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

/** Siembra evidencia REAL de SmileFlow: si hubiera fuga, aparecería en las respuestas de C Y P. */
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
  await new ObservacionService(store, {} as never).registrarReal(
    c,
    'obs-sf-demo',
    {
      provider: 'smileflow-growth',
      externalEventId: 'sf-1',
      eventName: 'demo_requested',
      occurredAt: AHORA,
      kpiId: 'demos',
      metrica: 'demos',
      valor: 3,
      unidad: 'conteo',
      calidad: 'alta',
      cobertura: 1,
      diagnostico: false,
    },
    ATR,
    AHORA,
  );
}

const sinRastroDeSmileFlow = (cuerpo: unknown): void => {
  const s = JSON.stringify(cuerpo);
  expect(s.toLowerCase()).not.toContain('smileflow');
  expect(s).not.toContain('24120966895');
  expect(s).not.toContain('8605539300');
  expect(s).not.toContain('demo_requested');
};

// ─────────────────────────────────────────────────────────────────────────────
// EXISTENCIA E IDENTIDAD
// ─────────────────────────────────────────────────────────────────────────────
describe('C Y P · existencia e identidad', () => {
  it('CYP_ORG_EXISTS y SMILEFLOW_ORG_EXISTS — dos organizaciones registradas, distintas', () => {
    const registradas = organizacionesRegistradas();
    expect(registradas).toContain(ORG_CYP);
    expect(registradas).toContain(ORG_SMILEFLOW);
    expect(ORG_CYP).not.toBe(ORG_SMILEFLOW);

    const cyp = getBusiness(ORG_CYP);
    expect(cyp.organizationId).toBe('org-cyp');
    expect(cyp.businessKey).toBe(BUSINESS_KEY_CYP);
    expect(cyp.legalName).toBe('Distribuidora C Y P SpA');
    expect(cyp.displayName).toBe('Distribuidora C Y P');
    expect(cyp.mercado).toBe('Chile');
    expect(cyp.modeloDeNegocio).toBe('ECOMMERCE_DISTRIBUCION');
  });

  it('las cuatro identidades están separadas y ninguna se usa como otra', () => {
    const cyp = getBusiness(ORG_CYP);
    expect(cyp.organizationId).not.toBe(cyp.businessKey);
    expect(cyp.displayName).not.toBe(cyp.legalName);
    // El businessKey NO es una clave de tenant válida.
    expect(() => getBusiness(BUSINESS_KEY_CYP)).toThrow(OrganizacionNoRegistradaError);
  });

  it('NO_FAKE_DATA — el RUT no se inventa: es null y figura como pendiente humano', () => {
    const cyp = getBusiness(ORG_CYP);
    expect(cyp.rut).toBeNull();
    expect(cyp.datosHumanosPendientes.join(' ').toLowerCase()).toContain('rut');
    // Tampoco se inventa el de SmileFlow.
    expect(getBusiness(ORG_SMILEFLOW).rut).toBeNull();
  });

  it('CYP_STATUS — no arranca operativa: tras el discovery declara SOURCES_PARTIAL', () => {
    // Unas fuentes se observan (sitio, tienda, catálogo) y otras no existen: se conoce EN PARTE.
    expect(getBusiness(ORG_CYP).estado).toBe('SOURCES_PARTIAL');
    expect(getBusiness(ORG_SMILEFLOW).estado).toBe('OBSERVING');
  });

  it('las categorías son CONTEXTO DECLARADO, no un catálogo', () => {
    const cyp = getBusiness(ORG_CYP);
    expect(cyp.categoriasDeclaradas).toEqual([
      'insumos dentales',
      'aseo industrial',
      'desechables',
    ]);
    // No hay catálogo, SKU, precios, stock ni ventas INVENTADOS: no existe ningún campo de datos
    // comerciales en la configuración. (Nombrarlos como "lo que falta" sí es legítimo y esperado.)
    const serializado = JSON.stringify(CONFIGURACION_ORG_CYP);
    expect(serializado).not.toMatch(/"(sku|skus|productos|precios?|stock|ventas)"\s*:/i);
    expect(CONFIGURACION_ORG_CYP.fuentes.every((f) => f.externalAccountId === null)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERFIL, FUENTES Y CREDENCIALES — nada heredado de SmileFlow
// ─────────────────────────────────────────────────────────────────────────────
describe('C Y P · perfil, fuentes y credenciales propias', () => {
  it('CYP_PROFILE_NOT_SMILEFLOW — C Y P no tiene perfil y NO hereda el de SmileFlow', () => {
    expect(buscarProfile(ORG_CYP)).toBeNull();
    expect(() => getProfile(ORG_CYP)).toThrow(BusinessProfileNoConfiguradoError);
    // El de SmileFlow sigue existiendo, y sólo para SmileFlow.
    expect(getProfile(ORG_SMILEFLOW).organizationId).toBe(ORG_SMILEFLOW);
  });

  it('no se fijó ningún objetivo comercial sin datos: ROAS, CPA, ticket y margen son DESCONOCIDOS', () => {
    // No basta con que no aparezcan: aparecen, declarados explícitamente como no medidos.
    // Lo que se prohíbe es que tengan VALOR.
    expect(CONFIGURACION_ORG_CYP.perfil).toBeNull(); // sin política de evaluación
    const economia = CONFIGURACION_ORG_CYP.perfilComercial!.economia;
    for (const [clave, v] of Object.entries(economia)) {
      expect(v.conocido, `${clave} no puede tener valor`).toBe(false);
      expect(v.valor, `${clave} debe ser null, jamás 0`).toBeNull();
    }
    // Y en ninguna parte de la configuración hay una cifra económica suelta.
    expect(JSON.stringify(CONFIGURACION_ORG_CYP)).not.toMatch(/"(roas|cpa|cac|ltv)"\s*:\s*\d/i);
  });

  it('CYP_SOURCES_NOT_SMILEFLOW — todas sus fuentes son suyas y sólo lectura', () => {
    const fuentes = getSources(ORG_CYP);
    expect(fuentes.length).toBeGreaterThan(0);
    expect(fuentes.every((f) => f.organizationId === ORG_CYP)).toBe(true);
    expect(fuentes.every((f) => f.soloLectura === true)).toBe(true);
    // Ninguna fuente de C Y P usa credenciales: lo observado es público o está sin conectar.
    expect(fuentes.every((f) => f.estado !== 'CONNECTED_READ_ONLY')).toBe(true);
    // Toda fuente que NO se está leyendo explica qué falta (nunca aparece como "cero datos").
    const sinLectura = fuentes.filter((f) => f.estado !== 'OBSERVED');
    expect(sinLectura.length).toBeGreaterThan(0);
    expect(sinLectura.every((f) => f.faltantes.length > 0)).toBe(true);
    // Cubre el inventario pedido.
    const tipos = fuentes.map((f) => f.tipo);
    for (const t of [
      'WEBSITE',
      'ECOMMERCE',
      'ADS',
      'ANALYTICS',
      'TAG_MANAGER',
      'MERCHANT',
      'SALES',
      'CATALOG',
      'CRM',
      'PAYMENTS',
      'SHIPPING',
      'MESSAGING',
      'SOCIAL',
    ]) {
      expect(tipos).toContain(t);
    }
  });

  it('CYP_CREDENTIALS_NOT_SMILEFLOW — no resuelve NINGUNA credencial ni cuenta de SmileFlow', () => {
    // Ninguna credencial de C Y P apunta fuera de su propio depósito: todas son `file:org-cyp/…`.
    const refs = buscarFuentes(ORG_CYP).flatMap((f) => f.credenciales.map((c) => c.secretRef));
    expect(refs.every((r) => r.startsWith(`file:${ORG_CYP}/`))).toBe(true);
    expect(refs.some((r) => r.startsWith('env:'))).toBe(false); // nada del entorno compartido
    expect(buscarFuentes(ORG_CYP).every((f) => f.externalAccountId === null)).toBe(true);
    // No puede alcanzar la cuenta de Ads de nadie (no tiene perfil).
    expect(() => getRecursoGoogleAds(ORG_CYP)).toThrow(BusinessProfileNoConfiguradoError);
    // Y su fuente de Ads no lleva la credencial de SmileFlow.
    const ads = buscarFuente(ORG_CYP, 'google-ads');
    expect(ads?.credenciales).toEqual([]);
    // El discovery confirmó que ni siquiera hay etiqueta de Ads en el sitio.
    expect(ads?.estado).toBe('NOT_CONFIGURED');
    // La configuración de C Y P no menciona ninguna referencia de secreto ajena.
    expect(JSON.stringify(CONFIGURACION_ORG_CYP)).not.toContain('env:');
  });

  it('la fuente Growth de SmileFlow no pertenece ni es visible como fuente de C Y P', () => {
    expect(buscarFuente(ORG_CYP, 'smileflow-growth')).toBeNull();
    expect(buscarFuente(ORG_SMILEFLOW, 'smileflow-growth')?.organizationId).toBe(ORG_SMILEFLOW);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AISLAMIENTO ADVERSARIAL CON AMBAS ORGANIZACIONES REGISTRADAS
// ─────────────────────────────────────────────────────────────────────────────
describe('C Y P ↔ SmileFlow · aislamiento con ambas organizaciones creadas', () => {
  it('CYP_READ_ISOLATED — observaciones: C Y P no ve nada de SmileFlow', async () => {
    const store = new InMemoryEventStore();
    await sembrarSmileFlow(store);
    const obs = new ObservacionService(store, {} as never);
    expect(await obs.listarIds(ctx(ORG_SMILEFLOW))).toHaveLength(1);
    expect(await obs.listarIds(ctx(ORG_CYP))).toEqual([]);
    expect((await obs.cargar(ctx(ORG_CYP), 'obs-sf-demo')).existe).toBe(false);
  });

  it('CYP_DIRECTOR_NOT_SMILEFLOW — Director, plan y bandeja fallan explícitamente, sin datos ajenos', async () => {
    const store = new InMemoryEventStore();
    await sembrarSmileFlow(store);

    const director = new LecturaDirectorRealService(store);
    await expect(director.recalcular(ORG_CYP, AHORA)).rejects.toThrow(
      BusinessProfileNoConfiguradoError,
    );
    expect(await director.leerUltima(ORG_CYP)).toBeNull();

    const plan = new PlanAccionDryRunService(store);
    await expect(plan.generar(ORG_CYP, AHORA)).rejects.toThrow(BusinessProfileNoConfiguradoError);
    expect(await plan.leerUltimo(ORG_CYP)).toBeNull();

    // Sin intenciones propias, la bandeja es vacía (no la de SmileFlow).
    expect(await new G2AService(store).bandeja(ORG_CYP, AHORA)).toEqual([]);
  });

  it('CROSS_TENANT_EXECUTION — ninguna experiencia REAL se vincula a C Y P', () => {
    expect(getBusiness(ORG_CYP).experienciasHabilitadas).toEqual([]);
    for (const exp of [
      'medicion-real',
      'director-real',
      'autonomia-ads',
      'piloto-decision',
    ] as const) {
      // Falla por perfil ausente o por experiencia no habilitada; nunca devuelve un binding ajeno.
      expect(() => bindExperienciaReal(ctx(ORG_CYP), exp)).toThrow();
    }
    // SmileFlow sigue vinculándose con normalidad.
    expect(bindExperienciaReal(ctx(ORG_SMILEFLOW), 'medicion-real').organizationId).toBe(
      ORG_SMILEFLOW,
    );
  });

  it('SMILEFLOW_READ_ISOLATED — SmileFlow tampoco ve nada de C Y P', async () => {
    const store = new InMemoryEventStore();
    const obs = new ObservacionService(store, {} as never);
    await obs.registrarReal(
      ctx(ORG_CYP),
      'obs-cyp-1',
      {
        provider: 'ecommerce',
        externalEventId: 'cyp-1',
        eventName: 'purchase',
        occurredAt: AHORA,
        kpiId: 'pedidos',
        metrica: 'pedidos',
        valor: 1,
        unidad: 'conteo',
        calidad: 'alta',
        cobertura: 1,
        diagnostico: false,
      },
      ATR,
      AHORA,
    );
    expect(await obs.listarIds(ctx(ORG_SMILEFLOW))).toEqual([]);
    expect((await obs.cargar(ctx(ORG_SMILEFLOW), 'obs-cyp-1')).existe).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPERFICIE HTTP — la UI puede decir la verdad sobre C Y P
// ─────────────────────────────────────────────────────────────────────────────
describe('C Y P · superficie HTTP de incorporación', () => {
  it('CYP_UNKNOWN_METRICS_SHOW_PENDING — el estado del negocio se sirve sin perfil y sin métricas', async () => {
    const { app, store } = makeApp();
    await sembrarSmileFlow(store);

    const res = await app.inject({
      method: 'GET',
      url: '/plataforma/negocio',
      headers: H(ORG_CYP),
    });
    expect(res.statusCode).toBe(200);
    const c = res.json() as {
      organizationId: string;
      legalName: string;
      rut: string | null;
      estado: string;
      perfilDeEvaluacion: { configurado: boolean; motivo?: string };
      fuentes: { tipo: string; estado: string; faltantes: string[] }[];
      resumenFuentes: { conectadas: number };
      datosHumanosPendientes: string[];
    };

    expect(c.organizationId).toBe(ORG_CYP);
    expect(c.legalName).toBe('Distribuidora C Y P SpA');
    expect(c.rut).toBeNull();
    expect(c.estado).toBe('SOURCES_PARTIAL');
    expect(c.perfilDeEvaluacion.configurado).toBe(false);
    expect(c.perfilDeEvaluacion.motivo).toBe('BUSINESS_PROFILE_NOT_CONFIGURED');
    expect(c.resumenFuentes.conectadas).toBe(0);
    expect(c.fuentes.every((f) => f.estado !== 'CONNECTED_READ_ONLY')).toBe(true);
    expect(c.datosHumanosPendientes.length).toBeGreaterThan(5);
    sinRastroDeSmileFlow(c);
  });

  it('NO_FAKE_ZEROES — C Y P no recibe métricas en cero: recibe "no configurado"', async () => {
    const { app, store } = makeApp();
    await sembrarSmileFlow(store);

    // Las rutas REALES rechazan a C Y P con un motivo explícito, en vez de devolver ceros.
    // 403 EXPERIENCE_BINDING_DENIED (la experiencia no está habilitada para este negocio) llega
    // antes que 409 BUSINESS_PROFILE_NOT_CONFIGURED; ambas son honestas y ninguna devuelve datos.
    for (const url of [
      '/medicion/panel',
      '/medicion/reales',
      '/medicion/lectura-director',
      '/medicion/plan-accion',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: H(ORG_CYP) });
      expect([403, 409]).toContain(res.statusCode);
      const cuerpo = res.json() as { error: string };
      expect(['EXPERIENCE_BINDING_DENIED', 'BUSINESS_PROFILE_NOT_CONFIGURED']).toContain(
        cuerpo.error,
      );
      sinRastroDeSmileFlow(cuerpo);
    }
    // Y el estado de negocio no reporta ninguna cifra comercial.
    const estado = (
      await app.inject({ method: 'GET', url: '/plataforma/negocio', headers: H(ORG_CYP) })
    ).json();
    expect(JSON.stringify(estado)).not.toMatch(
      /"impresiones"|"clics"|"gasto"|"ingresos"|"pedidos"/i,
    );
    await app.close();
  });

  it('el selector de negocios lista nombre y estado, sin métricas ni cuentas', async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/plataforma/negocios',
      headers: H(ORG_CYP),
    });
    expect(res.statusCode).toBe(200);
    const { negocios } = res.json() as { negocios: { organizationId: string; estado: string }[] };
    expect(negocios.map((n) => n.organizationId).sort()).toEqual(['org-cyp', 'org-smileflow']);
    // Selector, NO portafolio: ninguna cifra, ninguna cuenta externa, ninguna credencial.
    const s = JSON.stringify(negocios);
    expect(s).not.toMatch(/impresiones|clics|gasto|customerId|credentialRef|env:|campaignId/i);
    await app.close();
  });

  it('SmileFlow conserva su superficie REAL intacta', async () => {
    const { app, store } = makeApp();
    await sembrarSmileFlow(store);
    const panel = await app.inject({
      method: 'GET',
      url: '/medicion/panel',
      headers: H(ORG_SMILEFLOW),
    });
    expect(panel.statusCode).toBe(200);
    expect((panel.json() as { organizationId: string }).organizationId).toBe(ORG_SMILEFLOW);

    const negocio = await app.inject({
      method: 'GET',
      url: '/plataforma/negocio',
      headers: H(ORG_SMILEFLOW),
    });
    expect(negocio.statusCode).toBe(200);
    const n = negocio.json() as { estado: string; perfilDeEvaluacion: { configurado: boolean } };
    expect(n.estado).toBe('OBSERVING');
    expect(n.perfilDeEvaluacion.configurado).toBe(true);
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSIBILIDAD — una TERCERA organización sin tocar el núcleo
// ─────────────────────────────────────────────────────────────────────────────
describe('EXTENSIBILIDAD · una tercera organización se registra por configuración', () => {
  /**
   * Organización FICTICIA, exclusivamente de prueba. No representa ningún negocio real y no se
   * incorpora al despliegue: sólo demuestra que la puerta de extensión existe.
   */
  const TERCERA_DE_PRUEBA: ConfiguracionOrganizacion = {
    negocio: {
      organizationId: 'org-tercera-de-prueba',
      businessKey: 'tercera-de-prueba',
      legalName: 'Tercera Organización de Prueba SpA (FICTICIA)',
      displayName: 'Tercera de Prueba (ficticia)',
      rut: null,
      modeloDeNegocio: 'SERVICIOS',
      mercado: 'Chile',
      estado: 'CREATED',
      categoriasDeclaradas: [],
      legacyAliases: [],
      experienciasHabilitadas: [],
      decisionPiloto: null,
      datosHumanosPendientes: ['todo: es una organización ficticia de prueba'],
    },
    perfilComercial: null,
    perfil: null,
    fuentes: [],
  };

  it('THIRD_ORG_CAN_BE_REGISTERED_WITHOUT_CORE_CHANGE — basta añadir su configuración', () => {
    const resolutor = crearResolutorDeNegocios([
      CONFIGURACION_ORG_SMILEFLOW,
      CONFIGURACION_ORG_CYP,
      TERCERA_DE_PRUEBA,
    ]);

    expect(resolutor.organizacionesRegistradas()).toEqual([
      'org-smileflow',
      'org-cyp',
      'org-tercera-de-prueba',
    ]);
    expect(resolutor.getBusiness('org-tercera-de-prueba').displayName).toContain('ficticia');
    // Y sigue siendo fail-closed: sin perfil no evalúa, y no hereda el de nadie.
    expect(() => resolutor.getProfile('org-tercera-de-prueba')).toThrow(
      BusinessProfileNoConfiguradoError,
    );
    // Las otras dos no se contaminan.
    expect(resolutor.getProfile(ORG_SMILEFLOW).organizationId).toBe(ORG_SMILEFLOW);
    expect(resolutor.buscarProfile(ORG_CYP)).toBeNull();
  });

  it('la organización ficticia NO está en el despliegue real', () => {
    expect(organizacionesRegistradas()).not.toContain('org-tercera-de-prueba');
    expect(organizacionesRegistradas()).toEqual([ORG_SMILEFLOW, ORG_CYP]);
  });

  it('el registro rechaza organizaciones duplicadas', () => {
    expect(() => crearResolutorDeNegocios([CONFIGURACION_ORG_CYP, CONFIGURACION_ORG_CYP])).toThrow(
      /duplicada/i,
    );
  });
});
