/**
 * Superficie HTTP de CAMPAÑAS EN BORRADOR (Growth 1.1), con los borradores REALES de CP Odontología.
 *
 * Los cuerpos salen de `docs/growth/cp-odontologia-borradores.json`, el mismo archivo con el que se crean
 * en producción: lo que se prueba aquí es exactamente lo que se envía allí.
 *
 * Fija: borrador con presupuesto null; permisos (campaign.manage, y budget.manage para fijar dinero);
 * territorio de CP obligatorio y sin salirse de la Provincia de Curicó (ni al crear ni al editar);
 * aislamiento entre organizaciones; que no quedan decisiones huérfanas; que ninguna decisión se aprueba;
 * que no existe ruta de activación; y que una organización sin territorio declarado no hereda ninguno.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { decMktStreamId } from '@soec/decisiones-mkt';
import { campaniaStreamId } from '@soec/campanias';
import { buildApp } from '../src/app';
import { ALCANCE_COMERCIAL_CP_ODONTOLOGIA } from '../src/plataforma/negocios/org-cp-odontologia';

interface Borrador {
  readonly campaniaId: string;
  readonly campania: Record<string, unknown> & { alcanceGeografico: typeof ALCANCE_COMERCIAL_CP_ODONTOLOGIA; canal: string; nombre: string };
  readonly decision: Record<string, unknown>;
}
const ESPEC = JSON.parse(
  readFileSync(join(__dirname, '../../../docs/growth/cp-odontologia-borradores.json'), 'utf8'),
) as { organizationId: string; borradores: Borrador[] };

const CP = 'org-cp-odontologia';
const PERMISOS_OWNER = 'campaign.read,campaign.manage,budget.read,budget.manage';

function montar() {
  const store = new InMemoryEventStore();
  const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
  return { store, app };
}

const cab = (org: string, permisos = PERMISOS_OWNER) => ({
  'content-type': 'application/json',
  'x-organization-id': org,
  'x-actor-id': 'owner',
  'x-scope': 'events:read,events:append',
  'x-permissions': permisos,
});

const lectura = (org: string): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('test'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 't' };
};

const porId = (id: string): Borrador => ESPEC.borradores.find((b) => b.campaniaId === id)!;

describe('Campañas CP en BORRADOR · creación con los cuerpos reales', () => {
  it('la especificación es de CP y trae las tres líneas con su canal', () => {
    expect(ESPEC.organizationId).toBe(CP);
    expect(ESPEC.borradores.map((b) => [b.campania.nombre, b.campania.canal])).toEqual([
      ['CP | Implantes | Provincia de Curicó', 'GOOGLE_SEARCH'],
      ['CP | Rehabilitación y Prótesis | Provincia de Curicó', 'GOOGLE_SEARCH'],
      ['CP | Carillas y Estética | Provincia de Curicó', 'ORGANIC_INSTAGRAM'],
    ]);
  });

  it('crea los tres borradores: BORRADOR, presupuesto null, organización y territorio correctos', async () => {
    const { app, store } = montar();
    for (const b of ESPEC.borradores) {
      const r = await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: b });
      expect(r.statusCode, r.body).toBe(201);
      const v = r.json();
      expect(v.campania.organizacionId).toBe(CP);
      expect(v.campania.estado).toBe('BORRADOR');
      expect(v.campania.presupuesto).toBeNull();
      expect(v.campania.nombre).toBe(b.campania.nombre);
      expect(v.campania.canal).toBe(b.campania.canal);
      expect(v.geographicScope).toBe('Provincia de Curicó, Región del Maule, Chile');
      expect(v.campania.alcanceGeografico).toEqual(ALCANCE_COMERCIAL_CP_ODONTOLOGIA);
      expect(v.campania.alcanceGeografico.comunas).toHaveLength(9);
      expect(v.campania.alcanceGeografico.criterioUbicacion).toBe('PRESENCIA');
      // La decisión existe y NO está aprobada: falta el presupuesto, así que es NO_EVALUABLE.
      expect(v.decision.estado).toBe('NO_EVALUABLE');
      expect(v.activacion.ok).toBe(false);
      // Ni métricas ni criterios simulados: sólo las señales reales del sitio.
      const metricas = v.campania.metricas as string[];
      expect(metricas.every((m) => m === 'whatsapp_intent' || m === 'phone_intent')).toBe(true);
      expect(JSON.stringify(v.campania)).not.toMatch(/simulad|leads\/mes|leads_simulados|CPL simulado/i);
      // En el store: la decisión nunca se transicionó (un único evento, el de creación).
      const eventosDecision = await store.readStream(lectura(CP), decMktStreamId(CP, `dec-${b.campaniaId}`));
      expect(eventosDecision.map((e) => e.type)).toEqual(['decmkt.creada']);
    }
  });

  it('Carillas: canal orgánico y el requisito de casos reales queda registrado literalmente', async () => {
    const { app } = montar();
    const b = porId('cp-carillas-estetica-provincia-curico');
    const v = (await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: b })).json();
    expect(v.campania.canal).toBe('ORGANIC_INSTAGRAM');
    expect(v.campania.requisitosPrevios).toContain(
      'Incorporar casos clínicos reales y anonimizados de carillas antes de invertir en tráfico pagado.',
    );
  });

  it('Implantes y Rehabilitación: el requisito utm_source=google queda registrado', async () => {
    const { app } = montar();
    for (const id of ['cp-implantes-provincia-curico', 'cp-rehabilitacion-protesis-provincia-curico']) {
      const v = (await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: porId(id) })).json();
      expect((v.campania.requisitosPrevios as string[]).some((r) => r.includes('utm_source=google'))).toBe(true);
    }
  });

  it('Rehabilitación: landing principal existente + landings reales por grupo', async () => {
    const { app } = montar();
    const v = (
      await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: porId('cp-rehabilitacion-protesis-provincia-curico') })
    ).json();
    expect(v.campania.destino).toBe('https://www.dentistaclaudiapacheco.cl/servicios/');
    expect((v.campania.destinosPorGrupo as { grupo: string }[]).map((g) => g.grupo)).toEqual([
      'coronas', 'puentes', 'protesis-totales', 'protesis-parciales', 'protesis-hibrida',
    ]);
  });

  it('crear dos veces es idempotente: mismo borrador, sin eventos duplicados', async () => {
    const { app, store } = montar();
    const b = porId('cp-implantes-provincia-curico');
    await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: b });
    const r2 = await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: b });
    expect(r2.statusCode).toBe(201);
    expect(await store.readStream(lectura(CP), campaniaStreamId(CP, b.campaniaId))).toHaveLength(1);
  });

  it('GET devuelve el borrador; no existe ruta de activación', async () => {
    const { app } = montar();
    const b = porId('cp-implantes-provincia-curico');
    await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: b });
    const g = await app.inject({ method: 'GET', url: `/campanias/${b.campaniaId}`, headers: cab(CP, 'campaign.read') });
    expect(g.statusCode).toBe(200);
    expect(g.json().campania.presupuesto).toBeNull();
    for (const url of [`/campanias/${b.campaniaId}/activar`, `/campanias/${b.campaniaId}/transicion`]) {
      expect((await app.inject({ method: 'POST', url, headers: cab(CP), payload: {} })).statusCode).toBe(404);
    }
  });
});

describe('Campañas en BORRADOR · permisos y dinero', () => {
  it('sin campaign.manage → 403 y nada escrito', async () => {
    const { app, store } = montar();
    const b = porId('cp-implantes-provincia-curico');
    const r = await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP, 'campaign.read'), payload: b });
    expect(r.statusCode).toBe(403);
    expect(await store.readStream(lectura(CP), decMktStreamId(CP, `dec-${b.campaniaId}`))).toHaveLength(0);
  });

  it('fijar un presupuesto exige además budget.manage', async () => {
    const { app } = montar();
    const b = porId('cp-implantes-provincia-curico');
    const conDinero = { ...b, campania: { ...b.campania, presupuesto: { monto: 100000, moneda: 'CLP' } } };
    expect((await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP, 'campaign.manage'), payload: conDinero })).statusCode).toBe(403);
    // Y en la edición igual.
    await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: b });
    const p = await app.inject({
      method: 'PATCH', url: `/campanias/${b.campaniaId}/borrador`, headers: cab(CP, 'campaign.manage'),
      payload: { presupuesto: { monto: 100000, moneda: 'CLP' } },
    });
    expect(p.statusCode).toBe(403);
  });

  it('presupuesto 0 → 422 y NO queda una decisión huérfana', async () => {
    const { app, store } = montar();
    const b = porId('cp-implantes-provincia-curico');
    const cero = { ...b, campania: { ...b.campania, presupuesto: { monto: 0, moneda: 'CLP' } } };
    expect((await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: cero })).statusCode).toBe(422);
    expect(await store.readStream(lectura(CP), decMktStreamId(CP, `dec-${b.campaniaId}`))).toHaveLength(0);
  });

  it('omitir presupuesto no se interpreta como null: 400, hay que declararlo', async () => {
    const { app } = montar();
    const b = porId('cp-implantes-provincia-curico');
    const sinPresupuesto: Record<string, unknown> = { ...b.campania };
    delete sinPresupuesto['presupuesto'];
    const r = await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: { ...b, campania: sinPresupuesto } });
    expect(r.statusCode).toBe(400);
  });
});

describe('Territorio de CP · Provincia de Curicó, sin ampliación silenciosa', () => {
  const b = () => porId('cp-implantes-provincia-curico');

  it('una campaña CP sin alcance geográfico → 422', async () => {
    const { app } = montar();
    const sin = { ...b(), campania: { ...b().campania, alcanceGeografico: null } };
    expect((await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: sin })).statusCode).toBe(422);
  });

  it('ampliar a la Región del Maule (sin provincia ni comunas) → 422', async () => {
    const { app } = montar();
    const region = { ...b(), campania: { ...b().campania, alcanceGeografico: { ...ALCANCE_COMERCIAL_CP_ODONTOLOGIA, provincia: null, comunas: [] } } };
    expect((await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: region })).statusCode).toBe(422);
  });

  it('añadir Talca, Linares, Cauquenes, Constitución o San Fernando → 422', async () => {
    for (const ajena of ['Talca', 'Linares', 'Cauquenes', 'Constitución', 'San Fernando']) {
      const { app } = montar();
      const conAjena = {
        ...b(),
        campania: { ...b().campania, alcanceGeografico: { ...ALCANCE_COMERCIAL_CP_ODONTOLOGIA, comunas: [...ALCANCE_COMERCIAL_CP_ODONTOLOGIA.comunas, ajena] } },
      };
      const r = await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: conAjena });
      expect(r.statusCode, ajena).toBe(422);
      expect(r.json().message).toContain(`comuna:${ajena}`);
    }
  });

  it('segmentar por interés en vez de presencia → 422', async () => {
    const { app } = montar();
    const interes = { ...b(), campania: { ...b().campania, alcanceGeografico: { ...ALCANCE_COMERCIAL_CP_ODONTOLOGIA, criterioUbicacion: 'INTERES' } } };
    expect((await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: interes })).statusCode).toBe(422);
  });

  it('EDITAR tampoco amplía ni quita el territorio, y el borrador queda como estaba', async () => {
    const { app } = montar();
    await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: b() });
    const url = `/campanias/${b().campaniaId}/borrador`;
    const ampliar = { alcanceGeografico: { ...ALCANCE_COMERCIAL_CP_ODONTOLOGIA, region: 'Región de O’Higgins', comunas: ['San Fernando'] } };
    expect((await app.inject({ method: 'PATCH', url, headers: cab(CP), payload: ampliar })).statusCode).toBe(422);
    expect((await app.inject({ method: 'PATCH', url, headers: cab(CP), payload: { alcanceGeografico: null } })).statusCode).toBe(422);
    const g = (await app.inject({ method: 'GET', url: `/campanias/${b().campaniaId}`, headers: cab(CP) })).json();
    expect(g.campania.alcanceGeografico).toEqual(ALCANCE_COMERCIAL_CP_ODONTOLOGIA);
    expect(g.geographicScope).toBe('Provincia de Curicó, Región del Maule, Chile');
  });

  it('un subconjunto de la provincia sí se admite (sigue dentro)', async () => {
    const { app } = montar();
    const molina = { ...b(), campaniaId: 'cp-prueba-molina', campania: { ...b().campania, alcanceGeografico: { ...ALCANCE_COMERCIAL_CP_ODONTOLOGIA, comunas: ['Molina'] } } };
    expect((await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: molina })).statusCode).toBe(201);
  });

  it('claves no editables en PATCH → 400 (estado, decisión, aprobaciones)', async () => {
    const { app } = montar();
    await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: b() });
    for (const k of ['estado', 'decisionId', 'aprobaciones', 'organizacionId']) {
      const r = await app.inject({ method: 'PATCH', url: `/campanias/${b().campaniaId}/borrador`, headers: cab(CP), payload: { [k]: 'x' } });
      expect(r.statusCode, k).toBe(400);
    }
  });
});

describe('Aislamiento y organizaciones sin territorio declarado', () => {
  it('otra organización no ve el borrador de CP (404)', async () => {
    const { app } = montar();
    const b = porId('cp-implantes-provincia-curico');
    await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab(CP), payload: b });
    expect((await app.inject({ method: 'GET', url: `/campanias/${b.campaniaId}`, headers: cab('org-smileflow') })).statusCode).toBe(404);
  });

  it('SmileFlow no declara territorio: no se le impone ni se le infiere uno', async () => {
    const { app } = montar();
    const b = porId('cp-implantes-provincia-curico');
    const sf = { campaniaId: 'sf-borrador-prueba', campania: { ...b.campania, alcanceGeografico: null }, decision: b.decision };
    const r = await app.inject({ method: 'POST', url: '/campanias/borradores', headers: cab('org-smileflow'), payload: sf });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().campania.alcanceGeografico).toBeNull();
    expect(r.json().campania.organizacionId).toBe('org-smileflow');
  });
});
