/**
 * Configuración de programas por negocio vía runtime + caso de aceptación SmileFlow.
 * Verifica el flujo completo por API: registrar negocio → crear programa → 3 segmentos /
 * 3 hipótesis / 3 campañas (presupuesto 120k/100k/80k = 300k) + contenido → marcar listo →
 * ejecutar ciclo SIMULADO (ROI SIMULADO nunca REAL) → PAUSA bloquea → aislamiento por org.
 * Ejecución simulada; sin efectos externos reales.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, FixedClock } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

const H = { 'content-type': 'application/json' };
const ORG = 'smileflow-clinic-pilot';
const BASE = `/experience/director-autonomo/organizaciones`;
const PROG = 'captacion-smileflow-v1';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true, clock: new FixedClock(new Date('2026-08-01T12:00:00.000Z')) });
}
type App = ReturnType<typeof makeApp>;

async function configurarSmileFlow(app: App): Promise<void> {
  await app.inject({ method: 'POST', url: BASE, headers: H, payload: { org: ORG, negocio: { nombre: 'SmileFlow Clinic', descripcion: 'gestión de clínicas dentales', industria: 'salud dental', pais: 'CL', moneda: 'CLP', zonaHoraria: 'America/Santiago' }, perfil: { problemas: ['agenda desordenada', 'inasistencias'], propuestaValor: 'plataforma única de gestión dental', capacidadesVerificadas: ['agenda', 'pacientes', 'finanzas'], restricciones: ['no es consejo médico'], diferenciadores: ['adaptada a clínicas dentales'], informacionFaltante: ['tamaño de mercado'] } } });
  await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas`, headers: H, payload: { programaId: PROG, nombre: 'Programa de captación SmileFlow V1', objetivoPrincipal: 'generar oportunidades de clínicas interesadas', objetivosSecundarios: ['conocimiento de marca', 'solicitudes de demo'], presupuestoTotalSimulado: 300000, moneda: 'CLP' } });
  const segmentos = [
    { id: 'pequena', nombre: 'Clínica pequeña', descripcion: '1-3 profesionales', problemas: ['agenda manual'], necesidades: ['reducir inasistencias'], criterios: ['1-3 boxes'], prioridad: 1 },
    { id: 'crecimiento', nombre: 'Clínica en crecimiento', descripcion: 'varios boxes', problemas: ['coordinación'], necesidades: ['control agenda/finanzas'], criterios: ['varios odontólogos'], prioridad: 2 },
    { id: 'multisede', nombre: 'Centro multi-sede', descripcion: 'varias sedes', problemas: ['centralización'], necesidades: ['roles y reportes'], criterios: ['multi-clínica'], prioridad: 3 },
  ];
  const hipotesis = [
    { id: 'h-agenda', segmentoId: 'pequena', problema: 'agenda desordenada', propuesta: 'una sola plataforma', mensaje: 'Tu clínica no debería depender de una agenda desordenada', canalSimulado: 'correo', accionEsperada: 'solicitar demo', evidencia: [], informacionFaltante: [], confianza: 'MEDIA', estado: 'ABIERTA', criterioContinuacion: 'señal positiva simulada' },
    { id: 'h-control', segmentoId: 'crecimiento', problema: 'falta de visibilidad', propuesta: 'visibilidad integrada', mensaje: 'Conoce qué ocurre en tu clínica sin planillas aisladas', canalSimulado: 'correo', accionEsperada: 'solicitar demo', evidencia: [], informacionFaltante: [], confianza: 'MEDIA', estado: 'ABIERTA', criterioContinuacion: 'señal positiva simulada' },
    { id: 'h-crecer', segmentoId: 'multisede', problema: 'pérdida de control al crecer', propuesta: 'operación multi-sede', mensaje: 'Crece sin perder control sobre la operación', canalSimulado: 'correo', accionEsperada: 'solicitar demo', evidencia: [], informacionFaltante: [], confianza: 'MEDIA', estado: 'ABIERTA', criterioContinuacion: 'señal positiva simulada' },
  ];
  for (const s of segmentos) await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/${PROG}/segmentos`, headers: H, payload: s });
  for (const h of hipotesis) await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/${PROG}/hipotesis`, headers: H, payload: h });

  const campanias = [
    { nombre: 'Agenda bajo control', segmentoId: 'pequena', hipotesisId: 'h-agenda', publico: 'clínicas pequeñas', propuesta: 'orden de agenda', mensaje: 'Agenda bajo control', canal: 'correo', presupuestoSimulado: 120000, duracionHipotetica: '14 días' },
    { nombre: 'Control administrativo', segmentoId: 'crecimiento', hipotesisId: 'h-control', publico: 'clínicas en crecimiento', propuesta: 'control administrativo', mensaje: 'Control administrativo', canal: 'correo', presupuestoSimulado: 100000, duracionHipotetica: '14 días' },
    { nombre: 'Crecimiento multi-clínica', segmentoId: 'multisede', hipotesisId: 'h-crecer', publico: 'centros multi-sede', propuesta: 'crecer con control', mensaje: 'Crecimiento multi-clínica', canal: 'correo', presupuestoSimulado: 80000, duracionHipotetica: '14 días' },
  ];
  for (let i = 0; i < campanias.length; i++) {
    await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/${PROG}/campanias`, headers: H, payload: campanias[i] });
    const campaignId = `${PROG}-c${i + 1}`;
    // 3 piezas por campaña (anuncio corto, publicación educativa, correo).
    for (const cuerpo of ['Anuncio corto simulado.', 'Publicación educativa simulada.', 'Correo comercial simulado.']) {
      await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/${PROG}/contenidos`, headers: H, payload: { campaignId, contenido: { canal: 'correo', cuerpo, marcaId: 'smileflow', productoServicio: 'software de gestión dental', llamadaAccion: 'Solicita una demostración', idioma: 'es' } } });
    }
  }
  await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/${PROG}/listo`, headers: H, payload: {} });
}

/** Crea un programa mínimo pero ejecutable (1 segmento / 1 hipótesis / 1 campaña / 1 contenido). */
async function programaMinimo(app: App, org: string, prog: string): Promise<void> {
  await app.inject({ method: 'POST', url: BASE, headers: H, payload: { org, negocio: { nombre: org, descripcion: '', industria: '', pais: 'CL', moneda: 'CLP', zonaHoraria: 'UTC' } } });
  await app.inject({ method: 'POST', url: `${BASE}/${org}/programas`, headers: H, payload: { programaId: prog, nombre: prog, objetivoPrincipal: 'o', presupuestoTotalSimulado: 100000 } });
  await app.inject({ method: 'POST', url: `${BASE}/${org}/programas/${prog}/segmentos`, headers: H, payload: { id: 's1', nombre: 'S1', descripcion: '', problemas: [], necesidades: [], criterios: [], prioridad: 1 } });
  await app.inject({ method: 'POST', url: `${BASE}/${org}/programas/${prog}/hipotesis`, headers: H, payload: { id: 'h1', segmentoId: 's1', problema: 'p', propuesta: 'x', mensaje: 'm', canalSimulado: 'correo', accionEsperada: 'a', evidencia: [], informacionFaltante: [], confianza: 'MEDIA', estado: 'ABIERTA', criterioContinuacion: 'c' } });
  await app.inject({ method: 'POST', url: `${BASE}/${org}/programas/${prog}/campanias`, headers: H, payload: { nombre: 'C', segmentoId: 's1', hipotesisId: 'h1', publico: 'x', propuesta: 'y', mensaje: 'z', canal: 'correo', presupuestoSimulado: 50000, duracionHipotetica: '14d' } });
  await app.inject({ method: 'POST', url: `${BASE}/${org}/programas/${prog}/contenidos`, headers: H, payload: { campaignId: `${prog}-c1`, contenido: { canal: 'correo', cuerpo: 'x', marcaId: 'm', productoServicio: 'p', llamadaAccion: 'cta', idioma: 'es' } } });
  await app.inject({ method: 'POST', url: `${BASE}/${org}/programas/${prog}/listo`, headers: H, payload: {} });
}

describe('Director Autónomo · Programas · PAUSA por organización (V1)', () => {
  it('la respuesta de pausa/reanudación declara alcance=ORGANIZACION (no por programa)', async () => {
    const app = makeApp();
    await programaMinimo(app, 'org-1', 'pA');
    const pausa = await app.inject({ method: 'POST', url: `${BASE}/org-1/programas/pA/pausar`, headers: H, payload: { motivo: 't' } });
    expect(pausa.statusCode).toBe(201);
    const b = pausa.json();
    expect(b.alcance).toBe('ORGANIZACION');
    expect(b.organizacionId).toBe('org-1');
    expect(b.programaSolicitadoId).toBe('pA');
    expect(b.estadoAutonomia).toBe('PAUSADA');
    expect(b.alcance).not.toBe('PROGRAMA'); // no puede leerse como exclusivo del programa
    expect(b.programaPausado).toBeUndefined();
  });

  it('pausar desde un programa detiene TODOS los programas de la organización; reanudar los libera', async () => {
    const app = makeApp();
    await programaMinimo(app, 'org-1', 'pA');
    await programaMinimo(app, 'org-1', 'pB');
    // Pausa solicitada desde pA → afecta a toda org-1.
    const pausa = await app.inject({ method: 'POST', url: `${BASE}/org-1/programas/pA/pausar`, headers: H, payload: {} });
    expect(pausa.json().alcance).toBe('ORGANIZACION');
    // Ambos programas quedan bloqueados (422).
    expect((await app.inject({ method: 'POST', url: `${BASE}/org-1/programas/pA/ejecutar-ciclo`, headers: H, payload: {} })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: `${BASE}/org-1/programas/pB/ejecutar-ciclo`, headers: H, payload: {} })).statusCode).toBe(422);
    // Reanudar desde pB → libera toda org-1.
    const reanuda = await app.inject({ method: 'POST', url: `${BASE}/org-1/programas/pB/reanudar`, headers: H, payload: { actorHumano: 'humano' } });
    expect(reanuda.json().alcance).toBe('ORGANIZACION');
    expect(reanuda.json().estadoAutonomia).toBe('ACTIVA');
    expect((await app.inject({ method: 'POST', url: `${BASE}/org-1/programas/pA/ejecutar-ciclo`, headers: H, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `${BASE}/org-1/programas/pB/ejecutar-ciclo`, headers: H, payload: {} })).statusCode).toBe(201);
  });

  it('aislamiento entre organizaciones: pausar org-A no bloquea org-B', async () => {
    const app = makeApp();
    await programaMinimo(app, 'org-A', 'p');
    await programaMinimo(app, 'org-B', 'p');
    await app.inject({ method: 'POST', url: `${BASE}/org-A/programas/p/pausar`, headers: H, payload: {} });
    expect((await app.inject({ method: 'POST', url: `${BASE}/org-A/programas/p/ejecutar-ciclo`, headers: H, payload: {} })).statusCode).toBe(422); // A bloqueada
    expect((await app.inject({ method: 'POST', url: `${BASE}/org-B/programas/p/ejecutar-ciclo`, headers: H, payload: {} })).statusCode).toBe(201); // B ejecutable
  });
});

describe('Director Autónomo · Programas · caso SmileFlow (simulado)', () => {
  it('configura el programa completo (3 segmentos / 3 hipótesis / 3 campañas / 3 piezas c/u, 300k simulado)', async () => {
    const app = makeApp();
    await configurarSmileFlow(app);
    const res = await app.inject({ method: 'GET', url: `${BASE}/${ORG}/programas/${PROG}` });
    expect(res.statusCode).toBe(200);
    const v = res.json();
    expect(v.estadoPrograma).toBe('LISTO');
    expect(v.segmentos).toHaveLength(3);
    expect(v.campanias).toHaveLength(3);
    expect(v.presupuesto.totalSimulado).toBe(300000);
    expect(v.presupuesto.comprometidoSimulado).toBe(300000);
    expect(v.campanias.every((c: { contenidos: unknown[] }) => c.contenidos.length === 3)).toBe(true);
    expect(v.modoEjecucion).toBe('PILOT');
  });

  it('ejecuta el ciclo SIMULADO: cada campaña con ejecuciones simuladas y ROI SIMULADO (nunca REAL)', async () => {
    const app = makeApp();
    await configurarSmileFlow(app);
    const run = await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/${PROG}/ejecutar-ciclo`, headers: H, payload: {} });
    expect(run.statusCode).toBe(201);
    const v = run.json();
    expect(v.estadoPrograma).toBe('EVALUADO');
    for (const c of v.campanias) {
      expect(c.ejecuciones.length).toBe(3);
      expect(c.ejecuciones.every((e: { naturaleza: string }) => e.naturaleza === 'SIMULADO')).toBe(true);
      expect(c.roi.clasificacion).toBe('SIMULADO');
      expect(c.roi.naturaleza).not.toBe('REAL');
    }
    expect(v.aprendizajes.length).toBe(1);
    expect(v.avisos.some((a: string) => a.includes('No se realiza gasto real'))).toBe(true);
  });

  it('idempotencia: ejecutar el ciclo dos veces no duplica ejecuciones', async () => {
    const app = makeApp();
    await configurarSmileFlow(app);
    await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/${PROG}/ejecutar-ciclo`, headers: H, payload: {} });
    const dos = await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/${PROG}/ejecutar-ciclo`, headers: H, payload: {} });
    expect(dos.statusCode).toBe(201);
    const v = dos.json();
    const total = v.campanias.reduce((s: number, c: { ejecuciones: unknown[] }) => s + c.ejecuciones.length, 0);
    expect(total).toBe(9); // 3 campañas x 3 piezas, una sola vez
  });

  it('modo seguro: ejecutar el ciclo en PAUSA devuelve 422 gobernado', async () => {
    const app = makeApp();
    await configurarSmileFlow(app);
    await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/${PROG}/pausar`, headers: H, payload: { motivo: 'test' } });
    const res = await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/${PROG}/ejecutar-ciclo`, headers: H, payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('AutonomiaInvalidaError');
  });

  it('presupuesto: una campaña que excede el total simulado se rechaza (422)', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: BASE, headers: H, payload: { org: ORG, negocio: { nombre: 'SmileFlow', descripcion: '', industria: '', pais: 'CL', moneda: 'CLP', zonaHoraria: 'America/Santiago' } } });
    await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas`, headers: H, payload: { programaId: 'p2', nombre: 'P2', objetivoPrincipal: 'o', presupuestoTotalSimulado: 100000 } });
    await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/p2/segmentos`, headers: H, payload: { id: 'a', nombre: 'A', descripcion: '', problemas: [], necesidades: [], criterios: [], prioridad: 1 } });
    await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/p2/hipotesis`, headers: H, payload: { id: 'h1', segmentoId: 'a', problema: 'x', propuesta: 'y', mensaje: 'z', canalSimulado: 'correo', accionEsperada: 'demo', evidencia: [], informacionFaltante: [], confianza: 'MEDIA', estado: 'ABIERTA', criterioContinuacion: 'c' } });
    const res = await app.inject({ method: 'POST', url: `${BASE}/${ORG}/programas/p2/campanias`, headers: H, payload: { nombre: 'C', segmentoId: 'a', hipotesisId: 'h1', publico: 'x', propuesta: 'y', mensaje: 'z', canal: 'correo', presupuestoSimulado: 200000, duracionHipotetica: '14d' } });
    expect(res.statusCode).toBe(422);
  });

  it('aislamiento: el programa de SmileFlow no aparece en otra organización', async () => {
    const app = makeApp();
    await configurarSmileFlow(app);
    const otra = await app.inject({ method: 'GET', url: `${BASE}/otra-org/programas/${PROG}` });
    expect(otra.statusCode).toBe(404);
  });
});
