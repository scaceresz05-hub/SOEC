/**
 * ATRIBUCIÓN FIRST-PARTY — saber de qué anuncio vino un WhatsApp, sin decirle a Google que fue una conversión.
 *
 * El piloto de CP necesita responder «de estos clics, ¿cuántos acabaron en alguien escribiendo?». Eso se puede
 * medir internamente. Lo que NO se puede es presentarlo como si Google estuviera optimizando por contactos:
 * Google no recibe nada. Estas pruebas fijan las dos mitades —lo que se puede afirmar y lo que no— y, sobre
 * todo, los cuatro modos de NO saber, que son los que un sistema honesto tiene que distinguir.
 */
import { describe, expect, it, vi } from 'vitest';
import { atribuirIntencion, gclidValido, type ClicObservado } from '../src/atribucion/atribucion-click';
import { consultaDeClicsDe, consultaDeClicView } from '../src/atribucion/atribucion-composicion';
import { DIAS_MAXIMOS_CLICK_VIEW } from '../src/atribucion/atribucion-tipos';
import { GoogleSearchError, type GoogleAdsMutateHttpClient } from '../src/campana/google-ads-mutate-http';

const AHORA = '2026-09-27T12:00:00.000Z';
const GCLID = 'EAIaIQobChMI1234567890abcdefg';

const clic = (over: Partial<ClicObservado> = {}): ClicObservado => ({
  gclid: GCLID, campaignId: '111', campaignName: 'CP · búsqueda', adGroupId: '222', adGroupName: 'clínica dental',
  keyword: 'dentista curico', matchType: 'PHRASE', device: 'MOBILE', fecha: '2026-09-27', ...over,
});

describe('validar el identificador de clic antes de usarlo', () => {
  it('acepta un gclid con forma de gclid', () => {
    expect(gclidValido(GCLID)).toBe(true);
  });

  it('rechaza lo que viene de la barra de direcciones de cualquiera', () => {
    for (const malo of ['', '  ', 'corto', null, undefined, 'a'.repeat(300), "x' or 1=1--", '<script>', 'con espacio']) {
      expect(gclidValido(malo), `«${String(malo)}» no puede tratarse como identificador`).toBe(false);
    }
  });
});

describe('los cinco desenlaces de intentar atribuir', () => {
  it('ATTRIBUTED: la plataforma devuelve ese clic y se guarda de dónde vino', async () => {
    const consultar = vi.fn(async () => [clic()]);
    const r = await atribuirIntencion({ gclid: GCLID, eventTimestamp: '2026-09-27T11:00:00.000Z' }, consultar, AHORA);
    expect(r.estado).toBe('ATTRIBUTED');
    expect(r.clic?.campaignId).toBe('111');
    expect(r.clic?.keyword).toBe('dentista curico');
    expect(consultar).toHaveBeenCalledTimes(1); // se encontró el primer día: no se gasta una segunda consulta
  });

  it('GCLID_NOT_FOUND: respondió y no lo conoce — no se busca «el más parecido»', async () => {
    const otro = clic({ gclid: 'OTRO-GCLID-DISTINTO-1234567' });
    const r = await atribuirIntencion({ gclid: GCLID, eventTimestamp: '2026-09-27T11:00:00.000Z' }, async () => [otro], AHORA);
    expect(r.estado).toBe('GCLID_NOT_FOUND');
    expect(r.clic).toBeNull();
  });

  it('NO_GCLID: la intención no venía de un anuncio', async () => {
    const consultar = vi.fn(async () => [clic()]);
    const r = await atribuirIntencion({ gclid: null, eventTimestamp: '2026-09-27T11:00:00.000Z' }, consultar, AHORA);
    expect(r.estado).toBe('NO_GCLID');
    expect(consultar, 'sin identificador no hay nada que preguntar').not.toHaveBeenCalled();
  });

  it('PROVIDER_UNAVAILABLE: no se pudo preguntar — y eso NO es «no atribuido»', async () => {
    const r = await atribuirIntencion({ gclid: GCLID, eventTimestamp: '2026-09-27T11:00:00.000Z' }, async () => null, AHORA);
    expect(r.estado).toBe('PROVIDER_UNAVAILABLE');
    expect(r.motivo).toMatch(/no se da por no atribuido/i);
  });

  it('EXPIRED_LOOKBACK: más viejo que la ventana que Google permite consultar', async () => {
    const consultar = vi.fn(async () => [clic()]);
    const viejo = new Date(Date.parse(AHORA) - (DIAS_MAXIMOS_CLICK_VIEW + 5) * 86_400_000).toISOString();
    const r = await atribuirIntencion({ gclid: GCLID, eventTimestamp: viejo }, consultar, AHORA);
    expect(r.estado).toBe('EXPIRED_LOOKBACK');
    expect(consultar, 'no se gasta cuota preguntando por algo que la plataforma ya no responde').not.toHaveBeenCalled();
  });
});

describe('la medianoche no puede perder una atribución', () => {
  it('consulta también el día anterior cuando el clic cae justo antes de medianoche', async () => {
    const dias: string[] = [];
    const consultar = vi.fn(async (_g: string, fecha: string) => {
      dias.push(fecha);
      return fecha === '2026-09-26' ? [clic({ fecha: '2026-09-26' })] : [];
    });
    const r = await atribuirIntencion({ gclid: GCLID, eventTimestamp: '2026-09-27T00:05:00.000Z' }, consultar, AHORA);
    expect(dias).toEqual(['2026-09-27', '2026-09-26']);
    expect(r.estado).toBe('ATTRIBUTED');
    expect(r.clic?.fecha).toBe('2026-09-26');
  });

  it('un fallo en un día y silencio en el otro NO se resuelve como «no encontrado»', async () => {
    const consultar = async (_g: string, fecha: string) => (fecha === '2026-09-27' ? null : []);
    const r = await atribuirIntencion({ gclid: GCLID, eventTimestamp: '2026-09-27T00:05:00.000Z' }, consultar, AHORA);
    expect(r.estado).toBe('PROVIDER_UNAVAILABLE');
  });
});

describe('la consulta que se le manda a Google', () => {
  it('filtra UN solo día y el identificador exacto, como exige la plataforma', () => {
    const q = consultaDeClicView(GCLID, '2026-09-27');
    expect(q).toContain("segments.date = '2026-09-27'");
    expect(q).toContain(`click_view.gclid = '${GCLID}'`);
    expect(q).toContain('from click_view');
  });

  it('un identificador con caracteres raros no puede alterar la consulta', () => {
    const q = consultaDeClicView("abc' or '1'='1", '2026-09-27');
    expect(q).not.toContain("or '1'='1");
    expect(q).toContain("click_view.gclid = 'abcor11'");
  });

  it('un error del proveedor se convierte en null, no en una lista vacía', async () => {
    const cliente = {
      buscar: vi.fn(async () => {
        throw new GoogleSearchError({ httpStatus: 429, requestId: null, status: 'RESOURCE_EXHAUSTED', code: 'quotaError:RESOURCE_EXHAUSTED', message: null, errorPath: null, fieldPathElements: [], cuerpoResumen: null });
      }),
    } as unknown as Pick<GoogleAdsMutateHttpClient, 'buscar'>;
    const consultar = consultaDeClicsDe(cliente, '8303175180');
    expect(await consultar(GCLID, '2026-09-27')).toBeNull();
  });

  it('cada organización consulta con SU cuenta', async () => {
    const cuentas: string[] = [];
    const cliente = { buscar: vi.fn(async (cid: string) => { cuentas.push(cid); return []; }) } as unknown as Pick<GoogleAdsMutateHttpClient, 'buscar'>;
    await consultaDeClicsDe(cliente, '1111111111')(GCLID, '2026-09-27');
    await consultaDeClicsDe(cliente, '2222222222')(GCLID, '2026-09-27');
    expect(cuentas).toEqual(['1111111111', '2222222222']);
  });
});
