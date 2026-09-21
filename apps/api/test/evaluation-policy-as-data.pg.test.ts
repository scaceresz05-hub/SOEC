/**
 * Autonomy Fase C · POLÍTICA DE EVALUACIÓN COMO DATO — aceptación sobre PostgreSQL REAL.
 *
 * Demuestra la afirmación que define la fase: una empresa nueva pasa de «creada y conectada» a EVALUABLE
 * configurando sus criterios desde SOEC —por las APIs reales—, sin módulo TypeScript, sin `getProfile`
 * específico, sin variables por tenant y sin desplegar. Y demuestra que las empresas históricas siguen
 * funcionando DESDE DATOS: el perfil de SmileFlow reconstruido es idéntico, campo por campo, al de su módulo.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { buildApp } from '../src/app';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { migrarNegociosDelRegistro } from '../src/negocio/migracion-registro';
import { conexionMigrations, PgConexionCiphertextStore, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { migrarConexionesDelRegistro } from '../src/conexion/migracion-conexiones';
import { ConexionService } from '../src/conexion/conexion-service';
import { EnvelopeSecretBackend, KmsFake } from '../src/acquisition/meta-secret-backend';
import type { DepositoSecretosConexion } from '../src/conexion/secreto-conexion';
import { elegiblesPorCapacidad, refrescarNegociosDelRuntime } from '../src/conexion/snapshot';
import { politicaMigrations, RepositorioPolitica } from '../src/politica/politica-pg';
import { migrarPoliticasDelRegistro } from '../src/politica/migracion-politica';
import { PoliticaService } from '../src/politica/politica-service';
import { CONFIGURACION_ORG_SMILEFLOW } from '../src/plataforma/negocios/org-smileflow';
import {
  PerfilIncompletoError,
  bindExperienciaReal,
  buscarProfile,
  estadoDeCompatibilidadLegado,
  getEmbudo,
  restablecerNegociosDelRuntime,
} from '../src/plataforma';

const H = { 'content-type': 'application/json' };
const pool = makeTestPool();
const NOMBRE_QA = 'Empresa QA Evaluation';

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, identityMigrations);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await runMigrations(pool, politicaMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate business_channel_rule, business_autonomy_limits, business_evaluation_rule, business_conversion_event, business_kpi, business_evaluation_policy, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile restart identity cascade');
  await ejecutarDestructivoDePrueba(
    pool,
    'truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade',
  );
  restablecerNegociosDelRuntime();
});
afterAll(async () => {
  restablecerNegociosDelRuntime();
  await pool.end();
});

function app() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool, legacyDemoAccess: false });
}
type App = ReturnType<typeof app>;

function cookieDe(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const arr = Array.isArray(sc) ? sc : [sc];
  const c = arr.find((x): x is string => typeof x === 'string' && x.startsWith('soec_session='));
  return c ? c.split(';')[0]! : '';
}

async function usuario(a: App, email: string): Promise<string> {
  await a.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email, displayName: email, password: 'Password123' } });
  return cookieDe(await a.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email, password: 'Password123' } }));
}

async function crearEmpresa(a: App, cookie: string, nombre = NOMBRE_QA): Promise<string> {
  const res = await a.inject({
    method: 'POST', url: '/negocios', headers: { ...H, cookie },
    payload: {
      displayName: nombre, businessType: 'CLINICA', country: 'CL', currency: 'CLP',
      timezone: 'America/Santiago', website: 'https://qa-evaluation.example',
      primaryObjective: 'conseguir más pacientes nuevos',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().perfil.organizationId as string;
}

function depositoDePrueba(): DepositoSecretosConexion {
  const backend = new EnvelopeSecretBackend(new KmsFake(), new PgConexionCiphertextStore(pool));
  return {
    esProductivo: backend.esProductivo,
    almacenar: (org, nombre, valor) => backend.almacenar(org, nombre, valor),
    resolver: (ctx, ref) => backend.resolver(ctx, ref),
    revocar: (ref) => backend.revocar(ref),
  };
}

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('qa'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'qa' };
}

/** Documento con el que un dueño vuelve evaluable a su empresa: objetivo, acción, indicador, meta y evidencia. */
const POLITICA_QA = {
  objetivoText: 'conseguir más pacientes nuevos',
  businessContext: 'clínica odontológica: el resultado son contactos de pacientes que piden una evaluación',
  evaluationHorizonDays: 30,
  eventos: [
    { eventKey: 'whatsapp_intent', rol: 'PRIMARY', displayName: 'escribe por WhatsApp' },
    { eventKey: 'phone_intent', rol: 'SECONDARY', displayName: 'llama por teléfono' },
  ],
  kpis: [
    { clave: 'contactos', displayName: 'contactos conseguidos', rol: 'PRIMARY', tipo: 'EVENT_COUNT', unidad: 'COUNT', eventKey: 'whatsapp_intent', targetValue: 20, baselineValue: 0, tolerance: 0.2 },
  ],
  reglas: [
    { tipo: 'EVIDENCE_MINIMUM', metrica: 'IMPRESSIONS', comparador: 'GTE', valor: 500 },
    { tipo: 'PAUSE', metrica: 'CONVERSION_RATE', comparador: 'LTE', valor: 0.005 },
  ],
};

describe('empresa nueva: de creada y conectada a EVALUABLE, sólo por las APIs', () => {
  it('nace INCOMPLETE con motivos correctos, el dueño completa la política y pasa a COMPLETE', async () => {
    const a = app();
    const cookie = await usuario(a, 'qa-politica@soec.cl');
    const org = await crearEmpresa(a, cookie);
    const h = { ...H, cookie, 'x-organization-slug': org };

    // 1) CONECTADA y con capacidades, como en la fase anterior (por servicio: el KMS de prueba es local).
    const conexiones = new ConexionService(pool, { deposito: depositoDePrueba(), env: {}, refrescar: async () => { await refrescarNegociosDelRuntime(pool); } });
    await conexiones.guardarGrowth(org, 'qa', { baseUrl: 'https://qa-evaluation.example', provider: 'qa-evaluation-growth', token: 'tok_qa_eval_123' });
    await conexiones.fijarCapacidad(org, 'qa', 'INGESTA_GROWTH', true);
    await conexiones.fijarCapacidad(org, 'qa', 'MEDICION_REAL', true);

    // 2) INICIALMENTE INCOMPLETA, con los cinco motivos y su explicación.
    const inicial = await a.inject({ method: 'GET', url: '/politica', headers: h });
    expect(inicial.statusCode, inicial.body).toBe(200);
    const v0 = inicial.json();
    expect(v0.completitud.estado).toBe('EVALUATION_PROFILE_INCOMPLETE');
    expect(v0.completitud.faltantes.map((f: { campo: string }) => f.campo)).toEqual([
      'primaryObjective', 'primaryConversionEvent', 'primaryKpi', 'successCriterion', 'evidenceMinimum',
    ]);
    expect(v0.perfilEvaluableDisponible).toBe(false);
    // El objetivo en lenguaje de negocio ya viene del alta: no se pide dos veces.
    expect(v0.objetivoDeclarado).toBe('conseguir más pacientes nuevos');

    // 3) El runtime la ve como negocio válido pero NO evaluable, y lo dice con los motivos reales.
    await refrescarNegociosDelRuntime(pool);
    expect(buscarProfile(org)).toBeNull();
    try {
      bindExperienciaReal(ctx(org), 'medicion-real');
      throw new Error('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(PerfilIncompletoError);
      const err = e as PerfilIncompletoError;
      expect(err.code).toBe('PROFILE_INCOMPLETE');
      expect(err.faltantes).toEqual(['primaryObjective', 'primaryConversionEvent', 'primaryKpi', 'successCriterion', 'evidenceMinimum']);
    }

    // 4) EL DUEÑO COMPLETA LA POLÍTICA por la API real. Ni código, ni variables, ni deploy.
    const guardado = await a.inject({ method: 'PATCH', url: '/politica', headers: h, payload: POLITICA_QA });
    expect(guardado.statusCode, guardado.body).toBe(200);
    const v1 = guardado.json();
    expect(v1.completitud.estado).toBe('EVALUATION_PROFILE_COMPLETE');
    expect(v1.completitud.faltantes).toEqual([]);
    expect(v1.perfilEvaluableDisponible).toBe(true);

    // 5) EL RESOLUTOR DEVUELVE EL PERFIL PERSISTIDO (el refresco lo disparó la propia mutación).
    const perfil = buscarProfile(org);
    expect(perfil).not.toBeNull();
    expect(perfil!.organizationId).toBe(org);
    expect(perfil!.objetivoId).toBe(`obj-${org}`);
    expect(perfil!.criterio).toEqual({ objetivoId: `obj-${org}`, indicador: 'contactos', lineaBase: 0, meta: 20, tolerancia: 0.2, muestraMinima: 500 });
    expect(perfil!.policy.umbralPausaTasaConversion).toBe(0.005);
    expect(perfil!.policy.escalamientoRequiereAprobacion).toBe(true);
    expect(perfil!.directorContext.conversionPrimaria).toBe('whatsapp_intent');
    // El embudo también es dato: se deriva de los eventos persistidos.
    expect(getEmbudo(org)).toEqual({ conversionPrimaria: 'whatsapp_intent', conversionesSecundarias: ['phone_intent'] });

    // 6) `bindExperienciaReal` ya NO depende del registro para esta empresa.
    const binding = bindExperienciaReal(ctx(org), 'medicion-real');
    expect(binding.perfil.criterio.indicador).toBe('contactos');
    const propia = estadoDeCompatibilidadLegado().organizaciones.find((x) => x.org === org)!;
    expect(propia.origen).toBe('PERSISTIDA');
    expect(propia.camposDelRegistro).toEqual([]);
    expect(propia.usos).toBe(0);

    // 7) EL DIRECTOR la descubriría sólo si su capacidad está habilitada, y su puerta ya la deja pasar.
    const politica = new PoliticaService(pool);
    expect((await politica.completitud(org)).estado).toBe('EVALUATION_PROFILE_COMPLETE');
    expect([...(await elegiblesPorCapacidad(pool, 'CICLO_DIRECTOR'))]).not.toContain(org);
    await conexiones.fijarCapacidad(org, 'qa', 'CICLO_DIRECTOR', true);
    expect([...(await elegiblesPorCapacidad(pool, 'CICLO_DIRECTOR'))]).toContain(org);

    // 8) COMPLETAR LA POLÍTICA NO AUTORIZA NADA: el gobierno sigue enteramente apagado.
    const gobierno = await new RepositorioNegocios(pool).gobierno(org);
    expect(gobierno).toEqual(expect.objectContaining({
      externalMutations: false, autonomousSpend: false, automaticSafetyPause: false, campaignExecution: false,
    }));

    // 9) AUDITORÍA: creación, actualización y la transición a evaluable, sin datos sensibles.
    const { rows } = await pool.query('select action, changed_fields from business_audit where organization_id = $1 order by id', [org]);
    const acciones = rows.map((r: { action: string }) => r.action);
    expect(acciones).toContain('EVALUATION_POLICY_CREATED');
    expect(acciones).toContain('EVALUATION_PROFILE_COMPLETED');
    expect(JSON.stringify(rows)).not.toContain('tok_qa_eval_123');
    await a.close();
  });

  it('quitar el indicador vuelve a dejarla incompleta, y se audita la regresión', async () => {
    const a = app();
    const cookie = await usuario(a, 'qa-regresion@soec.cl');
    const org = await crearEmpresa(a, cookie);
    const h = { ...H, cookie, 'x-organization-slug': org };
    await a.inject({ method: 'PATCH', url: '/politica', headers: h, payload: POLITICA_QA });

    const quitado = await a.inject({ method: 'PATCH', url: '/politica', headers: h, payload: { kpisEliminados: ['contactos'] } });
    expect(quitado.statusCode, quitado.body).toBe(200);
    expect(quitado.json().completitud.estado).toBe('EVALUATION_PROFILE_INCOMPLETE');
    expect(quitado.json().completitud.faltantes.map((f: { campo: string }) => f.campo)).toEqual(['primaryKpi', 'successCriterion']);

    const { rows } = await pool.query("select action from business_audit where organization_id = $1 and action = 'EVALUATION_PROFILE_BECAME_INCOMPLETE'", [org]);
    expect(rows).toHaveLength(1);
    await a.close();
  });

  it('el read model de salud dice por qué una empresa no entra al Director', async () => {
    const a = app();
    const cookie = await usuario(a, 'qa-salud@soec.cl');
    const org = await crearEmpresa(a, cookie);
    const h = { cookie, 'x-organization-slug': org };

    const salud = await a.inject({ method: 'GET', url: '/operacion/salud', headers: h });
    expect(salud.statusCode, salud.body).toBe(200);
    const ep = salud.json().evaluationProfile;
    expect(ep.status).toBe('EVALUATION_PROFILE_INCOMPLETE');
    expect(ep.missingFields).toContain('primaryKpi');
    expect(ep.lastUpdatedAt).toBeNull();

    await a.inject({ method: 'PATCH', url: '/politica', headers: { ...H, ...h }, payload: POLITICA_QA });
    const salud2 = await a.inject({ method: 'GET', url: '/operacion/salud', headers: h });
    expect(salud2.json().evaluationProfile.status).toBe('EVALUATION_PROFILE_COMPLETE');
    expect(salud2.json().evaluationProfile.missingFields).toEqual([]);
    expect(typeof salud2.json().evaluationProfile.lastUpdatedAt).toBe('string');
    await a.close();
  });
});

describe('aislamiento entre empresas', () => {
  it('una empresa no lee, no edita ni evalúa la política de otra', async () => {
    const a = app();
    const cookieA = await usuario(a, 'duena-a@soec.cl');
    const orgA = await crearEmpresa(a, cookieA, 'Empresa QA Evaluation A');
    await a.inject({ method: 'PATCH', url: '/politica', headers: { ...H, cookie: cookieA, 'x-organization-slug': orgA }, payload: POLITICA_QA });

    const cookieB = await usuario(a, 'dueno-b@soec.cl');
    const orgB = await crearEmpresa(a, cookieB, 'Empresa QA Evaluation B');

    // B declara el slug de A: el gateway no le da contexto de A.
    const leer = await a.inject({ method: 'GET', url: '/politica', headers: { cookie: cookieB, 'x-organization-slug': orgA } });
    expect([403, 404]).toContain(leer.statusCode);
    const editar = await a.inject({ method: 'PATCH', url: '/politica', headers: { ...H, cookie: cookieB, 'x-organization-slug': orgA }, payload: { objetivoText: 'secuestrado' } });
    expect([403, 404]).toContain(editar.statusCode);
    expect((await new RepositorioPolitica(pool).politica(orgA))?.objectiveText).toBe('conseguir más pacientes nuevos');

    // Y la política de B sigue vacía: nada se filtró de A.
    const deB = await a.inject({ method: 'GET', url: '/politica', headers: { cookie: cookieB, 'x-organization-slug': orgB } });
    expect(deB.json().completitud.estado).toBe('EVALUATION_PROFILE_INCOMPLETE');
    expect(deB.json().politica.kpis).toEqual([]);

    // Sin sesión, nada.
    const anon = await a.inject({ method: 'GET', url: '/politica', headers: { 'x-organization-slug': orgA } });
    expect([401, 403]).toContain(anon.statusCode);
    await a.close();
  });
});

describe('empresas históricas: funcionan DESDE DATOS', () => {
  beforeEach(async () => {
    await migrarNegociosDelRegistro(pool);
    await migrarConexionesDelRegistro(pool);
  });

  it('SmileFlow: el perfil reconstruido es IDÉNTICO al de su módulo histórico', async () => {
    const r = await migrarPoliticasDelRegistro(pool);
    expect(r.migradas).toContain('org-smileflow');
    await refrescarNegociosDelRuntime(pool);

    const persistido = buscarProfile('org-smileflow');
    expect(persistido).not.toBeNull();
    // PARIDAD EXACTA: mismo objetivo, criterio, política, gasto, límites, cuentas y contexto del director.
    expect(persistido).toEqual(CONFIGURACION_ORG_SMILEFLOW.perfil);

    // Y ya NO se resuelve con el módulo: su perfil dejó de figurar como dependencia legado.
    const sf = estadoDeCompatibilidadLegado().organizaciones.find((x) => x.org === 'org-smileflow')!;
    expect(sf.camposDelRegistro).not.toContain('perfilDeEvaluacion');
    expect(sf.camposDelRegistro).not.toContain('recursoGoogleAds');

    // La experiencia real sigue funcionando con el perfil persistido.
    const binding = bindExperienciaReal(ctx('org-smileflow'), 'autonomia-ads');
    expect(binding.perfil.criterio.muestraMinima).toBe(1000);
    expect(binding.perfil.externalResourceRefs.googleAds?.campaignId).toBe('24120966895');
    expect((await new PoliticaService(pool).completitud('org-smileflow')).estado).toBe('EVALUATION_PROFILE_COMPLETE');
  });

  it('CP Odontología: conserva lo real y queda INCOMPLETE diciendo qué falta', async () => {
    await migrarPoliticasDelRegistro(pool);
    const svc = new PoliticaService(pool);
    const v = await svc.leer('org-cp-odontologia');

    // Objetivo y embudo REALES (ya declarados); sin indicador ni meta, porque nadie los fijó.
    expect(v.objetivoDeclarado).toBe('captar pacientes / evaluaciones odontológicas');
    expect(v.politica.eventos.map((e) => e.eventKey)).toEqual(['whatsapp_intent', 'appointment_intent', 'phone_intent']);
    expect(v.politica.eventos.find((e) => e.rol === 'PRIMARY')?.eventKey).toBe('whatsapp_intent');
    expect(v.completitud.estado).toBe('EVALUATION_PROFILE_INCOMPLETE');
    expect(v.completitud.faltantes.map((f) => f.campo)).toEqual(['primaryKpi', 'successCriterion', 'evidenceMinimum']);
    expect(v.politica.kpis).toEqual([]);
    expect(v.politica.limites).toBeNull(); // no se inventan topes que nadie fijó

    // La realidad ya confirmada de CP está representada en sus datos canónicos, sin duplicarla en la política.
    expect(v.referencias.territorios.some((t) => t.ambito === 'BUSINESS' && (t.province ?? '').includes('Curicó'))).toBe(true);
    expect(v.referencias.oferta.map((o) => o.name)).toEqual(expect.arrayContaining(['rehabilitación oral', 'odontología general']));
    expect(v.referencias.oferta.find((o) => o.name === 'rehabilitación oral')?.priority).toBe(10);

    // Y el modelo PUEDE expresar una restricción negativa como «no Fonasa» cuando alguien la declare.
    const guardado = await svc.guardar('org-cp-odontologia', 'qa', {
      restriccionesNuevas: [{ texto: 'no atiende Fonasa', tipo: 'PROHIBITED_CLAIM' }],
    });
    expect(guardado.referencias.restricciones.some((x) => x.tipo === 'PROHIBITED_CLAIM' && x.texto === 'no atiende Fonasa')).toBe(true);
  });

  it('C Y P: sin política declarada no se inventa ninguna; queda incompleta y se dice el motivo', async () => {
    const r = await migrarPoliticasDelRegistro(pool);
    expect(r.migradas).not.toContain('org-cyp');
    expect(r.sinPolitica.join(' ')).toContain('org-cyp');
    expect(await new RepositorioPolitica(pool).politica('org-cyp')).toBeNull();
    const c = await new PoliticaService(pool).completitud('org-cyp');
    expect(c.estado).toBe('EVALUATION_PROFILE_INCOMPLETE');
    expect(c.faltantes.map((f) => f.campo)).toEqual([
      'primaryObjective', 'primaryConversionEvent', 'primaryKpi', 'successCriterion', 'evidenceMinimum',
    ]);
  });

  it('la migración es idempotente y no sobrescribe lo que el usuario editó', async () => {
    await migrarPoliticasDelRegistro(pool);
    const svc = new PoliticaService(pool);
    await svc.guardar('org-smileflow', 'humano', { evaluationHorizonDays: 45, notes: 'editado por una persona' });

    const segunda = await migrarPoliticasDelRegistro(pool);
    expect(segunda.migradas).toEqual([]);
    expect(segunda.yaEstaban).toEqual(expect.arrayContaining(['org-smileflow', 'org-cp-odontologia']));
    const p = await new RepositorioPolitica(pool).politica('org-smileflow');
    expect(p?.evaluationHorizonDays).toBe(45);
    expect(p?.notes).toBe('editado por una persona');
  });

  it('las capacidades de SmileFlow y su campaña no cambian por tener política persistida', async () => {
    await migrarPoliticasDelRegistro(pool);
    await refrescarNegociosDelRuntime(pool);
    const caps = new Map((await new RepositorioConexiones(pool).capacidades('org-smileflow')).map((c) => [c.capacidad, c.habilitada]));
    expect(caps.get('MEDICION_REAL')).toBe(true);
    expect(caps.get('DIRECTOR_REAL')).toBe(true);
    expect(caps.get('MONITOR_SEGURIDAD')).toBe(true);
    expect(caps.get('CICLO_DIRECTOR')).toBe(true);
    // CP no gana nada por esta fase.
    const capsCp = new Map((await new RepositorioConexiones(pool).capacidades('org-cp-odontologia')).map((c) => [c.capacidad, c.habilitada]));
    expect(capsCp.get('MONITOR_SEGURIDAD')).toBe(false);
    expect(capsCp.get('CICLO_DIRECTOR')).toBe(false);
  });
});
