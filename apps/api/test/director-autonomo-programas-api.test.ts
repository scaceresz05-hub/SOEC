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
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), clock: new FixedClock(new Date('2026-08-01T12:00:00.000Z')) });
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
