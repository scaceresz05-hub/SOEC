/**
 * EL IDENTIFICADOR DE CLIC, EN LA FRONTERA DE LA INGESTA.
 *
 * Un `gclid` identifica un clic de anuncio, no a una persona — pero pegado a «vio la página de implantes»
 * reconstruye lo que la regla V1 de privacidad existe para impedir: qué tratamiento consultó alguien a quien
 * se puede seguir la pista. Por eso vale la MISMA regla que para `lead_id`: puede acompañar a una intención
 * de contacto y jamás a un interés por tratamiento.
 *
 * La segunda mitad de estas pruebas fija que la atribución es una capa de APOYO: si falla, la observación ya
 * está persistida y la ingesta no se cae con ella.
 */
import { describe, expect, it } from 'vitest';
import { violacionDePrivacidadGrowth, assertPrivacidadGrowth, PrivacidadGrowthError } from '../src/ingesta/politica-privacidad-growth';
import { mapearEventoGrowth, type EventoGrowth } from '../src/ingesta/mapa-growth';

const GCLID = 'EAIaIQobChMI1234567890abcdefg';

const evento = (over: Partial<EventoGrowth> = {}): EventoGrowth => ({
  event_id: 101,
  event_name: 'whatsapp_intent',
  occurred_at: '2026-09-27T11:00:00.000Z',
  anon_id: null,
  path: null,
  utm_source: null,
  utm_campaign: null,
  value: null,
  lead_id: 4127,
  ...over,
});

describe('la regla de privacidad alcanza al identificador de clic', () => {
  it('una intención de contacto PUEDE traer gclid: es lo que permite atribuirla', () => {
    expect(violacionDePrivacidadGrowth(evento({ gclid: GCLID }))).toBeNull();
    expect(() => assertPrivacidadGrowth(evento({ gclid: GCLID }))).not.toThrow();
  });

  it('un interés por tratamiento con gclid se RECHAZA, igual que con lead_id', () => {
    const malo = evento({ event_name: 'service_viewed:implantes-dentales', lead_id: null, gclid: GCLID });
    expect(violacionDePrivacidadGrowth(malo)).toBe('INTERES_POR_SERVICIO_CON_GCLID');
    expect(() => assertPrivacidadGrowth(malo)).toThrow(PrivacidadGrowthError);
  });

  it('el mismo interés SIN gclid sigue pasando: lo que se prohíbe es la unión, no el evento', () => {
    expect(violacionDePrivacidadGrowth(evento({ event_name: 'service_viewed', lead_id: null, gclid: null }))).toBeNull();
  });

  it('un gclid vacío o en blanco no cuenta como identificador', () => {
    for (const v of ['', '   ', null, undefined]) {
      expect(violacionDePrivacidadGrowth(evento({ event_name: 'service_viewed', lead_id: null, gclid: v }))).toBeNull();
    }
  });

  it('el mensaje del rechazo no filtra el tratamiento que la regla protege', () => {
    try {
      assertPrivacidadGrowth(evento({ event_name: 'service_viewed:implantes-dentales', lead_id: null, gclid: GCLID }));
      throw new Error('debería haber lanzado');
    } catch (e) {
      const texto = e instanceof Error ? e.message : String(e);
      expect(texto).not.toContain('implantes');
      expect(texto).toContain('service_viewed');
    }
  });
});

describe('el gclid no se cuela en la observación', () => {
  /**
   * La observación mide un HECHO comercial: cuántas intenciones hubo. El identificador de clic sirve para
   * atribuir, y vive en su propia tabla. Mezclarlos metería un identificador de clic en el eje de medición,
   * donde nadie lo necesita.
   */
  it('la entrada de observación no lleva el identificador de clic', () => {
    const entrada = mapearEventoGrowth(evento({ gclid: GCLID }), 'cp-odontologia-growth');
    expect(JSON.stringify(entrada)).not.toContain(GCLID);
    expect(entrada.eventName).toBe('whatsapp_intent');
    expect(entrada.leadRef).toBe('4127');
  });

  it('una intención sin gclid se mapea exactamente igual que antes', () => {
    const conGclid = mapearEventoGrowth(evento({ gclid: GCLID }), 'p');
    const sinGclid = mapearEventoGrowth(evento({ gclid: null }), 'p');
    expect(JSON.stringify(conGclid)).toBe(JSON.stringify(sinGclid));
  });
});
