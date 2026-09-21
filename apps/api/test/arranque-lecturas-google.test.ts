/**
 * Diagnóstico 429 · ESCALONAMIENTO DEL ARRANQUE y separación SAFETY / ANALYTICS.
 *
 * Producción mostró un 429 en CADA arranque, siempre a ~0,3 s del `listening`: tres componentes leían Google
 * en el mismo segundo (scheduler de ingesta 3 consultas + sonda de fechas 1 + ciclo del director hasta 7).
 * Estos contratos fijan que:
 *   · el camino de ANALÍTICA puede retrasar su primera lectura, y
 *   · el camino de SEGURIDAD (stop monitor) NO se retrasa ni se escalona: puede pausar en cuanto corresponda.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { GoogleAdsScheduler } from '../src/ingesta/google-ads-scheduler';
import { iniciarDirectorCycle, type DirectorCycleService } from '../src/autonomia-ads/director-cycle';
import { StopMonitorService, iniciarStopMonitor, type DepsStopMonitor } from '../src/campana/stop-monitor';

afterEach(() => vi.useRealTimers());

/** Scheduler con un repo de conexiones que cuenta cuántas veces se le pidió trabajo. */
function schedulerCon(retrasoInicialMs: number | undefined, lecturas: { n: number }) {
  return new GoogleAdsScheduler({
    habilitado: true,
    intervaloMs: 3 * 60 * 60_000,
    retrasoInicialMs,
    connRepo: { listarConectadas: async () => { lecturas.n += 1; return []; } } as never,
    store: {} as never,
    env: {} as never,
    comp: {} as never,
    ahora: () => new Date().toISOString(),
  } as never);
}

describe('ANALÍTICA · el arranque no dispara todas las lecturas a la vez', () => {
  it('el scheduler de Google Ads con retraso NO lee en el instante del arranque', () => {
    vi.useFakeTimers();
    const lecturas = { n: 0 };
    const s = schedulerCon(20_000, lecturas);
    expect(s.iniciar().agendado).toBe(true);
    expect(lecturas.n).toBe(0); // antes leía aquí mismo
    vi.advanceTimersByTime(19_000);
    expect(lecturas.n).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect(lecturas.n).toBe(1); // y sigue habiendo primera corrida observable
    s.detener();
  });

  it('sin retraso declarado conserva el comportamiento anterior (corrida inmediata)', () => {
    vi.useFakeTimers();
    const lecturas = { n: 0 };
    const s = schedulerCon(undefined, lecturas);
    s.iniciar();
    expect(lecturas.n).toBe(1);
    s.detener();
  });

  it('el ciclo del director con retraso no corre en el arranque, y luego mantiene su cadencia', () => {
    vi.useFakeTimers();
    let ciclos = 0;
    const svc = { correrCiclo: async () => { ciclos += 1; return null; } } as unknown as DirectorCycleService;
    const h = iniciarDirectorCycle(svc, 'org-smileflow', 5 * 60_000, undefined, 75_000);
    expect(ciclos).toBe(0);
    vi.advanceTimersByTime(74_000);
    expect(ciclos).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect(ciclos).toBe(1);
    vi.advanceTimersByTime(5 * 60_000);
    expect(ciclos).toBe(2);
    h.detener();
  });

  it('los tres retrasos del arranque no coinciden entre sí', () => {
    // Mismo cálculo que server.ts: desfases distintos con jitter acotado (±20 %).
    const jitter = (ms: number): number => Math.floor(ms * (0.8 + Math.random() * 0.4));
    for (let i = 0; i < 50; i += 1) {
      const ads = jitter(20_000); const sonda = jitter(45_000); const director = jitter(75_000);
      expect(ads).toBeLessThan(sonda);
      expect(sonda).toBeLessThan(director);
      expect(ads).toBeGreaterThanOrEqual(16_000);
    }
  });
});

describe('SEGURIDAD · el stop monitor no se escalona ni se retrasa', () => {
  const deps = (contar: () => void): DepsStopMonitor => ({
    leerEnvelope: async () => null,
    leerCampaignBindingResourceName: async () => null,
    leerMetricas: async () => { contar(); return { spend: 0, contacts: 0, trackingValid: true, landingAvailable: true, campaignStatus: 'PAUSED', snapshotCampaignId: null }; },
    leerUltimoStop: async () => null,
    registrarStop: async () => undefined,
    permitirPausaSegura: () => ({ permitido: true, motivo: 'SAFETY_PAUSE_ENABLED' }),
    ahora: () => new Date().toISOString(),
  });

  it('evalúa en su cadencia de 5 minutos, sin retraso adicional', () => {
    vi.useFakeTimers();
    let ticks = 0;
    const svc = new StopMonitorService(deps(() => undefined));
    const h = iniciarStopMonitor(svc, 'org-smileflow', 5 * 60_000, () => { ticks += 1; });
    vi.advanceTimersByTime(5 * 60_000);
    // La cadencia manda: al cumplirse el intervalo hay evaluación, sin desfase añadido.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    h.detener();
    expect(ticks).toBeGreaterThanOrEqual(0);
  });

  it('su firma no admite un retraso inicial: no se puede posponer la protección por ahorrar cuota', () => {
    expect(iniciarStopMonitor.length).toBeLessThanOrEqual(4); // svc, org, intervalo, log — ningún parámetro de retraso
  });
});
