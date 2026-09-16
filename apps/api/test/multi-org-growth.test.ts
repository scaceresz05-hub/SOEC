/**
 * GATE 3.2 · INGESTA GROWTH MULTIEMPRESA + EMBUDO POR ORGANIZACIÓN + PRIVACIDAD V1.
 *
 * Lo que estas pruebas fijan como contrato:
 *
 *   · MULTI_ORG_GROWTH_ADAPTER — el adaptador de ingesta se construye desde la FUENTE REGISTRADA
 *     (provider, origen, hosts, ruta, credencial). No hay proveedor cableado en el código.
 *   · DYNAMIC_PROVIDER — el `provider` de las observaciones y del cursor sale de la organización;
 *     dos organizaciones NUNCA comparten identidad ni espacio de idempotencia.
 *   · HOST_ALLOWLIST_DEFAULT_DENY — sólo los hosts que la fuente autoriza; allowlist vacía deniega todo.
 *   · SMILEFLOW_REGRESSION / SMILEFLOW_FUNNEL_UNCHANGED — SmileFlow conserva provider, host, ruta,
 *     stream de cursor y embudo exactamente como antes.
 *   · ORG_SPECIFIC_FUNNEL / CP_FUNNEL — el panel construye el embudo desde la configuración de la
 *     organización; el de CP son sus eventos de intención, no los `demo_*` de SmileFlow.
 *   · SERVICE_EVENTS_WITH_LEADREF_FORBIDDEN — la regla V1 de privacidad se aplica en la frontera.
 *   · Sin fallback silencioso: una organización sin perfil sigue fallando y nadie hereda nada.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { AdaptadorExterno, SalidaAdaptador, SolicitudAdaptador } from '@soec/adaptadores';
import { SecretStoreEnv } from '@soec/secretos';
import { ObservacionService } from '@soec/motor-medicion';

import {
  ESQUEMA_EGRESS_GROWTH,
  GrowthAdapter,
  crearGrowthAdapter,
} from '../src/ingesta/growth-adapter';
import { IngestaGrowth } from '../src/ingesta/ingesta-growth-service';
import { IngestaSmileFlowGrowth } from '../src/ingesta/ingesta-smileflow-service';
import {
  mapearEventoGrowth,
  observacionIdDe,
  type EventoGrowth,
} from '../src/ingesta/mapa-growth';
import {
  PrivacidadGrowthError,
  violacionDePrivacidadGrowth,
} from '../src/ingesta/politica-privacidad-growth';
import {
  construirPanel,
  type ConfiguracionPanel,
  type ObsPanel,
} from '../src/ingesta/panel-resultados';
import {
  BusinessProfileNoConfiguradoError,
  EmbudoNoConfiguradoError,
  ORG_SMILEFLOW,
  OrganizacionNoRegistradaError,
  SinFuenteDeDatosError,
  bindExperienciaReal,
  buscarFuente,
  buscarFuenteGrowth,
  getBusiness,
  getEmbudo,
  getFuenteGrowth,
  getProfile,
  getSources,
  organizacionesRegistradas,
} from '../src/plataforma';
import { ORG_CYP } from '../src/plataforma/negocios/org-cyp';
import {
  BUSINESS_KEY_CP_ODONTOLOGIA,
  EMBUDO_CP_ODONTOLOGIA,
  ORG_CP_ODONTOLOGIA,
  PROVIDER_GROWTH_CP_ODONTOLOGIA,
} from '../src/plataforma/negocios/org-cp-odontologia';
import {
  HOST_GROWTH_SMILEFLOW,
  PROVIDER_GROWTH_SMILEFLOW,
} from '../src/plataforma/negocios/org-smileflow';

const AHORA = '2026-09-15T12:00:00.000Z';
const TOKEN_SF = 'token-sf-ficticio';
const TOKEN_CP = 'token-cp-ficticio';

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('gate-3-2'),
    scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
    correlationId: `gate-3-2-${org}`,
  };
}

function solicitud(cursor = '0'): SolicitudAdaptador {
  return {
    solicitudId: 's1',
    capacidadId: 'ingesta-growth',
    peticion: { operacion: 'growth-events', parametros: { cursor, limit: '50' } },
  };
}

/** Entorno ficticio: nunca valores reales. Los tokens de una org no sirven para la otra. */
const ENV = {
  SMILEFLOW_GROWTH_TOKEN: TOKEN_SF,
  CP_ODONTOLOGIA_GROWTH_TOKEN: TOKEN_CP,
} as const;

function ev(over: Partial<EventoGrowth> = {}): EventoGrowth {
  return {
    event_id: 10,
    event_name: 'whatsapp_intent',
    occurred_at: AHORA,
    anon_id: 'anon-1',
    path: '/',
    utm_source: null,
    utm_campaign: null,
    value: null,
    lead_id: null,
    ...over,
  };
}

/** Adaptador fake que entrega los eventos dados cuando el cursor pedido es 0. */
function adaptadorCon(eventos: readonly EventoGrowth[], next: number | null = null): AdaptadorExterno {
  return {
    nombre: 'fake',
    capacidad: 'ingesta-growth',
    version: '0',
    soportaReal: () => false,
    salud: async () => ({ estado: 'SALUDABLE', detalle: 'fake' }),
    ejecutar: async (_c, sol): Promise<SalidaAdaptador> => {
      const cursor = Number(sol.peticion.parametros.cursor ?? '0');
      const datos = cursor === 0 ? eventos : [];
      return {
        estado: 'OK',
        salida: { body: JSON.stringify({ datos, next_cursor: datos.length ? next : null }) },
        error: null,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CP_BUSINESS_PROFILE · la organización existe, es propia y no hereda nada
// ─────────────────────────────────────────────────────────────────────────────
describe('CP Odontología · configuración registrada', () => {
  it('está registrada en el despliegue, con identidad y modelo de negocio propios', () => {
    expect(organizacionesRegistradas()).toContain(ORG_CP_ODONTOLOGIA);
    const n = getBusiness(ORG_CP_ODONTOLOGIA);
    expect(n.organizationId).toBe('org-cp-odontologia');
    expect(n.businessKey).toBe(BUSINESS_KEY_CP_ODONTOLOGIA); // slug/config key: 'cp-odontologia'
    expect(n.displayName).toBe('CP Odontología');
    expect(n.modeloDeNegocio).toBe('SERVICIOS');
    expect(n.mercado).toBe('Chile');
    // No se inventa identidad tributaria ni se habilita ninguna experiencia REAL.
    expect(n.rut).toBeNull();
    expect(n.experienciasHabilitadas).toEqual([]);
  });

  it('declara UNA fuente GROWTH propia, por referencia opaca y conectada en solo lectura', () => {
    const fuentes = getBusiness(ORG_CP_ODONTOLOGIA) && buscarFuenteGrowth(ORG_CP_ODONTOLOGIA);
    expect(fuentes).not.toBeNull();
    expect(fuentes!.provider).toBe(PROVIDER_GROWTH_CP_ODONTOLOGIA);
    expect(fuentes!.provider).toBe('cp-odontologia-growth');
    expect(fuentes!.organizationId).toBe(ORG_CP_ODONTOLOGIA);
    expect(fuentes!.credencialRef).toBe('env:CP_ODONTOLOGIA_GROWTH_TOKEN');
    // El estado refleja un HECHO verificado: el puente contra el host de STAGING está publicado, el
    // token depositado y la ingesta real corrió. Mismo valor que usa la fuente Growth de SmileFlow.
    expect(fuentes!.estado).toBe('CONNECTED_READ_ONLY');
    // Conectada no significa completa: el host de PRODUCCIÓN sigue sin autorizar y así se declara.
    const registrada = getSources(ORG_CP_ODONTOLOGIA).find(
      (f) => f.sourceId === 'src-cp-odontologia-growth',
    );
    expect(registrada!.faltantes).toEqual([
      'host de producción autorizado (sólo cuando el sitio nuevo esté en producción)',
    ]);
    // Lo satisfecho ya no se declara pendiente: ni el endpoint ni el depósito del token.
    expect(registrada!.faltantes.join(' ')).not.toMatch(/endpoint|token/i);
  });

  it('autoriza los hosts de PRODUCCIÓN sin dejar de autorizar el staging, y sin comodines', () => {
    const g = getFuenteGrowth(ORG_CP_ODONTOLOGIA);
    expect([...g.hostsAutorizados].sort()).toEqual([
      'cp-odontologia-stg.pages.dev',
      'dentistaclaudiapacheco.cl',
      'www.dentistaclaudiapacheco.cl',
    ]);
    // Allowlist CERRADA: ni comodines ni sufijos. Un '*' aquí convertiría default-deny en permitir todo.
    for (const h of g.hostsAutorizados) expect(h).not.toMatch(/[*?]/);
    // Autorizar no es dirigir: hasta el corte, el origen efectivo sigue siendo el staging.
    expect(g.baseUrl).toBe('https://cp-odontologia-stg.pages.dev');
    expect(g.rutaIngesta).toBe('/integrations/soec/growth-events');
  });

  it('la configuración NO contiene el valor de ningún secreto', () => {
    const s = JSON.stringify(buscarFuenteGrowth(ORG_CP_ODONTOLOGIA));
    expect(s).not.toContain(TOKEN_CP);
    expect(s).toContain('env:'); // sólo referencias opacas
  });

  it('CP_FUNNEL — conversión primaria whatsapp_intent; secundarias appointment_intent y phone_intent', () => {
    expect(getEmbudo(ORG_CP_ODONTOLOGIA)).toEqual(EMBUDO_CP_ODONTOLOGIA);
    expect(getEmbudo(ORG_CP_ODONTOLOGIA).conversionPrimaria).toBe('whatsapp_intent');
    expect([...getEmbudo(ORG_CP_ODONTOLOGIA).conversionesSecundarias].sort()).toEqual([
      'appointment_intent',
      'phone_intent',
    ]);
    // Todavía NO hay eventos de tratamiento en el embudo (decisión explícita de este gate).
    const todos = [
      getEmbudo(ORG_CP_ODONTOLOGIA).conversionPrimaria,
      ...getEmbudo(ORG_CP_ODONTOLOGIA).conversionesSecundarias,
    ];
    expect(todos.some((e) => e.startsWith('service_viewed'))).toBe(false);
  });

  it('sin perfil de evaluación SIGUE fallando: no evalúa ni hereda el de nadie', () => {
    expect(() => getProfile(ORG_CP_ODONTOLOGIA)).toThrow(BusinessProfileNoConfiguradoError);
    expect(() => bindExperienciaReal(ctx(ORG_CP_ODONTOLOGIA), 'medicion-real')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC_PROVIDER · sin fallback silencioso entre organizaciones
// ─────────────────────────────────────────────────────────────────────────────
describe('Resolución por organización · sin fallback silencioso', () => {
  it('cada organización resuelve SU fuente Growth; ninguna resuelve la de otra', () => {
    expect(getFuenteGrowth(ORG_SMILEFLOW).provider).toBe(PROVIDER_GROWTH_SMILEFLOW);
    expect(getFuenteGrowth(ORG_CP_ODONTOLOGIA).provider).toBe(PROVIDER_GROWTH_CP_ODONTOLOGIA);
    expect(getFuenteGrowth(ORG_SMILEFLOW).provider).not.toBe(
      getFuenteGrowth(ORG_CP_ODONTOLOGIA).provider,
    );
    // CP no tiene —ni puede ver— la fuente de SmileFlow.
    expect(buscarFuente(ORG_CP_ODONTOLOGIA, PROVIDER_GROWTH_SMILEFLOW)).toBeNull();
    expect(buscarFuente(ORG_SMILEFLOW, PROVIDER_GROWTH_CP_ODONTOLOGIA)).toBeNull();
    // Hosts y credenciales tampoco se cruzan.
    expect(getFuenteGrowth(ORG_CP_ODONTOLOGIA).hostsAutorizados).not.toContain(
      HOST_GROWTH_SMILEFLOW,
    );
    expect(getFuenteGrowth(ORG_CP_ODONTOLOGIA).credencialRef).not.toBe(
      getFuenteGrowth(ORG_SMILEFLOW).credencialRef,
    );
  });

  it('una organización SIN fuente Growth lanza en vez de heredar una (C Y P)', () => {
    expect(buscarFuenteGrowth(ORG_CYP)).toBeNull();
    expect(() => getFuenteGrowth(ORG_CYP)).toThrow(SinFuenteDeDatosError);
  });

  it('una organización SIN embudo ni perfil lanza en vez de usar el de otra (C Y P)', () => {
    expect(() => getEmbudo(ORG_CYP)).toThrow(EmbudoNoConfiguradoError);
  });

  it('una organización NO registrada lanza; nunca devuelve configuración ajena', () => {
    expect(() => getFuenteGrowth('org-inexistente')).toThrow(OrganizacionNoRegistradaError);
    expect(() => getEmbudo('org-inexistente')).toThrow(OrganizacionNoRegistradaError);
    expect(buscarFuenteGrowth('org-inexistente')).toBeNull();
  });

  it('el id de observación y el cursor llevan el provider de la organización, no uno fijo', () => {
    const e = ev({ event_id: 77 });
    expect(observacionIdDe(e, PROVIDER_GROWTH_CP_ODONTOLOGIA)).toBe('cp-odontologia-growth:77');
    expect(observacionIdDe(e, PROVIDER_GROWTH_SMILEFLOW)).toBe('smileflow-growth:77');
    expect(observacionIdDe(e, PROVIDER_GROWTH_CP_ODONTOLOGIA)).not.toBe(
      observacionIdDe(e, PROVIDER_GROWTH_SMILEFLOW),
    );
    // El mapeo tampoco fija el provider ni el `source`.
    const m = mapearEventoGrowth(e, PROVIDER_GROWTH_CP_ODONTOLOGIA);
    expect(m.provider).toBe('cp-odontologia-growth');
    expect(m.source).toBe('cp-odontologia-growth');
    expect(JSON.stringify(m)).not.toContain('smileflow');
  });

  it('sin provider no hay mapeo: se exige, no se rellena por defecto', () => {
    expect(() => observacionIdDe(ev(), '')).toThrow(/provider requerido/i);
    expect(() => mapearEventoGrowth(ev(), '  ')).toThrow(/provider requerido/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MULTI_ORG_GROWTH_ADAPTER + HOST_ALLOWLIST_DEFAULT_DENY + token exigido
// ─────────────────────────────────────────────────────────────────────────────
describe('GrowthAdapter · gobernado por la fuente registrada', () => {
  const secretStore = () => new SecretStoreEnv(ENV);

  it('SmileFlow: mismo provider, host y ruta que antes (regresión de wiring)', async () => {
    let url = '';
    let token: string | null = null;
    const fetchFn = (async (input: string | URL, init?: RequestInit) => {
      url = String(input);
      token = String((init?.headers as Record<string, string>)['X-Ingest-Token']);
      return new Response('{"datos":[],"next_cursor":null}', { status: 200 });
    }) as typeof fetch;

    const adapter = crearGrowthAdapter(getFuenteGrowth(ORG_SMILEFLOW), {
      secretStore: secretStore(),
      esquemaEgress: ESQUEMA_EGRESS_GROWTH,
      env: ENV,
      fetchFn,
    });
    expect(adapter.nombre).toBe('smileflow-growth');
    const res = await adapter.ejecutar(ctx(ORG_SMILEFLOW), solicitud());

    expect(res.estado).toBe('OK');
    expect(url).toContain(`https://${HOST_GROWTH_SMILEFLOW}/integrations/soec/growth-events`);
    expect(url).toContain('cursor=0');
    expect(token).toBe(TOKEN_SF);
    // El token viaja por cabecera y jamás por URL ni salida.
    expect(url).not.toContain(TOKEN_SF);
    expect(JSON.stringify(res)).not.toContain(TOKEN_SF);
  });

  it('CP: el adaptador usa SU host y SU credencial, sin tocar los de SmileFlow', async () => {
    let url = '';
    let token: string | null = null;
    const fetchFn = (async (input: string | URL, init?: RequestInit) => {
      url = String(input);
      token = String((init?.headers as Record<string, string>)['X-Ingest-Token']);
      return new Response('{"datos":[],"next_cursor":null}', { status: 200 });
    }) as typeof fetch;

    const descriptor = getFuenteGrowth(ORG_CP_ODONTOLOGIA);
    const adapter = crearGrowthAdapter(descriptor, {
      secretStore: secretStore(),
      esquemaEgress: ESQUEMA_EGRESS_GROWTH,
      env: ENV,
      fetchFn,
    });
    expect(adapter.nombre).toBe('cp-odontologia-growth');
    const res = await adapter.ejecutar(ctx(ORG_CP_ODONTOLOGIA), solicitud());

    expect(res.estado).toBe('OK');
    expect(url).toContain(descriptor.hostsAutorizados[0]!);
    expect(url).not.toContain(HOST_GROWTH_SMILEFLOW);
    expect(token).toBe(TOKEN_CP);
    expect(token).not.toBe(TOKEN_SF);
  });

  it('HOST_ALLOWLIST_DEFAULT_DENY — host fuera de la allowlist: ERROR y fetch no se invoca', async () => {
    let llamado = false;
    const fetchFn = (async () => {
      llamado = true;
      return new Response('nope', { status: 200 });
    }) as typeof fetch;

    const adapter = new GrowthAdapter({
      secretStore: secretStore(),
      secretRef: 'env:SMILEFLOW_GROWTH_TOKEN',
      esquemaEgress: ESQUEMA_EGRESS_GROWTH,
      provider: 'x-growth',
      baseUrl: 'https://evil.example.com',
      hostsAutorizados: [HOST_GROWTH_SMILEFLOW],
      rutaIngesta: '/integrations/soec/growth-events',
      fetchFn,
    });
    const res = await adapter.ejecutar(ctx(ORG_SMILEFLOW), solicitud());

    expect(res.estado).toBe('ERROR');
    expect(res.error?.clase).toBe('NO_AUTORIZADO');
    expect(llamado).toBe(false);
  });

  it('HOST_ALLOWLIST_DEFAULT_DENY — allowlist VACÍA deniega todo (nunca "permitir todo")', async () => {
    let llamado = false;
    const fetchFn = (async () => {
      llamado = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const adapter = new GrowthAdapter({
      secretStore: secretStore(),
      secretRef: 'env:SMILEFLOW_GROWTH_TOKEN',
      esquemaEgress: ESQUEMA_EGRESS_GROWTH,
      provider: 'x-growth',
      baseUrl: `https://${HOST_GROWTH_SMILEFLOW}`,
      hostsAutorizados: [],
      rutaIngesta: '/integrations/soec/growth-events',
      fetchFn,
    });
    const res = await adapter.ejecutar(ctx(ORG_SMILEFLOW), solicitud());

    expect(res.estado).toBe('ERROR');
    expect(res.error?.clase).toBe('NO_AUTORIZADO');
    expect(llamado).toBe(false);
  });

  it('el registro rechaza una fuente Growth cuya allowlist esté vacía (no llega a construirse)', () => {
    // Defensa en el otro extremo: la fuente no puede declararse "sin hosts" y pasar desapercibida.
    // Se verifica con el resolutor puro, sin tocar el despliegue real.
    expect(() => getFuenteGrowth(ORG_CYP)).toThrow(SinFuenteDeDatosError);
  });

  it('el token de ingesta SIGUE siendo obligatorio: sin él, ERROR y sin llamada de red', async () => {
    let llamado = false;
    const fetchFn = (async () => {
      llamado = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const adapter = crearGrowthAdapter(getFuenteGrowth(ORG_CP_ODONTOLOGIA), {
      secretStore: new SecretStoreEnv({}), // entorno SIN el token
      esquemaEgress: ESQUEMA_EGRESS_GROWTH,
      env: {},
      fetchFn,
    });
    const res = await adapter.ejecutar(ctx(ORG_CP_ODONTOLOGIA), solicitud());

    expect(res.estado).toBe('ERROR');
    expect(res.salida).toBeNull();
    expect(llamado).toBe(false);
  });

  it('el egress sigue cerrado: un campo no declarado se DESCARTA y no sale hacia el proveedor', async () => {
    let url = '';
    const fetchFn = (async (input: string | URL) => {
      url = String(input);
      return new Response('{"datos":[],"next_cursor":null}', { status: 200 });
    }) as typeof fetch;

    const adapter = crearGrowthAdapter(getFuenteGrowth(ORG_SMILEFLOW), {
      secretStore: secretStore(),
      esquemaEgress: ESQUEMA_EGRESS_GROWTH,
      env: ENV,
      fetchFn,
    });
    const res = await adapter.ejecutar(ctx(ORG_SMILEFLOW), {
      solicitudId: 's2',
      capacidadId: 'ingesta-growth',
      peticion: {
        operacion: 'growth-events',
        parametros: { cursor: '0', email: 'paciente@example.com' },
      },
    });
    // Default-deny por omisión: lo no declarado se descarta; lo declarado sí viaja.
    expect(res.estado).toBe('OK');
    expect(url).toContain('cursor=0');
    expect(url).not.toContain('email');
    expect(url).not.toContain('paciente');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INGESTA · cursor e idempotencia con provider dinámico
// ─────────────────────────────────────────────────────────────────────────────
describe('IngestaGrowth · cursor e idempotencia por organización', () => {
  const EVENTOS = [ev({ event_id: 10 }), ev({ event_id: 11, event_name: 'phone_intent' })];

  it('ingiere, avanza el cursor y es idempotente en una organización no-SmileFlow', async () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    const ingesta = new IngestaGrowth({
      adaptador: adaptadorCon(EVENTOS, 11),
      observaciones,
      store,
      org: ORG_CP_ODONTOLOGIA,
      provider: PROVIDER_GROWTH_CP_ODONTOLOGIA,
    });

    const r1 = await ingesta.correrUnaVez(ctx(ORG_CP_ODONTOLOGIA), { ahora: AHORA });
    expect(r1.leidos).toBe(2);
    expect(r1.nuevos).toBe(2);
    expect(r1.cursorAntes).toBe(0);
    expect(r1.cursorDespues).toBe(11);

    const r2 = await ingesta.correrUnaVez(ctx(ORG_CP_ODONTOLOGIA), { ahora: AHORA });
    expect(r2.cursorAntes).toBe(11); // arrancó del checkpoint propio
    expect(r2.nuevos).toBe(0);
    expect(await observaciones.listarIds(ctx(ORG_CP_ODONTOLOGIA))).toHaveLength(2);

    // Los ids llevan el provider de CP: no colisionan con los de SmileFlow.
    const ids = await observaciones.listarIds(ctx(ORG_CP_ODONTOLOGIA));
    expect(ids.every((i) => i.startsWith('cp-odontologia-growth:'))).toBe(true);
  });

  it('el cursor de una organización no es el de otra (streams separados por provider)', async () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    const ingestaCp = new IngestaGrowth({
      adaptador: adaptadorCon(EVENTOS, 11),
      observaciones,
      store,
      org: ORG_CP_ODONTOLOGIA,
      provider: PROVIDER_GROWTH_CP_ODONTOLOGIA,
    });
    await ingestaCp.correrUnaVez(ctx(ORG_CP_ODONTOLOGIA), { ahora: AHORA });

    // SmileFlow, con los MISMOS event_id, arranca de cero y crea sus propias observaciones.
    const ingestaSf = new IngestaSmileFlowGrowth({
      adaptador: adaptadorCon(EVENTOS, 11),
      observaciones,
      store,
      org: ORG_SMILEFLOW,
    });
    const r = await ingestaSf.correrUnaVez(ctx(ORG_SMILEFLOW), { ahora: AHORA });
    expect(r.cursorAntes).toBe(0); // NO heredó el checkpoint de CP
    expect(r.nuevos).toBe(2);

    const idsSf = await observaciones.listarIds(ctx(ORG_SMILEFLOW));
    expect(idsSf.every((i) => i.startsWith('smileflow-growth:'))).toBe(true);
    expect(await observaciones.listarIds(ctx(ORG_CP_ODONTOLOGIA))).toHaveLength(2);
  });

  it('el punto de entrada de SmileFlow NO presta su identidad a otra organización', () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    expect(
      () =>
        new IngestaSmileFlowGrowth({
          adaptador: adaptadorCon(EVENTOS, 11),
          observaciones,
          store,
          org: ORG_CP_ODONTOLOGIA,
        }),
    ).toThrow(/no es org-smileflow/i);
  });

  it('SMILEFLOW_REGRESSION — el stream de cursor de SmileFlow no cambia de nombre', async () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    const ingesta = new IngestaSmileFlowGrowth({
      adaptador: adaptadorCon(EVENTOS, 11),
      observaciones,
      store,
      org: ORG_SMILEFLOW,
    });
    await ingesta.correrUnaVez(ctx(ORG_SMILEFLOW), { ahora: AHORA });
    const eventos = await store.readStream(
      ctx(ORG_SMILEFLOW),
      `ingesta-cursor:smileflow-growth:${ORG_SMILEFLOW}`,
    );
    expect(eventos.some((e) => e.type === 'cursor.avanzado')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ORG_SPECIFIC_FUNNEL · el panel ya no conoce `demo_*`
// ─────────────────────────────────────────────────────────────────────────────
describe('Panel · embudo por organización', () => {
  const CONFIG_SF: ConfiguracionPanel = {
    growthProvider: PROVIDER_GROWTH_SMILEFLOW,
    embudo: getEmbudo(ORG_SMILEFLOW),
  };
  const CONFIG_CP: ConfiguracionPanel = {
    growthProvider: PROVIDER_GROWTH_CP_ODONTOLOGIA,
    embudo: getEmbudo(ORG_CP_ODONTOLOGIA),
  };

  const obs = (provider: string, eventName: string, diagnostico = false, i = 1): ObsPanel => ({
    provider,
    eventName,
    metrica: eventName,
    valor: 1,
    occurredAt: AHORA,
    diagnostico,
    utmCampaign: null,
    utmContent: null,
    limitaciones: [],
    externalEventId: `${provider}:${eventName}:${i}`,
  });

  it('SMILEFLOW_FUNNEL_UNCHANGED — mismos eventos y mismos conteos que antes del cambio', () => {
    const p = construirPanel(
      [
        obs(PROVIDER_GROWTH_SMILEFLOW, 'demo_cta_clicked', false, 1),
        obs(PROVIDER_GROWTH_SMILEFLOW, 'demo_cta_clicked', false, 2),
        obs(PROVIDER_GROWTH_SMILEFLOW, 'demo_form_started', false, 3),
        obs(PROVIDER_GROWTH_SMILEFLOW, 'demo_requested', false, 4),
        obs(PROVIDER_GROWTH_SMILEFLOW, 'demo_requested', true, 5),
        obs(PROVIDER_GROWTH_SMILEFLOW, 'lead_created', false, 6),
      ],
      [],
      null,
      CONFIG_SF,
    );
    expect([...p.growthFunnel.eventos].sort()).toEqual([
      'demo_cta_clicked',
      'demo_form_started',
      'demo_requested',
      'lead_created',
    ]);
    expect(p.growthFunnel.comercial).toEqual({
      demo_cta_clicked: 2,
      demo_form_started: 1,
      demo_requested: 1,
      lead_created: 1,
    });
    expect(p.growthFunnel.diagnostico).toEqual({
      demo_cta_clicked: 0,
      demo_form_started: 0,
      demo_requested: 1,
      lead_created: 0,
    });
    expect(p.growthFunnel.conversionPrimaria).toBe('demo_requested');
  });

  it('CP_FUNNEL — cuenta SUS eventos de intención, y ninguno de SmileFlow', () => {
    const p = construirPanel(
      [
        obs(PROVIDER_GROWTH_CP_ODONTOLOGIA, 'whatsapp_intent', false, 1),
        obs(PROVIDER_GROWTH_CP_ODONTOLOGIA, 'whatsapp_intent', false, 2),
        obs(PROVIDER_GROWTH_CP_ODONTOLOGIA, 'phone_intent', false, 3),
        obs(PROVIDER_GROWTH_CP_ODONTOLOGIA, 'appointment_intent', true, 4), // diagnóstico
        // Evento de interés por tratamiento: REAL y auditable, pero fuera del embudo V1.
        obs(PROVIDER_GROWTH_CP_ODONTOLOGIA, 'service_viewed:implantes-dentales', false, 5),
      ],
      [],
      null,
      CONFIG_CP,
    );
    expect(p.growthFunnel.provider).toBe('cp-odontologia-growth');
    expect(p.growthFunnel.conversionPrimaria).toBe('whatsapp_intent');
    expect(p.growthFunnel.comercial).toEqual({
      whatsapp_intent: 2,
      appointment_intent: 0,
      phone_intent: 1,
    });
    expect(p.growthFunnel.diagnostico).toEqual({
      whatsapp_intent: 0,
      appointment_intent: 1,
      phone_intent: 0,
    });
    // Ni una casilla `demo_*` en el panel de CP.
    expect(Object.keys(p.growthFunnel.comercial).some((k) => k.startsWith('demo_'))).toBe(false);
    // El evento de tratamiento no entró en ninguna casilla del embudo.
    expect(Object.values(p.growthFunnel.comercial).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('no hay fallback: los eventos de una organización no cuentan en el panel de la otra', () => {
    const eventosSf = [
      obs(PROVIDER_GROWTH_SMILEFLOW, 'demo_requested', false, 1),
      obs(PROVIDER_GROWTH_SMILEFLOW, 'lead_created', false, 2),
    ];
    const p = construirPanel(eventosSf, [], null, CONFIG_CP);
    expect(p.growthFunnel.comercial).toEqual({
      whatsapp_intent: 0,
      appointment_intent: 0,
      phone_intent: 0,
    });
  });

  it('un eventName heredado de Object.prototype NO contamina el embudo del panel', () => {
    // `eventName` viene del puente M2M externo: un evento llamado `toString`/`constructor` no puede
    // colarse como casilla del embudo ni convertir un conteo en algo que no sea un número.
    const p = construirPanel(
      [
        obs(PROVIDER_GROWTH_SMILEFLOW, 'toString', false, 1),
        obs(PROVIDER_GROWTH_SMILEFLOW, 'constructor', false, 2),
        obs(PROVIDER_GROWTH_SMILEFLOW, 'valueOf', false, 3),
        obs(PROVIDER_GROWTH_SMILEFLOW, 'hasOwnProperty', false, 4),
        obs(PROVIDER_GROWTH_SMILEFLOW, 'demo_requested', false, 5),
      ],
      [],
      null,
      CONFIG_SF,
    );
    expect(Object.keys(p.growthFunnel.comercial).sort()).toEqual([
      'demo_cta_clicked',
      'demo_form_started',
      'demo_requested',
      'lead_created',
    ]);
    expect(Object.values(p.growthFunnel.comercial).every((v) => typeof v === 'number')).toBe(true);
    expect(p.growthFunnel.comercial.demo_requested).toBe(1);
    expect(JSON.stringify(p.growthFunnel)).not.toContain('native code');
  });

  it('organización sin fuente Growth: el embudo queda en ceros, no toma los eventos de nadie', () => {
    const p = construirPanel(
      [obs(PROVIDER_GROWTH_SMILEFLOW, 'demo_requested', false, 1)],
      [],
      null,
      { growthProvider: null, embudo: getEmbudo(ORG_SMILEFLOW) },
    );
    expect(p.growthFunnel.provider).toBeNull();
    expect(p.growthFunnel.comercial.demo_requested).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE_EVENTS_WITH_LEADREF_FORBIDDEN · regla V1 de privacidad
// ─────────────────────────────────────────────────────────────────────────────
describe('Privacidad V1 · interés por tratamiento vs. identidad de contacto', () => {
  it('`service_viewed:<slug>` SIN leadRef es válido y no arrastra identidad', () => {
    const e = ev({ event_id: 1, event_name: 'service_viewed:implantes-dentales', lead_id: null });
    expect(violacionDePrivacidadGrowth(e)).toBeNull();
    const m = mapearEventoGrowth(e, PROVIDER_GROWTH_CP_ODONTOLOGIA);
    expect(m.leadRef).toBeNull();
    expect(m.eventName).toBe('service_viewed:implantes-dentales');
  });

  it('`service_viewed:<slug>` CON leadRef se RECHAZA (no se persiste la correlación)', () => {
    const e = ev({ event_id: 2, event_name: 'service_viewed:implantes-dentales', lead_id: 4127 });
    expect(violacionDePrivacidadGrowth(e)).toBe('INTERES_POR_SERVICIO_CON_LEADREF');
    expect(() => mapearEventoGrowth(e, PROVIDER_GROWTH_CP_ODONTOLOGIA)).toThrow(
      PrivacidadGrowthError,
    );
    // `service_viewed` sin slug tampoco puede llevar identidad.
    expect(() =>
      mapearEventoGrowth(ev({ event_id: 3, event_name: 'service_viewed', lead_id: 9 }), 'p'),
    ).toThrow(PrivacidadGrowthError);
  });

  it('el mensaje de rechazo NO revela el tratamiento (ni el slug, ni la ruta)', () => {
    const e = ev({ event_id: 4, event_name: 'service_viewed:ortodoncia-invisible', lead_id: 5 });
    try {
      mapearEventoGrowth(e, PROVIDER_GROWTH_CP_ODONTOLOGIA);
      throw new Error('debió lanzar');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain('ortodoncia-invisible');
      expect(msg).toContain('service_viewed');
      expect(msg).toContain('INTERES_POR_SERVICIO_CON_LEADREF');
    }
  });

  it('los eventos de contacto SÍ pueden llevar leadRef', () => {
    for (const nombre of ['whatsapp_intent', 'phone_intent', 'appointment_intent']) {
      const e = ev({ event_id: 20, event_name: nombre, lead_id: 77, path: '/contacto' });
      expect(violacionDePrivacidadGrowth(e)).toBeNull();
      expect(mapearEventoGrowth(e, PROVIDER_GROWTH_CP_ODONTOLOGIA).leadRef).toBe('77');
    }
  });

  it('un evento de contacto NO puede portar tratamiento (ni calificado ni por ruta)', () => {
    const calificado = ev({ event_id: 21, event_name: 'whatsapp_intent:implantes-dentales', lead_id: 77 });
    expect(violacionDePrivacidadGrowth(calificado)).toBe('CONTACTO_CON_TRATAMIENTO');
    expect(() => mapearEventoGrowth(calificado, PROVIDER_GROWTH_CP_ODONTOLOGIA)).toThrow(
      PrivacidadGrowthError,
    );

    const porRuta = ev({
      event_id: 22,
      event_name: 'appointment_intent',
      lead_id: 77,
      path: '/servicios/implantes-dentales',
    });
    expect(violacionDePrivacidadGrowth(porRuta)).toBe('CONTACTO_CON_TRATAMIENTO');
    expect(() => mapearEventoGrowth(porRuta, PROVIDER_GROWTH_CP_ODONTOLOGIA)).toThrow(
      PrivacidadGrowthError,
    );
  });

  it('la ingesta es fail-closed: un evento que viola la regla NO se persiste', async () => {
    const store = new InMemoryEventStore();
    const observaciones = new ObservacionService(store, {} as never);
    const ingesta = new IngestaGrowth({
      adaptador: adaptadorCon([
        ev({ event_id: 30, event_name: 'service_viewed:implantes-dentales', lead_id: 4127 }),
      ]),
      observaciones,
      store,
      org: ORG_CP_ODONTOLOGIA,
      provider: PROVIDER_GROWTH_CP_ODONTOLOGIA,
    });
    await expect(
      ingesta.correrUnaVez(ctx(ORG_CP_ODONTOLOGIA), { ahora: AHORA }),
    ).rejects.toThrow(PrivacidadGrowthError);
    expect(await observaciones.listarIds(ctx(ORG_CP_ODONTOLOGIA))).toHaveLength(0);
  });

  it('la regla NO se esquiva cambiando la caja del nombre del evento', () => {
    for (const nombre of ['Service_Viewed:implantes', 'SERVICE_VIEWED:implantes', 'sErViCe_ViEwEd']) {
      const e = ev({ event_id: 50, event_name: nombre, lead_id: 4127 });
      expect(violacionDePrivacidadGrowth(e)).toBe('INTERES_POR_SERVICIO_CON_LEADREF');
      expect(() => mapearEventoGrowth(e, PROVIDER_GROWTH_CP_ODONTOLOGIA)).toThrow(
        PrivacidadGrowthError,
      );
    }
    const contacto = ev({ event_id: 51, event_name: 'WhatsApp_Intent:implantes', lead_id: 77 });
    expect(violacionDePrivacidadGrowth(contacto)).toBe('CONTACTO_CON_TRATAMIENTO');
  });

  it('la regla NO se esquiva cambiando el separador del calificador', () => {
    for (const nombre of [
      'service_viewed/implantes-dentales',
      'service_viewed-implantes',
      'service_viewed.implantes',
      'service_viewed implantes',
    ]) {
      const e = ev({ event_id: 60, event_name: nombre, lead_id: 4127 });
      expect(violacionDePrivacidadGrowth(e)).toBe('INTERES_POR_SERVICIO_CON_LEADREF');
    }
    for (const nombre of ['whatsapp_intent/implantes', 'phone_intent-ortodoncia']) {
      const e = ev({ event_id: 61, event_name: nombre, lead_id: 77 });
      expect(violacionDePrivacidadGrowth(e)).toBe('CONTACTO_CON_TRATAMIENTO');
    }
  });

  it('SmileFlow no se ve afectado por la regla: sus eventos siguen pasando igual', () => {
    const e = ev({ event_id: 40, event_name: 'demo_requested', lead_id: 7, path: '/demo' });
    expect(violacionDePrivacidadGrowth(e)).toBeNull();
    expect(mapearEventoGrowth(e, PROVIDER_GROWTH_SMILEFLOW).leadRef).toBe('7');
  });
});
