/**
 * MANDATO FINANCIERO INDEPENDIENTE — lo que autoriza una persona, y lo que NO autoriza.
 *
 * El riesgo que estas pruebas cierran no es un bug de cálculo: es que «autorizar dinero» se confunda con
 * «encender el sistema». Aquí se demuestra que son cosas distintas y que la autorización manda sobre lo que
 * viene después:
 *
 *   · un mandato con las capacidades apagadas no ejecuta nada;
 *   · un sobre de ejecución no puede pedir más de lo autorizado, ni en otra moneda, ni de otro canal;
 *   · un tope diario es un tope: no se supera «porque queda saldo del total»;
 *   · y no hay dos cifras financieras: el tope diario vive en el mismo mandato que el total.
 */
import { describe, expect, it } from 'vitest';
import { AutorizacionInvalidaError, crearMandatoAutorizado, type EntradaMandato, type Mandato } from '../src/accion/mandato';
import { mandatoVigente, presupuestoAutorizado, puedeEjecutarGasto, verificarContraMandato } from '../src/accion/mandato-financiero';
import { presupuestoDiarioDe } from '../src/ejecucion/paquete';
import type { PlanCampania } from '../src/investigacion/plan-pg';

const DIA = 86_400_000;
const AHORA_MS = Date.parse('2026-09-25T12:00:00.000Z');
const AHORA = new Date(AHORA_MS).toISOString();
const iso = (ms: number): string => new Date(ms).toISOString();

/** La autorización REAL de CP: 30.000 CLP en total, 2.500 al día, en Google Ads. */
const entrada = (over: Partial<EntradaMandato> = {}): EntradaMandato => ({
  organizationId: 'org-cp-odontologia',
  objective: 'presupuesto autorizado por la persona responsable del negocio',
  currency: 'CLP',
  provider: 'GOOGLE_ADS',
  authorizedBudgetMinor: 30_000,
  dailyCapMinor: 2_500,
  periodStart: iso(AHORA_MS - DIA),
  periodEnd: iso(AHORA_MS + 30 * DIA),
  allowedMetaAssets: [],
  allowedActionTypes: ['CREATE_CAMPAIGN'],
  ...over,
});
const mandato = (over: Partial<EntradaMandato> = {}): Mandato => crearMandatoAutorizado(entrada(over), 'duena@clinica.cl', 'mandato:qa', AHORA);

describe('la autorización se guarda tal como la escribió la persona', () => {
  it('30.000 en total y 2.500 al día, en CLP y para Google Ads', () => {
    const m = mandato();
    expect(m.authorizedBudgetMinor).toBe(30_000);
    expect(m.dailyCapMinor).toBe(2_500);
    expect(m.currency).toBe('CLP');
    expect(m.provider).toBe('GOOGLE_ADS');
    expect(m.authorizedBy).toBe('duena@clinica.cl');
    expect(m.spentMinor).toBe(0);
  });

  it('un tope diario mayor que el total es una contradicción, no una autorización', () => {
    expect(() => mandato({ dailyCapMinor: 50_000 })).toThrow(AutorizacionInvalidaError);
  });

  it('cero, negativo y fraccionario no son topes', () => {
    for (const v of [0, -1, 2_500.5]) expect(() => mandato({ dailyCapMinor: v })).toThrow(AutorizacionInvalidaError);
    for (const v of [0, -1]) expect(() => mandato({ authorizedBudgetMinor: v })).toThrow(AutorizacionInvalidaError);
  });

  it('sin tope diario declarado queda null: no se inventa uno', () => {
    expect(mandato({ dailyCapMinor: null }).dailyCapMinor).toBeNull();
    const sinCampo: EntradaMandato = { ...entrada(), dailyCapMinor: undefined };
    expect(crearMandatoAutorizado(sinCampo, 'duena@clinica.cl', 'm', AHORA).dailyCapMinor).toBeNull();
  });

  it('SOEC no puede autorizarse dinero a sí mismo', () => {
    for (const actor of ['soec', 'director', 'scheduler', 'sistema', '']) {
      expect(() => crearMandatoAutorizado(entrada(), actor, 'm', AHORA)).toThrow(AutorizacionInvalidaError);
    }
  });

  it('un canal desconocido se rechaza en vez de guardarse «por si acaso»', () => {
    expect(() => crearMandatoAutorizado({ ...entrada(), provider: 'TIKTOK' as never }, 'duena@clinica.cl', 'm', AHORA)).toThrow(AutorizacionInvalidaError);
  });
});

describe('el mandato manda sobre el sobre de ejecución', () => {
  const pedido = (over: Partial<{ currency: string; totalMayor: number; diarioMayor: number | null; canal: 'GOOGLE_ADS' | 'META_ADS' }> = {}) =>
    ({ currency: 'CLP', totalMayor: 30_000, canal: 'GOOGLE_ADS' as const, ...over });

  it('sin autorización financiera no hay sobre que valga', () => {
    expect(verificarContraMandato(null, pedido(), AHORA)).toEqual({ ok: false, motivo: 'SIN_MANDATO' });
  });

  it('un sobre por el importe exacto autorizado pasa', () => {
    expect(verificarContraMandato(mandato(), pedido(), AHORA).ok).toBe(true);
  });

  it('un peso más que lo autorizado no pasa', () => {
    expect(verificarContraMandato(mandato(), pedido({ totalMayor: 30_001 }), AHORA)).toEqual({ ok: false, motivo: 'TOTAL_SUPERA_EL_MANDATO' });
  });

  it('el tope diario también manda: 2.501 al día no pasa aunque el total aguante', () => {
    expect(verificarContraMandato(mandato(), pedido({ diarioMayor: 2_501 }), AHORA)).toEqual({ ok: false, motivo: 'DIARIO_SUPERA_EL_MANDATO' });
    expect(verificarContraMandato(mandato(), pedido({ diarioMayor: 2_500 }), AHORA).ok).toBe(true);
  });

  it('otra moneda no se convierte ni se compara: se rechaza', () => {
    expect(verificarContraMandato(mandato(), pedido({ currency: 'USD' }), AHORA)).toEqual({ ok: false, motivo: 'MONEDA_DISTINTA' });
    expect(verificarContraMandato(mandato(), pedido({ currency: 'pesos' }), AHORA)).toEqual({ ok: false, motivo: 'MONEDA_DISTINTA' });
  });

  it('autorizar Google Ads no autoriza Meta', () => {
    expect(verificarContraMandato(mandato(), pedido({ canal: 'META_ADS' }), AHORA)).toEqual({ ok: false, motivo: 'CANAL_NO_AUTORIZADO' });
    // Un mandato antiguo sin canal escrito no habilita ninguno (fail-closed).
    expect(verificarContraMandato(mandato({ provider: null }), pedido(), AHORA)).toEqual({ ok: false, motivo: 'CANAL_NO_AUTORIZADO' });
  });

  it('una autorización vencida, revocada o agotada deja de respaldar gasto', () => {
    const vencido = mandato({ periodStart: iso(AHORA_MS - 40 * DIA), periodEnd: iso(AHORA_MS - DIA) });
    expect(verificarContraMandato(vencido, pedido(), AHORA)).toEqual({ ok: false, motivo: 'MANDATO_NO_VIGENTE' });
    expect(mandatoVigente({ ...mandato(), status: 'REVOKED' }, AHORA)).toBe(false);
    expect(mandatoVigente({ ...mandato(), spentMinor: 30_000 }, AHORA)).toBe(false);
    expect(mandatoVigente({ ...mandato(), killSwitch: true }, AHORA)).toBe(false);
  });

  it('el sobre no se recorta en silencio hasta que quepa: se dice que no', () => {
    const v = verificarContraMandato(mandato(), pedido({ totalMayor: 1_000_000 }), AHORA);
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe('TOTAL_SUPERA_EL_MANDATO');
  });
});

describe('autorizar dinero no enciende nada', () => {
  const llaves = { mandato: mandato(), escrituraAds: false, autonomiaAds: false, canal: 'GOOGLE_ADS' as const, autonoma: false };

  it('con mandato vigente y permisos apagados, no se ejecuta gasto', () => {
    expect(puedeEjecutarGasto(llaves, 'CLP', AHORA)).toEqual({ ok: false, motivo: 'SIN_PERMISO_DE_ESCRITURA' });
  });

  it('con permiso de escritura ya se puede ejecutar de forma supervisada, pero no sin preguntar', () => {
    expect(puedeEjecutarGasto({ ...llaves, escrituraAds: true }, 'CLP', AHORA).ok).toBe(true);
    expect(puedeEjecutarGasto({ ...llaves, escrituraAds: true, autonoma: true }, 'CLP', AHORA)).toEqual({ ok: false, motivo: 'SIN_AUTONOMIA' });
    expect(puedeEjecutarGasto({ ...llaves, escrituraAds: true, autonomiaAds: true, autonoma: true }, 'CLP', AHORA).ok).toBe(true);
  });

  it('con las dos capacidades encendidas y sin mandato, tampoco se gasta', () => {
    expect(puedeEjecutarGasto({ ...llaves, mandato: null, escrituraAds: true, autonomiaAds: true }, 'CLP', AHORA)).toEqual({ ok: false, motivo: 'SIN_MANDATO' });
  });
});

describe('el tope diario llega hasta la plataforma', () => {
  const plan = (propuestoDiario: number | null): PlanCampania => ({ presupuesto: { propuestoDiarioClp: propuestoDiario }, puja: { techoCpcClp: null } } as unknown as PlanCampania);

  it('manda el menor entre el tope diario y el reparto del total', () => {
    // 30.000 repartidos en los días del período dan menos que 2.500 ⇒ manda el reparto.
    const conCap = presupuestoDiarioDe(plan(null), mandato());
    expect(conCap.clp).toBeLessThanOrEqual(2_500);
    // Con un total holgado, el que frena es el tope diario: 2.500, y no el reparto.
    const holgado = presupuestoDiarioDe(plan(null), mandato({ authorizedBudgetMinor: 300_000 }));
    expect(holgado.clp).toBe(2_500);
  });

  it('un plan que pide más que el tope diario no lo consigue', () => {
    const r = presupuestoDiarioDe(plan(9_000), mandato({ authorizedBudgetMinor: 300_000 }));
    expect(r.clp).toBe(2_500);
    expect(r.origen).toBe('MANDATO');
  });

  it('sin tope diario autorizado sigue mandando el total, como antes', () => {
    const r = presupuestoDiarioDe(plan(null), mandato({ dailyCapMinor: null, authorizedBudgetMinor: 300_000 }));
    expect(r.clp).toBeGreaterThan(2_500);
  });
});

describe('lo que ve la persona', () => {
  it('habla en pesos y no menciona el mecanismo', () => {
    const p = presupuestoAutorizado(mandato(), AHORA);
    expect(p).not.toBeNull();
    expect(p!.moneda).toBe('CLP');
    expect(p!.totalMaximo).toBe(30_000);
    expect(p!.maximoDiario).toBe(2_500);
    expect(p!.disponible).toBe(30_000);
    expect(p!.vigente).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/micros|envelope|sobre|MCC|customerId/i);
  });

  it('sin autorización se dice que no hay ninguna, no un cero que parece un límite', () => {
    expect(presupuestoAutorizado(null, AHORA)).toBeNull();
  });

  it('en una moneda con decimales los importes se muestran en unidades mayores', () => {
    const m = mandato({ currency: 'USD', authorizedBudgetMinor: 30_000, dailyCapMinor: 2_500 });
    const p = presupuestoAutorizado(m, AHORA)!;
    expect(p!.totalMaximo).toBe(300);
    expect(p!.maximoDiario).toBe(25);
  });

  it('el gasto ya comprometido se descuenta de lo disponible', () => {
    const p = presupuestoAutorizado({ ...mandato(), spentMinor: 12_000 }, AHORA)!;
    expect(p!.gastado).toBe(12_000);
    expect(p!.disponible).toBe(18_000);
  });
});
