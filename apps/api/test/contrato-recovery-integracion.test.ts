/**
 * CONTRATO DE LA INTEGRACIÓN `ux/single-entry-point` + `main` (Recovery Phase 2).
 *
 * El incidente que esto evita: `soec-api` se desplegó desde `main` mientras `soec-web` y la API de
 * producción venían de `ux/single-entry-point`. El despliegue borró de producción el monitor de stops,
 * el ciclo del director, el scheduler de Google Ads y las rutas que el panel consume, sin que ninguna
 * prueba se quejara. Estas pruebas fijan que el árbol integrado conserva LAS DOS mitades:
 *
 *   1. soec-web → toda ruta que el proxy de soec-web reenvía EXISTE en soec-api (con su método).
 *   2. org-smileflow → sus bucles operativos siguen cableados en el arranque, y fijados a SmileFlow.
 *   3. CP → no recibe por accidente ningún bucle de Ads de SmileFlow; la selección es explícita.
 *   4. org-cp-odontologia → reconocida por el API (multi-org de main), con su configuración.
 *   5. SmileFlow → su configuración registrada no cambia.
 *   6. Borradores de CP ya almacenados → listables por el tenant, sin recrearlos.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { EVENTOS_CAMPANIA, campaniaStreamId } from '@soec/campanias';
import { DecisionMktService } from '@soec/decisiones-mkt';
import { buildApp } from '../src/app';
import { correrTodasLasConexiones } from '../src/ingesta/google-ads-scheduler';
import {
  buscarNegocio,
  getBusiness,
  getEmbudo,
  getFuenteGrowth,
  getSources,
  organizacionesRegistradas,
} from '../src/plataforma';

const RAIZ = join(__dirname, '../../..');
const leer = (rel: string): string => readFileSync(join(RAIZ, rel), 'utf8');

/** Extrae el contenido de `const NOMBRE = new Set([ ... ])` de un archivo fuente del proxy web. */
function conjunto(fuente: string, nombre: string): string[] {
  const m = new RegExp(`const ${nombre} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(fuente);
  if (!m) throw new Error(`no encontré ${nombre} en el proxy web`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

async function appLegacy(store = new InMemoryEventStore()) {
  const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
  await app.ready();
  return app;
}

describe('1 · soec-web → las rutas que el proxy reenvía existen en soec-api', () => {
  const medicion = leer('apps/web/app/api/medicion/[accion]/route.ts');
  const plataforma = leer('apps/web/app/api/plataforma/[recurso]/route.ts');
  const googleAds = leer('apps/web/app/api/google-ads/[...accion]/route.ts');

  const casos: { metodo: 'GET' | 'POST'; url: string }[] = [
    ...conjunto(medicion, 'GET_ACCIONES').map((a) => ({ metodo: 'GET' as const, url: `/medicion/${a}` })),
    ...conjunto(medicion, 'POST_ACCIONES').map((a) => ({ metodo: 'POST' as const, url: `/medicion/${a}` })),
    ...conjunto(plataforma, 'GET_RECURSOS').map((r) => ({ metodo: 'GET' as const, url: `/plataforma/${r}` })),
    ...conjunto(googleAds, 'GET_PATHS').map((p) => ({ metodo: 'GET' as const, url: `/acquisition/google-ads/${p}` })),
    ...conjunto(googleAds, 'POST_PATHS').map((p) => ({ metodo: 'POST' as const, url: `/acquisition/google-ads/${p}` })),
  ];

  it('el proxy declara las rutas operativas de la rama (no se perdió el contrato del panel)', () => {
    const urls = casos.map((c) => `${c.metodo} ${c.url}`);
    for (const esperada of [
      'GET /medicion/director', 'GET /medicion/campaign-live', 'GET /medicion/envelope',
      'POST /medicion/envelope', 'POST /medicion/canary-execute', 'GET /medicion/panel',
    ]) expect(urls).toContain(esperada);
  });

  it.each(casos)('$metodo $url está registrada en la API', async ({ metodo, url }) => {
    const app = await appLegacy();
    expect(app.hasRoute({ method: metodo, url })).toBe(true);
    await app.close();
  });

  it('decisiones y listado de campañas también existen', async () => {
    const app = await appLegacy();
    expect(app.hasRoute({ method: 'GET', url: '/medicion/decisiones' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/campanias' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/campanias/:campaniaId' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/campanias/borradores' })).toBe(true);
    await app.close();
  });
});

describe('2/3 · bucles operativos: SmileFlow los conserva; CP no los recibe', () => {
  const server = leer('apps/api/src/server.ts');

  it('los cuatro bucles siguen cableados en el arranque', () => {
    expect(server).toMatch(/iniciarStopMonitor\(/);
    expect(server).toMatch(/iniciarDirectorCycle\(/);
    expect(server).toMatch(/new GoogleAdsScheduler\(/);
    expect(server).toMatch(/iniciarMetaScheduler\(/);
  });

  it('stopMonitor y directorCycle están fijados a org-smileflow, no a "todas las organizaciones"', () => {
    expect(server).toMatch(/iniciarStopMonitor\(svc, 'org-smileflow'/);
    expect(server).toMatch(/iniciarDirectorCycle\(directorCycle, 'org-smileflow'/);
    // Nada en el arranque itera el registro de organizaciones ni nombra a CP.
    expect(server).not.toMatch(/organizacionesRegistradas/);
    expect(server).not.toMatch(/cp-odontologia/i);
  });

  it('el scheduler de Google Ads sólo sincroniza conexiones OAuth explícitas: sin conexión de CP, CP no se toca', async () => {
    const sincronizadas: string[] = [];
    const resumen = await correrTodasLasConexiones({
      store: new InMemoryEventStore(),
      env: {},
      comp: {} as never,
      connRepo: { listarConectadas: async () => [{ organizationId: 'org-smileflow', connectionId: 'c1' }] } as never,
      lease: { adquirir: async () => true, liberar: async () => undefined } as never,
      holder: 'test',
      habilitado: true,
      ahora: () => '2026-09-17T12:00:00.000Z',
      sincronizar: async (org: string) => {
        sincronizadas.push(org);
        return { estado: 'OK', dataThrough: null };
      },
    } as never);
    expect(resumen.resultados.map((r) => r.org)).toEqual(['org-smileflow']);
    expect(resumen.resultados.map((r) => r.org)).not.toContain('org-cp-odontologia');
  });
});

describe('4/5 · multi-org: CP reconocida; SmileFlow sin cambios', () => {
  it('org-cp-odontologia está registrada con su fuente Growth, allowlist y territorio', () => {
    expect(organizacionesRegistradas()).toContain('org-cp-odontologia');
    const g = getFuenteGrowth('org-cp-odontologia');
    expect(g.provider).toBe('cp-odontologia-growth');
    expect([...g.hostsAutorizados].sort()).toEqual(['cp-odontologia-stg.pages.dev', 'www.dentistaclaudiapacheco.cl']);
    expect(g.credencialRef).toBe('env:CP_ODONTOLOGIA_GROWTH_TOKEN');
    expect(g.baseUrlEnvOverride).toBe('CP_ODONTOLOGIA_M2M_URL');
    const n = getBusiness('org-cp-odontologia');
    expect(n.modeloDeNegocio).toBe('SERVICIOS');
    expect(n.tipoDeNegocio).toBe('clínica odontológica');
    expect(n.objetivoComercial).toBe('captar pacientes / evaluaciones odontológicas');
    expect(n.especialidad).toEqual({ principal: 'rehabilitación oral', tambienPresta: ['odontología general'] });
    expect(n.alcanceComercial?.provincia).toBe('Provincia de Curicó');
  });

  it('SmileFlow conserva exactamente su configuración: modelo, fuentes, Growth, embudo; sin identidad nueva', () => {
    const n = getBusiness('org-smileflow');
    expect(n.modeloDeNegocio).toBe('SAAS_FUNNEL');
    expect(n.tipoDeNegocio).toBeUndefined();
    expect(n.objetivoComercial).toBeUndefined();
    expect(n.especialidad).toBeUndefined();
    expect(n.alcanceComercial).toBeUndefined();
    const g = getFuenteGrowth('org-smileflow');
    expect({ provider: g.provider, hosts: g.hostsAutorizados, cred: g.credencialRef, override: g.baseUrlEnvOverride, estado: g.estado }).toEqual({
      provider: 'smileflow-growth',
      hosts: ['smileflow-clinic-production.up.railway.app'],
      cred: 'env:SMILEFLOW_GROWTH_TOKEN',
      override: 'SMILEFLOW_M2M_URL',
      estado: 'CONNECTED_READ_ONLY',
    });
    expect(getSources('org-smileflow').map((f) => `${f.sourceId}=${f.estado}`)).toEqual([
      'src-smileflow-google-ads=CONNECTED_READ_ONLY',
      'src-smileflow-growth=CONNECTED_READ_ONLY',
    ]);
    expect(getEmbudo('org-smileflow')).toEqual({
      conversionPrimaria: 'demo_requested',
      conversionesSecundarias: ['demo_cta_clicked', 'demo_form_started', 'lead_created'],
    });
    expect(buscarNegocio('org-smileflow')?.displayName).toBe('SmileFlow Clinic');
  });
});

describe('6 · borradores de CP ya almacenados → listables por el tenant, sin recrear', () => {
  const ESPEC = JSON.parse(leer('docs/growth/cp-odontologia-borradores.json')) as {
    borradores: { campaniaId: string; campania: Record<string, unknown>; decision: Record<string, unknown> }[];
  };
  const CP = 'org-cp-odontologia';
  const ctx = (org: string): RequestContext => {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('owner'), scope: { organizationId: o, permissions: ['events:read', 'events:append'] }, correlationId: 'rec' };
  };
  const cab = (org: string, permisos = 'campaign.read') => ({
    'x-organization-id': org, 'x-actor-id': 'owner', 'x-scope': 'events:read', 'x-permissions': permisos,
  });

  /**
   * Escribe los eventos con la MISMA forma que tienen en producción: un `campania.creada` por campaña y un
   * `decmkt.creada` por decisión, sin pasar por la API. Así se prueba que el lector los recupera tal como
   * están guardados, no que la API sabe releer lo que ella misma escribe.
   */
  async function sembrarComoProduccion(store: InMemoryEventStore) {
    const dec = new DecisionMktService(store);
    for (const b of ESPEC.borradores) {
      const d = b.decision;
      await dec.crear(ctx(CP), `dec-${b.campaniaId}`, {
        organizacionId: CP, objetivo: String(d['objetivo']), contexto: String(d['contexto']), hechos: [],
        fuentes: d['fuentes'] as string[], faltantesObligatorios: d['faltantesObligatorios'] as string[], inferencias: [],
        hipotesis: (d['hipotesis'] as string[]).map((enunciado, i) => ({ id: `h${i + 1}`, enunciado, tipo: 'HIPOTESIS' as const })),
        alternativas: [], justificacion: String(d['justificacion']), riesgos: d['riesgos'] as string[], confianza: null,
        criterioExito: String(d['criterioExito']), criterioFracaso: String(d['criterioFracaso']),
        aprobacionRequerida: true, nivelAutonomia: 0, aprendizajeQueLaCambio: null,
      }, { source: 'campanias-borrador', purpose: 'p', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'media' }, '2026-09-16T15:00:00.000Z');
      await store.append(ctx(CP), campaniaStreamId(CP, b.campaniaId), 0, [{
        type: EVENTOS_CAMPANIA.creada,
        payload: {
          ...b.campania, campaniaId: b.campaniaId, organizacionId: CP, decisionId: `dec-${b.campaniaId}`,
          aprobaciones: [], nivelAutonomia: 0, estado: 'BORRADOR',
        },
        attribution: { source: 'campanias-borrador', purpose: 'p', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'media' },
        occurredAt: '2026-09-16T15:00:00.000Z',
      }]);
    }
  }

  it('GET /campanias?estado=BORRADOR devuelve las 4 de CP con su estado, presupuesto null y territorio', async () => {
    const store = new InMemoryEventStore();
    await sembrarComoProduccion(store);
    const app = await appLegacy(store);
    const r = await app.inject({ method: 'GET', url: '/campanias?estado=BORRADOR', headers: cab(CP) });
    expect(r.statusCode, r.body).toBe(200);
    const v = r.json();
    expect(v.organizationId).toBe(CP);
    expect(v.total).toBe(4);
    expect(v.campanias.map((c: { campania: { campaniaId: string } }) => c.campania.campaniaId)).toEqual([
      'cp-carillas-estetica-provincia-curico',
      'cp-implantes-provincia-curico',
      'cp-odontologia-general-provincia-curico',
      'cp-rehabilitacion-protesis-provincia-curico',
    ]);
    for (const c of v.campanias) {
      expect(c.campania.estado).toBe('BORRADOR');
      expect(c.campania.presupuesto).toBeNull();
      expect(c.geographicScope).toBe('Provincia de Curicó, Región del Maule, Chile');
      expect(c.decision.estado).toBe('NO_EVALUABLE');
    }
    // Listar no escribe nada: cada campaña sigue con su único evento de creación.
    for (const b of ESPEC.borradores) {
      expect(await store.readStream(ctx(CP), campaniaStreamId(CP, b.campaniaId))).toHaveLength(1);
    }
    await app.close();
  });

  it('aislamiento: otra organización no ve las campañas de CP', async () => {
    const store = new InMemoryEventStore();
    await sembrarComoProduccion(store);
    const app = await appLegacy(store);
    const r = await app.inject({ method: 'GET', url: '/campanias', headers: cab('org-smileflow') });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(0);
    await app.close();
  });

  it('sin campaign.read → 403; estado desconocido → 400', async () => {
    const app = await appLegacy();
    expect((await app.inject({ method: 'GET', url: '/campanias', headers: cab(CP, 'business.read') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/campanias?estado=DRAFT', headers: cab(CP) })).statusCode).toBe(400);
    await app.close();
  });
});
