/**
 * SOEC · AISLAMIENTO MULTIEMPRESA — pruebas ADVERSARIALES (FASE 3 del bloque "Segunda organización real").
 *
 * Premisa del bloque: NO se asume que SOEC es multitenant por transportar un `organizationId`.
 * Aquí se DEMUESTRA, tenant contra tenant, con dos organizaciones distintas y consultas cruzadas.
 *
 * `org-cyp` se usa aquí ÚNICAMENTE como IDENTIFICADOR DE PRUEBA en un store en memoria. Este archivo
 * NO crea la organización Distribuidora C Y P SpA, no ingiere datos suyos y no toca ninguna cuenta
 * externa. SmileFlow no se modifica: sólo se leen sus invariantes de confinamiento.
 *
 * Cobertura (TEST 1…12 de la directiva):
 *   1/2  observaciones M8 no cruzan en ninguna dirección
 *   3    el ÍNDICE de M8 (enumeración) es por organización
 *   4/5  medición y lectura del Director (M9) no cruzan
 *   6    la evidencia del Director no cruza de tenant
 *   7    una intención no puede portar el externalAccountId (customerId) de otro tenant
 *   8    una aprobación en un tenant no aprueba la intención de otro
 *   9    el Executor rechaza intención/tenant discordantes (fail-closed)
 *   10   read-back / mutate: cuenta externa de otro tenant ⇒ rechazo
 *   11   rollback confinado al mismo tenant + recurso externo
 *   12   fallo de configuración/alcance ⇒ FAIL-CLOSED, jamás fallback a SmileFlow
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { InMemoryEventStore } from '@soec/event-store';
import {
  ActorId,
  OrganizationId,
  ScopeMismatchError,
  ScopeRequiredError,
  type Attribution,
  type RequestContext,
} from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import { G2AService } from '../src/autonomia-ads/g2a-service';
import {
  IntencionService,
  intencionId,
  type IntencionDeCambio,
} from '../src/autonomia-ads/intencion-cambio';
import { AprobacionService } from '../src/autonomia-ads/aprobacion-service';
import { ExecutorGovernado } from '../src/autonomia-ads/executor-governado';
import { CONFINAMIENTO } from '../src/autonomia-ads/capacidad-negativa';
import {
  GoogleAdsWriteAdapter,
  OperacionNoHabilitadaError,
} from '../src/autonomia-ads/google-ads-write-adapter';
import {
  EVENTO_LECTURA,
  LecturaDirectorRealService,
  lecturaDirectorStreamId,
} from '../src/real-director/lectura-director-real';

const AQUI = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(AQUI, '..', 'src', rel), 'utf8');

const ORG_SF = 'org-smileflow';
/** Identificador de PRUEBA de la segunda organización. No crea ni representa a la empresa real. */
const ORG_CYP = 'org-cyp';
const AHORA = '2026-08-13T12:00:00.000Z';
const CAMP_SF = '24120966895';
/** Cuenta externa ficticia del segundo tenant: NUNCA la de SmileFlow. */
const CUSTOMER_AJENO = '1111111111';

const ATR: Attribution = {
  source: 'test-aislamiento',
  purpose: 'demostrar aislamiento multiempresa',
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

function obs(store: InMemoryEventStore): ObservacionService {
  return new ObservacionService(store, {} as never);
}

/** Hecho REAL con procedencia externa, atribuible a UNA organización. */
async function sembrarObservacionReal(
  store: InMemoryEventStore,
  org: string,
  observacionId: string,
  eventName: string,
): Promise<void> {
  await obs(store).registrarReal(
    ctx(org),
    observacionId,
    {
      provider: 'google-ads',
      externalEventId: `${org}-${observacionId}`,
      eventName,
      occurredAt: AHORA,
      kpiId: 'kpi-impresiones',
      metrica: 'impresiones',
      valor: 100,
      unidad: 'conteo',
      calidad: 'alta',
      cobertura: 1,
      diagnostico: false,
    },
    ATR,
    AHORA,
  );
}

function intencion(
  org: string,
  customerId: string,
  campaignId: string,
  termino = 'insumos dentales',
): IntencionDeCambio {
  return {
    id: intencionId(org, customerId, 'ADD_NEGATIVE_KEYWORD', termino),
    org,
    customerId,
    campaignId,
    lever: 'negativa_termino',
    entityRef: termino,
    actionType: 'ADD_NEGATIVE_KEYWORD',
    before: 'muestra el anuncio',
    after: 'excluida',
    reason: 'irrelevante',
    evidence: {
      resumen: '40 impresiones, 0 clics',
      muestra: 40,
      suficiente: true,
      sinConversionAtribuible: true,
      ventana: 'acumulado',
    },
    confidence: 'alta',
    risk: 'bajo',
    authorizationRef: null,
    createdAt: AHORA,
    status: 'PROPUESTA',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 · 2 · 3 — M8: observaciones y enumeración por organización
// ─────────────────────────────────────────────────────────────────────────────
describe('AISLAMIENTO · M8 (observaciones)', () => {
  it('TEST 1 — una consulta de org-cyp NO devuelve observaciones de org-smileflow', async () => {
    const store = new InMemoryEventStore();
    await sembrarObservacionReal(store, ORG_SF, 'obs-sf-1', 'ads_impressions');

    expect(await obs(store).listarIds(ctx(ORG_SF))).toEqual(['obs-sf-1']);
    // El segundo tenant no ve NADA: ni por enumeración…
    expect(await obs(store).listarIds(ctx(ORG_CYP))).toEqual([]);
    // …ni adivinando el identificador exacto de la observación ajena.
    const robo = await obs(store).cargar(ctx(ORG_CYP), 'obs-sf-1');
    expect(robo.existe).toBe(false);
    expect(robo.datos).toBeNull();
  });

  it('TEST 2 — una consulta de org-smileflow NO devuelve observaciones de org-cyp', async () => {
    const store = new InMemoryEventStore();
    await sembrarObservacionReal(store, ORG_CYP, 'obs-cyp-1', 'purchase');

    expect(await obs(store).listarIds(ctx(ORG_CYP))).toEqual(['obs-cyp-1']);
    expect(await obs(store).listarIds(ctx(ORG_SF))).toEqual([]);
    expect((await obs(store).cargar(ctx(ORG_SF), 'obs-cyp-1')).existe).toBe(false);
  });

  it('TEST 3 — M8 de C Y P no consume eventos de SmileFlow ni con identificadores colisionantes', async () => {
    const store = new InMemoryEventStore();
    // MISMO observacionId en ambos tenants: la colisión de identificador no funde los hechos.
    await sembrarObservacionReal(store, ORG_SF, 'obs-colision', 'demo_requested');
    await sembrarObservacionReal(store, ORG_CYP, 'obs-colision', 'purchase');

    const sf = await obs(store).cargar(ctx(ORG_SF), 'obs-colision');
    const cyp = await obs(store).cargar(ctx(ORG_CYP), 'obs-colision');
    expect(sf.datos?.provenanciaReal?.eventName).toBe('demo_requested');
    expect(cyp.datos?.provenanciaReal?.eventName).toBe('purchase');
    // Cada hecho responde inequívocamente "¿de qué organización es?".
    expect(sf.organizacionId).toBe(ORG_SF);
    expect(cyp.organizacionId).toBe(ORG_CYP);
    expect(await obs(store).listarIds(ctx(ORG_CYP))).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4 · 5 · 6 — Measurement / M9 / Director
// ─────────────────────────────────────────────────────────────────────────────
describe('AISLAMIENTO · Measurement / M9 / Director', () => {
  it('TEST 4 y 5 — la lectura del Director de un tenant no es legible ni evaluable por el otro', async () => {
    const store = new InMemoryEventStore();
    const lecturaSF = {
      veredicto: 'OBSERVAR',
      naturaleza: 'REAL',
      fuente: ORG_SF,
      campaignId: CAMP_SF,
      campaniaRef: 'cmp-smileflow-search-chile',
      at: AHORA,
      hechos: {
        impresiones: 4321,
        clics: 12,
        gasto: 9000,
        ctr: 0.0028,
        cpc: 750,
        conversionesAtribuiblesAds: 0,
      },
    };
    // Se persiste la lectura REAL de SmileFlow en su propio stream.
    await store.append(ctx(ORG_SF), lecturaDirectorStreamId(ORG_SF), 0, [
      { type: EVENTO_LECTURA, payload: lecturaSF, attribution: ATR, occurredAt: AHORA },
    ]);

    const svc = new LecturaDirectorRealService(store);
    expect(await svc.leerUltima(ORG_SF)).toMatchObject({ campaignId: CAMP_SF });
    // El segundo tenant NO hereda métricas ajenas: obtiene ausencia (null), no ceros ni datos prestados.
    expect(await svc.leerUltima(ORG_CYP)).toBeNull();
  });

  it('TEST 6 — el Director de C Y P no puede recomendar con evidencia de SmileFlow', async () => {
    const store = new InMemoryEventStore();
    await sembrarObservacionReal(store, ORG_SF, 'obs-sf-evidencia', 'ads_search_term');

    // Toda la evidencia disponible para el segundo tenant es vacía ⇒ ninguna recomendación es derivable.
    expect(await obs(store).listarIds(ctx(ORG_CYP))).toEqual([]);
    expect(await new LecturaDirectorRealService(store).leerUltima(ORG_CYP)).toBeNull();
    // Y su bandeja de propuestas gobernadas está vacía (no hereda las de SmileFlow).
    expect(await new G2AService(store).bandeja(ORG_CYP, AHORA)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7 · 8 · 9 — Intención / Aprobación / Executor
// ─────────────────────────────────────────────────────────────────────────────
describe('AISLAMIENTO · intención, aprobación y ejecución', () => {
  it('TEST 7 — una intención de C Y P NO puede portar el externalAccountId de SmileFlow', async () => {
    const store = new InMemoryEventStore();
    const g2a = new G2AService(store);
    // Intención del segundo tenant apuntando a la CUENTA de SmileFlow ⇒ rechazo duro. Desde el
    // endurecimiento D-1…D-4 el rechazo ocurre AÚN ANTES: `org-cyp` no tiene negocio registrado, así
    // que no puede resolver NINGUNA cuenta externa (menos aún la de otra organización).
    await expect(
      g2a.registrarIntencion(ORG_CYP, intencion(ORG_CYP, CONFINAMIENTO.customerId, CAMP_SF), AHORA),
    ).rejects.toThrow(/no está registrada|confinamiento/i);
    // Y a la inversa: el tenant correcto con una cuenta ajena tampoco pasa.
    await expect(
      g2a.registrarIntencion(ORG_SF, intencion(ORG_SF, CUSTOMER_AJENO, CAMP_SF), AHORA),
    ).rejects.toThrow(/confinamiento/i);
    // Nada quedó persistido en ninguno de los dos tenants.
    expect(await new IntencionService(store).listarIds(ctx(ORG_CYP))).toEqual([]);
    expect(await new IntencionService(store).listarIds(ctx(ORG_SF))).toEqual([]);
  });

  it('TEST 8 — una aprobación de C Y P no aprueba una intención de SmileFlow', async () => {
    const store = new InMemoryEventStore();
    const g2a = new G2AService(store);
    const iSF = intencion(ORG_SF, CONFINAMIENTO.customerId, CAMP_SF);
    await g2a.registrarIntencion(ORG_SF, iSF, AHORA);

    // Un actor humano del segundo tenant "aprueba" con el id exacto de la intención ajena.
    await new AprobacionService(store)
      .aprobar(ctx(ORG_CYP), iSF.id, 'Actor CYP', AHORA, ATR, AHORA)
      .catch(() => undefined); // puede fallar por inexistencia: ambas salidas son aceptables

    // La intención de SmileFlow NO quedó aprobada ni autorizada.
    const estadoSF = await new IntencionService(store).cargar(ctx(ORG_SF), iSF.id);
    expect(estadoSF.intencion?.status).not.toBe('APROBADA');
    expect(estadoSF.intencion?.authorizationRef ?? null).toBeNull();
    const aprobSF = await new AprobacionService(store).estado(ctx(ORG_SF), iSF.id, AHORA);
    expect(aprobSF.estado).not.toBe('APROBADA');
  });

  it('TEST 9 — el Executor rechaza cuando intención y tenant objetivo no coinciden', async () => {
    const store = new InMemoryEventStore();
    const iSF = intencion(ORG_SF, CONFINAMIENTO.customerId, CAMP_SF);
    await new G2AService(store).registrarIntencion(ORG_SF, iSF, AHORA);

    // Ejecutar la intención de SmileFlow "desde" el segundo tenant: no existe en su stream ⇒ falla.
    await expect(new ExecutorGovernado(store).ejecutar(ORG_CYP, iSF.id, AHORA)).rejects.toThrow(
      /no existe/i,
    );
  });

  it('TEST 9b — una intención con org/cuenta ajenos inyectada en el stream se bloquea FAIL-CLOSED', async () => {
    const store = new InMemoryEventStore();
    // Se inyecta directamente en el stream del segundo tenant una intención con la cuenta de SmileFlow,
    // saltándose G2AService (simula un componente comprometido o una regresión futura).
    const svc = new IntencionService(store);
    const iMala = {
      ...intencion(ORG_CYP, CONFINAMIENTO.customerId, CAMP_SF),
      status: 'APROBADA' as const,
    };
    await svc.proponer(ctx(ORG_CYP), iMala, ATR, AHORA);

    const r = await new ExecutorGovernado(store).ejecutar(ORG_CYP, iMala.id, AHORA);
    expect(r.bloqueos).toContain('CONFINAMIENTO_TENANT');
    expect(r.ejecutadoReal).toBe(false);
    expect(r.puedeEjecutarReal).toBe(false);
    expect(r.mutateDescrito).toBeNull(); // ni siquiera se DESCRIBE el mutate
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10 · 11 — Read-back y rollback confinados
// ─────────────────────────────────────────────────────────────────────────────
describe('AISLAMIENTO · read-back y rollback', () => {
  it('TEST 10 — describir el mutate/read-back sobre una cuenta externa ajena ⇒ rechazo', () => {
    const w = new GoogleAdsWriteAdapter();
    expect(() =>
      w.describirMutate({
        actionType: 'ADD_NEGATIVE_KEYWORD',
        customerId: CUSTOMER_AJENO,
        campaignId: CAMP_SF,
        entityRef: 'x',
      }),
    ).toThrow(OperacionNoHabilitadaError);
  });

  it('TEST 11 — el rollback queda confinado al mismo recurso externo del mismo tenant', () => {
    const w = new GoogleAdsWriteAdapter();
    const recurso = `customers/${CONFINAMIENTO.customerId}/campaignCriteria/123`;
    const rb = w.describirRollback(CONFINAMIENTO.customerId, recurso);
    expect(rb.resourcePath).toContain(CONFINAMIENTO.customerId);
    expect(JSON.stringify(rb.cuerpo)).toContain(recurso);
    // El rollback jamás nombra la cuenta de otro tenant.
    expect(JSON.stringify(rb)).not.toContain(CUSTOMER_AJENO);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12 — FAIL-CLOSED: nunca hay fallback silencioso a SmileFlow
// ─────────────────────────────────────────────────────────────────────────────
describe('AISLAMIENTO · fail-closed', () => {
  it('TEST 12 — alcance discordante ⇒ ScopeMismatchError; alcance ausente ⇒ ScopeRequiredError', async () => {
    const store = new InMemoryEventStore();
    await sembrarObservacionReal(store, ORG_SF, 'obs-sf-2', 'ads_impressions');

    // Contexto forjado: dice ser org-cyp pero lleva el alcance de org-smileflow.
    const forjado: RequestContext = {
      organizationId: OrganizationId(ORG_CYP),
      actor: ActorId('t'),
      scope: { organizationId: OrganizationId(ORG_SF), permissions: ['events:read'] },
      correlationId: 'forjado',
    };
    await expect(
      store.readStream(forjado, 'observacion-indice:org-smileflow'),
    ).rejects.toBeInstanceOf(ScopeMismatchError);

    // Contexto sin permisos: rechazo por defecto, no lectura degradada.
    const sinPermiso: RequestContext = {
      organizationId: OrganizationId(ORG_CYP),
      actor: ActorId('t'),
      scope: { organizationId: OrganizationId(ORG_CYP), permissions: [] },
      correlationId: 'sin-permiso',
    };
    await expect(store.readStream(sinPermiso, 'observacion-indice:org-cyp')).rejects.toBeInstanceOf(
      ScopeRequiredError,
    );
  });

  it('TEST 12b — la ausencia de datos del segundo tenant se expresa como AUSENCIA, nunca como datos de SmileFlow', async () => {
    const store = new InMemoryEventStore();
    await sembrarObservacionReal(store, ORG_SF, 'obs-sf-3', 'ads_impressions');
    const svc = new LecturaDirectorRealService(store);
    // null = "no hay lectura", que es distinto de "cero" y distinto de "la de SmileFlow".
    expect(await svc.leerUltima(ORG_CYP)).toBeNull();
    expect(await obs(store).listarIds(ctx(ORG_CYP))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUEADORES D-1…D-4 — detectores de regresión ARQUITECTÓNICOS (por lectura del código fuente)
//
// La auditoría de FASE 1 fijó por escrito cuatro hardcodes de organización. Estas pruebas verifican
// que NO REAPAREZCAN: no basta con que el comportamiento sea correcto hoy, la forma que lo permitía
// tiene que haber desaparecido del código.
// ─────────────────────────────────────────────────────────────────────────────
describe('HARDENING D-1…D-4 · el hardcode de organización no puede reaparecer', () => {
  it('D-1 — /medicion resuelve la organización del contexto autenticado, no de una constante', () => {
    const rutas = src('measurement-routes.ts');
    expect(rutas).not.toContain("const ORG_INGESTA_REAL = 'org-smileflow'");
    expect(rutas).not.toContain('ORG_INGESTA_REAL');
    // La organización proviene del gateway y pasa por el binding explícito.
    expect(rutas).toContain('contextoDe(req)');
    expect(rutas).toContain('bindExperienciaReal');
  });

  it('D-2 — la experiencia de decisión del piloto recibe la organización; no la fija', () => {
    const exp = src('pilot-decision-experience.ts');
    expect(exp).not.toContain("const ORG = 'smileflow-clinic'");
    expect(exp).toContain('private readonly org: string');
    // Las rutas del piloto exigen binding antes de construir la experiencia.
    expect(src('pilot-routes.ts')).toContain("bindExperienciaReal(ctx, 'piloto-decision')");
  });

  it('D-3 — el Director ya no aplica criterio/política/campaña de SmileFlow a cualquier organización', () => {
    const lectura = src('real-director/lectura-director-real.ts');
    expect(lectura).not.toContain('CRITERIO_SMILEFLOW');
    expect(lectura).not.toContain('POLICY_SMILEFLOW');
    expect(lectura).not.toContain('CAMPANIA_SMILEFLOW');
    expect(lectura).not.toContain('OBJETIVO_SMILEFLOW');
    // Resuelve el perfil de negocio de la organización solicitada.
    expect(lectura).toContain('getProfile(org)');
  });

  it('D-4 — el binding organización↔experiencia existe y no admite caída silenciosa', () => {
    const binding = src('plataforma/experience-binding.ts');
    expect(binding).toContain('requireScope');
    expect(binding).toContain('assertTenantIdCanonico');
    // Ningún módulo de la plataforma tiene un fallback a SmileFlow.
    for (const f of ['plataforma/registro.ts', 'plataforma/experience-binding.ts']) {
      expect(src(f)).not.toMatch(/\?\?\s*CONFIGURACION_ORG_SMILEFLOW/);
    }
    expect(src('plataforma/registro.ts')).toContain('throw new OrganizacionNoRegistradaError');
  });

  it('el confinamiento de Google Ads dejó de ser una constante global de plataforma', () => {
    // Sigue existiendo para `org-smileflow` —es SU configuración registrada— pero se deriva del
    // registro por organización, no de literales incrustados en el módulo genérico.
    const cap = src('autonomia-ads/capacidad-negativa.ts');
    expect(cap).toContain('export function confinamientoDe');
    expect(cap).not.toContain("org: 'org-smileflow'");
    expect(cap).not.toContain("customerId: '8605539300'");
    // La configuración de SmileFlow sigue resolviéndose correctamente para SmileFlow.
    expect(CONFINAMIENTO.org).toBe(ORG_SF);
    expect(CONFINAMIENTO.customerId).toMatch(/^\d{10}$/);
  });
});
