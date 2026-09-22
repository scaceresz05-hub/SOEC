// @vitest-environment jsdom
/**
 * LA PANTALLA NO PONE «$» A CIEGAS.
 *
 * Los importes viajan en unidades MENORES y el servidor dice en qué moneda están. Antes, dos pantallas
 * escribían `$` y formato chileno pasara lo que pasara: un negocio que factura en dólares habría visto su
 * presupuesto etiquetado como pesos, y un «10,00» convertido en «$1.000».
 */
import { describe, expect, it } from 'vitest';
import { money } from '../lib/campana-client';

/** Misma regla que usan las pantallas de plan y director: unidades menores + moneda del servidor. */
const dinero = (v: number | null | undefined, moneda: string): string => {
  if (v === null || v === undefined) return 'sin dato';
  const decimales = moneda === 'CLP' || moneda === 'JPY' ? 0 : 2;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: moneda, maximumFractionDigits: decimales })
    .format(v / 10 ** decimales);
};

const soloDigitos = (s: string): string => s.replace(/[^0-9,.]/g, '');

describe('formato de dinero en la interfaz', () => {
  it('CLP 10.000 (unidades menores) se muestran como diez mil, no como cien', () => {
    expect(soloDigitos(dinero(10_000, 'CLP'))).toBe('10.000');
    expect(dinero(10_000, 'CLP')).toContain('$');
  });

  it('JPY 1.000 se muestran como mil', () => {
    expect(soloDigitos(dinero(1_000, 'JPY'))).toBe('1.000');
  });

  it('USD 1.000 unidades menores son 10,00 — no «mil»', () => {
    const texto = dinero(1_000, 'USD');
    expect(soloDigitos(texto)).toBe('10,00');
    expect(texto).toMatch(/US|\$/);
    expect(soloDigitos(texto)).not.toBe('1.000');
  });

  it('el mismo número en dos monedas no se muestra igual', () => {
    expect(dinero(1_000, 'USD')).not.toBe(dinero(1_000, 'CLP'));
  });

  it('sin dato no se inventa un cero', () => {
    expect(dinero(null, 'CLP')).toBe('sin dato');
  });

  it('el formateador compartido del panel de campañas ya seguía la misma regla', () => {
    expect(soloDigitos(money(1_000, 'USD'))).toBe('10,00');
    expect(soloDigitos(money(10_000, 'CLP'))).toBe('10.000');
  });
});
