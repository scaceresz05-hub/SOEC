import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, FixedClock } from '@soec/event-store';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { DecisionService, verificarIntegridadSnapshot } from '@soec/decision';
import { buildApp } from '../src/app';

const H = { 'content-type': 'application/json' };
const ORG = 'clinica-brille';
const DEP = 'marketing';

function makeApp() {
  return buildApp({
    store: new InMemoryEventStore(),
    intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true,
    clock: new FixedClock(new Date('2026-07-24T12:00:00.000Z')),
  });
}
function makeAppConStore() {
  const store = new InMemoryEventStore();
  return {
    app: buildApp({
      store,
      intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true,
      clock: new FixedClock(new Date('2026-07-24T12:00:00.000Z')),
    }),
    store,
  };
}
function ctxLectura(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('auditor'),
    scope: {
      organizationId: o,
      permissions: ['events:read', 'events:append', 'decisiones:decidir'],
    },
    correlationId: `audit-${org}`,
  };
}

type App = ReturnType<typeof makeApp>;

async function iniciarEval(app: App, org = ORG, dep = DEP): Promise<string> {
  return (
    await app.inject({
      method: 'POST',
      url: '/experience/evaluacion/iniciar',
      headers: H,
      payload: { org, departamento: dep, titulo: 'prueba' },
    })
  ).json().evaluacionId;
}
async function preguntas(app: App, org: string, dep: string, evaluacionId: string) {
  return (
    await app.inject({
      method: 'GET',
      url: `/experience/evaluacion/estado?org=${org}&departamento=${dep}&evaluacionId=${evaluacionId}`,
    })
  ).json().preguntas;
}
async function preguntaPorSenal(
  app: App,
  org: string,
  dep: string,
  evaluacionId: string,
  senalNombre: string,
): Promise<string> {
  return (await preguntas(app, org, dep, evaluacionId)).find(
    (p: { senalNombre: string | null }) => p.senalNombre === senalNombre,
  ).preguntaId;
}
function responder(
  app: App,
  org: string,
  dep: string,
  evaluacionId: string,
  preguntaId: string,
  entrada: unknown,
) {
  return app.inject({
    method: 'POST',
    url: '/experience/evaluacion/responder',
    headers: H,
    payload: { org, departamento: dep, evaluacionId, preguntaId, entrada },
  });
}
async function sembrar(app: App, org = ORG, dep = DEP): Promise<string> {
  const evaluacionId = await iniciarEval(app, org, dep);
  const pPocas = await preguntaPorSenal(app, org, dep, evaluacionId, 'POCAS_SOLICITUDES');
  const pNoShow = await preguntaPorSenal(app, org, dep, evaluacionId, 'ALTO_NO_SHOW');
  await responder(app, org, dep, evaluacionId, pPocas, { clase: 'CERRADA', valorCrudo: 'sí' });
  await responder(app, org, dep, evaluacionId, pNoShow, { clase: 'CERRADA', valorCrudo: 'sí' });
  await responder(app, org, dep, evaluacionId, '¿Qué tratamientos ofrece?', {
    clase: 'ABIERTA',
    texto: 'Ortodoncia',
  });
  await app.inject({
    method: 'POST',
    url: '/experience/evaluacion/generar',
    headers: H,
    payload: { org, departamento: dep, evaluacionId },
  });
  return evaluacionId;
}
function wsEstado(app: App, org: string, dep: string, evaluacionId: string) {
  return app.inject({
    method: 'GET',
    url: `/experience/director-workspace/estado?org=${org}&departamento=${dep}&evaluacionId=${evaluacionId}`,
  });
}

// Frontera dura §9.
const PERMITIDOS = [
  '@soec/contracts',
  '@soec/event-store',
  '@soec/rubros',
  '@soec/evaluacion',
  '@soec/diagnostico',
  '@soec/estrategia',
  '@soec/decision',
];
const PROHIBIDOS = [
  '@soec/marketing',
  '@soec/canales',
  '@soec/operacional',
  '@soec/piloto',
  '@soec/control',
  '@soec/contenido',
  '@soec/medicion',
  '@soec/operaciones',
  '@soec/models',
  '@soec/ece',
  '@soec/capacidades',
  '@soec/instancia-pyme',
];
function importsDe(rel: string): string[] {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
  return [...src.matchAll(/from\s+'(@soec\/[^']+)'/g)].map((m) => m[1]!.replace(/\/pg$/, ''));
}

describe('Frontera arquitectónica (§9)', () => {
  it('las experiencias NO importan Preparación/Marketing/Operación', () => {
    const imports = [
      ...importsDe('../src/director-workspace-experience.ts'),
      ...importsDe('../src/director-workspace-routes.ts'),
      ...importsDe('../src/evaluacion-experience.ts'),
      ...importsDe('../src/evaluacion-routes.ts'),
    ];
    for (const imp of imports) expect(PERMITIDOS, `import no permitido: ${imp}`).toContain(imp);
    for (const p of PROHIBIDOS) expect(imports).not.toContain(p);
  });
});

describe('F2-PILOT-00 · selección gobernada e identidad de evaluación', () => {
  it('el catálogo expone organizaciones de demostración', async () => {
    const app = makeApp();
    const cat = (await app.inject({ method: 'GET', url: '/experience/catalogo' })).json();
    expect(cat.organizaciones.length).toBeGreaterThanOrEqual(3);
    await app.close();
  });

  it('una combinación org/departamento fuera del catálogo es rechazada (400)', async () => {
    const app = makeApp();
    const r = await app.inject({
      method: 'POST',
      url: '/experience/evaluacion/iniciar',
      headers: H,
      payload: { org: 'inexistente', departamento: 'marketing' },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('el cuestionario se genera desde el rubro (cerradas y abiertas)', async () => {
    const app = makeApp();
    const id = await iniciarEval(app);
    const ps = await preguntas(app, ORG, DEP, id);
    expect(ps.length).toBeGreaterThanOrEqual(8);
    expect(ps.some((p: { tipo: string }) => p.tipo === 'CERRADA_BOOLEAN')).toBe(true);
    expect(ps.some((p: { tipo: string }) => p.tipo === 'ABIERTA')).toBe(true);
    await app.close();
  });

  it('dos evaluaciones del mismo (org,dep) NO se contaminan', async () => {
    const app = makeApp();
    const e1 = await iniciarEval(app);
    const e2 = await iniciarEval(app);
    expect(e1).not.toBe(e2);
    await responder(app, ORG, DEP, e1, '¿Qué tratamientos ofrece?', {
      clase: 'ABIERTA',
      texto: 'sesión 1',
    });
    await responder(app, ORG, DEP, e2, '¿Qué tratamientos ofrece?', {
      clase: 'ABIERTA',
      texto: 'sesión 2',
    });
    const p1 = (await preguntas(app, ORG, DEP, e1)).find(
      (p: { preguntaId: string }) => p.preguntaId === '¿Qué tratamientos ofrece?',
    );
    const p2 = (await preguntas(app, ORG, DEP, e2)).find(
      (p: { preguntaId: string }) => p.preguntaId === '¿Qué tratamientos ofrece?',
    );
    expect(p1.entrada.texto).toBe('sesión 1');
    expect(p2.entrada.texto).toBe('sesión 2');
    // El índice lista ambas.
    const lista = (
      await app.inject({
        method: 'GET',
        url: `/experience/evaluacion/lista?org=${ORG}&departamento=${DEP}`,
      })
    ).json();
    expect(lista.evaluaciones.map((x: { evaluacionId: string }) => x.evaluacionId).sort()).toEqual(
      [e1, e2].sort(),
    );
    await app.close();
  });

  it('ciclo de estados: BORRADOR → GENERADA → CERRADA; cerrada no admite respuestas (422)', async () => {
    const app = makeApp();
    const id = await iniciarEval(app);
    expect(
      (
        await responder(app, ORG, DEP, id, '¿Qué tratamientos ofrece?', {
          clase: 'ABIERTA',
          texto: 'x',
        })
      ).json().estado,
    ).toBe('BORRADOR');
    await app.inject({
      method: 'POST',
      url: '/experience/evaluacion/generar',
      headers: H,
      payload: { org: ORG, departamento: DEP, evaluacionId: id },
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/experience/evaluacion/estado?org=${ORG}&departamento=${DEP}&evaluacionId=${id}`,
        })
      ).json().estado,
    ).toBe('GENERADA');
    await app.inject({
      method: 'POST',
      url: '/experience/evaluacion/cerrar',
      headers: H,
      payload: { org: ORG, departamento: DEP, evaluacionId: id },
    });
    const r = await responder(app, ORG, DEP, id, '¿Qué tratamientos ofrece?', {
      clase: 'ABIERTA',
      texto: 'y',
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it('guardarraíl: una evaluación sin respuestas se marca como generación sin evidencia', async () => {
    const app = makeApp();
    const id = await iniciarEval(app);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/experience/evaluacion/estado?org=${ORG}&departamento=${DEP}&evaluacionId=${id}`,
        })
      ).json().generacionSinEvidencia,
    ).toBe(true);
    await responder(app, ORG, DEP, id, '¿Qué tratamientos ofrece?', {
      clase: 'ABIERTA',
      texto: 'algo',
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/experience/evaluacion/estado?org=${ORG}&departamento=${DEP}&evaluacionId=${id}`,
        })
      ).json().generacionSinEvidencia,
    ).toBe(false);
    await app.close();
  });
});

describe('F2-DISC-03 · captura → comprensión', () => {
  it('normalización segura: valor ambiguo → NO_NORMALIZABLE y la señal no activa candidato', async () => {
    const app = makeApp();
    const id = await iniciarEval(app);
    const pPocas = await preguntaPorSenal(app, ORG, DEP, id, 'POCAS_SOLICITUDES');
    await responder(app, ORG, DEP, id, pPocas, { clase: 'CERRADA', valorCrudo: 'a veces' });
    const ps = await preguntas(app, ORG, DEP, id);
    expect(ps.find((p: { preguntaId: string }) => p.preguntaId === pPocas).estado).toBe(
      'NO_NORMALIZABLE',
    );
    await app.inject({
      method: 'POST',
      url: '/experience/evaluacion/generar',
      headers: H,
      payload: { org: ORG, departamento: DEP, evaluacionId: id },
    });
    const w = (await wsEstado(app, ORG, DEP, id)).json();
    expect(w.candidatos.some((c: { objetivoId: string }) => c.objetivoId === 'OBJ-CD-01')).toBe(
      false,
    );
    await app.close();
  });

  it('borrador durable: la respuesta persiste entre consultas', async () => {
    const app = makeApp();
    const id = await iniciarEval(app);
    await responder(app, ORG, DEP, id, '¿Qué tratamientos ofrece?', {
      clase: 'ABIERTA',
      texto: 'Implantes',
    });
    const ps = await preguntas(app, ORG, DEP, id);
    expect(
      ps.find((p: { preguntaId: string }) => p.preguntaId === '¿Qué tratamientos ofrece?').entrada,
    ).toEqual({ clase: 'ABIERTA', texto: 'Implantes' });
    await app.close();
  });
});

describe('Director Workspace · gobernabilidad + auditabilidad', () => {
  it('sin generación: el Workspace no propone y lo declara', async () => {
    const app = makeApp();
    const id = await iniciarEval(app);
    const w = (await wsEstado(app, ORG, DEP, id)).json();
    expect(w.sinEvaluacion).toBe(true);
    expect(w.propuestaDisponible).toBe(false);
    await app.close();
  });

  it('tras generar: candidatos fundados + trazabilidad hasta la respuesta original', async () => {
    const app = makeApp();
    const id = await sembrar(app);
    const w = (await wsEstado(app, ORG, DEP, id)).json();
    expect(w.propuestaDisponible).toBe(true);
    expect(w.candidatos.length).toBeGreaterThanOrEqual(1);
    for (const c of w.candidatos) {
      expect(c.trazabilidad.cadena.length).toBeGreaterThan(0);
      for (const paso of c.trazabilidad.cadena) {
        expect(paso.senal.id).toMatch(/^SIG-/);
        expect(paso.respuestaOriginal).not.toBeNull();
      }
    }
    await app.close();
  });

  it('Aceptar → vigente; Rechazar no cambia el vigente; Revocar lo retira', async () => {
    const app = makeApp();
    const id = await sembrar(app);
    const w0 = (await wsEstado(app, ORG, DEP, id)).json();
    const objetivoId = w0.candidatos[0].objetivoId;
    const acc = await app.inject({
      method: 'POST',
      url: '/experience/director-workspace/decidir',
      headers: H,
      payload: {
        org: ORG,
        departamento: DEP,
        evaluacionId: id,
        decisionId: 'd1',
        resultado: 'ACEPTADO',
        objetivoId,
        justificacion: { texto: 'prioridad', categoria: 'NEGOCIO' },
      },
    });
    expect(acc.json().gobierno.vigente.objetivoId).toBe(objetivoId);
    const rej = await app.inject({
      method: 'POST',
      url: '/experience/director-workspace/decidir',
      headers: H,
      payload: {
        org: ORG,
        departamento: DEP,
        evaluacionId: id,
        decisionId: 'd2',
        resultado: 'RECHAZADO',
        justificacion: { texto: 'no', categoria: 'PRIORIDAD' },
      },
    });
    expect(rej.json().gobierno.vigente.objetivoId).toBe(objetivoId);
    const rev = await app.inject({
      method: 'POST',
      url: '/experience/director-workspace/revocar',
      headers: H,
      payload: {
        org: ORG,
        departamento: DEP,
        evaluacionId: id,
        decisionId: 'd1',
        motivo: 'cambio',
      },
    });
    expect(rev.json().gobierno.vigente).toBeNull();
    await app.close();
  });

  it('decisiones de dos evaluaciones NO se contaminan', async () => {
    const app = makeApp();
    const eA = await sembrar(app);
    const eB = await sembrar(app);
    const oA = (await wsEstado(app, ORG, DEP, eA)).json().candidatos[0].objetivoId;
    await app.inject({
      method: 'POST',
      url: '/experience/director-workspace/decidir',
      headers: H,
      payload: {
        org: ORG,
        departamento: DEP,
        evaluacionId: eA,
        decisionId: 'da',
        resultado: 'ACEPTADO',
        objetivoId: oA,
        justificacion: { texto: 'a', categoria: 'NEGOCIO' },
      },
    });
    // eB no tiene decisión; su vigente sigue nulo (aislamiento).
    expect((await wsEstado(app, ORG, DEP, eB)).json().gobierno.vigente).toBeNull();
    expect((await wsEstado(app, ORG, DEP, eA)).json().gobierno.vigente.objetivoId).toBe(oA);
    await app.close();
  });

  it('justificación vacía → 422 del motor de decisión', async () => {
    const app = makeApp();
    const id = await sembrar(app);
    const w0 = (await wsEstado(app, ORG, DEP, id)).json();
    const r = await app.inject({
      method: 'POST',
      url: '/experience/director-workspace/decidir',
      headers: H,
      payload: {
        org: ORG,
        departamento: DEP,
        evaluacionId: id,
        decisionId: 'dz',
        resultado: 'ACEPTADO',
        objetivoId: w0.candidatos[0].objetivoId,
        justificacion: { texto: '   ', categoria: 'NEGOCIO' },
      },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });
});

describe('Procedencia — snapshot congelado íntegro tras regeneración agresiva', () => {
  it('decisión A byte-idéntica (comprensión + estrategia + candidato + huella), no solo el objetivo', async () => {
    const { app, store } = makeAppConStore();
    const id = await sembrar(app);
    const alcance = `${DEP}::${id}`;
    const w0 = (await wsEstado(app, ORG, DEP, id)).json();
    await app.inject({
      method: 'POST',
      url: '/experience/director-workspace/decidir',
      headers: H,
      payload: {
        org: ORG,
        departamento: DEP,
        evaluacionId: id,
        decisionId: 'A',
        resultado: 'ACEPTADO',
        objetivoId: w0.candidatos[0].objetivoId,
        justificacion: { texto: 'A', categoria: 'NEGOCIO' },
      },
    });

    const svc = new DecisionService(store);
    const regA0 = (await svc.cargar(ctxLectura(ORG), alcance)).decisiones.find(
      (d) => d.decisionId === 'A',
    )!;
    const snapA = JSON.parse(JSON.stringify(regA0.propuesta));
    const candA = JSON.parse(JSON.stringify(regA0.candidatoElegido));
    const hashA = regA0.snapshotHash;
    expect(verificarIntegridadSnapshot(regA0)).toBe(true);

    const flip: Array<[string, string]> = [
      [await preguntaPorSenal(app, ORG, DEP, id, 'POCAS_SOLICITUDES'), 'no'],
      [await preguntaPorSenal(app, ORG, DEP, id, 'ALTO_NO_SHOW'), 'no'],
      [await preguntaPorSenal(app, ORG, DEP, id, 'POCA_RECOMPRA'), 'sí'],
      [await preguntaPorSenal(app, ORG, DEP, id, 'BAJA_TASA_AGENDAMIENTO'), 'sí'],
    ];
    for (const [preguntaId, valorCrudo] of flip)
      await responder(app, ORG, DEP, id, preguntaId, { clase: 'CERRADA', valorCrudo });
    await app.inject({
      method: 'POST',
      url: '/experience/evaluacion/generar',
      headers: H,
      payload: { org: ORG, departamento: DEP, evaluacionId: id },
    });
    const w1 = (await wsEstado(app, ORG, DEP, id)).json();
    expect(w1.generacion.huella).not.toBe(w0.generacion.huella);
    await app.inject({
      method: 'POST',
      url: '/experience/director-workspace/decidir',
      headers: H,
      payload: {
        org: ORG,
        departamento: DEP,
        evaluacionId: id,
        decisionId: 'B',
        resultado: 'ACEPTADO',
        objetivoId: w1.candidatos[0].objetivoId,
        justificacion: { texto: 'B', categoria: 'PRIORIDAD' },
      },
    });

    const regAf = (await svc.cargar(ctxLectura(ORG), alcance)).decisiones.find(
      (d) => d.decisionId === 'A',
    )!;
    expect(regAf.estadoRegistro).toBe('SUPERADA');
    expect(regAf.snapshotHash).toBe(hashA);
    expect(regAf.propuesta).toEqual(snapA);
    expect(regAf.candidatoElegido).toEqual(candA);
    expect(verificarIntegridadSnapshot(regAf)).toBe(true);
    await app.close();
  });
});
