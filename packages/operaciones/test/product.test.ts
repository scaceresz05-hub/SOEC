import { describe, expect, it } from 'vitest';
import type { ProductoIntelectual } from '../src/domain/product';
import { esOpaco, violaSoberania, esCausaConceptual } from '../src/domain/product';
import { abstener, baseProducto, construir } from '../src/app/product-builder';
import { attr } from './helpers';

const contexto = {
  operacion: 'orientar' as const,
  proposito: 'p',
  eceId: 'ece1',
  eceState: {} as never,
  eceCorte: { version: 1, recordedAt: null },
  objetivoElementoId: null,
  horizonte: null,
  attribution: attr,
};
const mecanismo = { nombre: 'test', version: '0' };

describe('Guardarraíles de producto intelectual', () => {
  it('violaSoberania detecta un producto vinculante', () => {
    const p = construir('detectar', baseProducto(contexto, mecanismo, { razones: ['r'] }), { deteccion: { senales: [] } });
    expect(violaSoberania(p)).toBe(false);
    const binding = { ...p, bindingDecision: true } as unknown as ProductoIntelectual;
    expect(violaSoberania(binding)).toBe(true);
  });

  it('esOpaco detecta una conclusión sin soporte', () => {
    const bueno = construir('detectar', baseProducto(contexto, mecanismo, { razones: ['porque X'] }), { deteccion: { senales: [] } });
    expect(esOpaco(bueno)).toBe(false);
    const opaco = construir('detectar', baseProducto(contexto, mecanismo, { razones: [], evidencia: [], faltante: [] }), { deteccion: { senales: [] } });
    expect(esOpaco(opaco)).toBe(true);
  });

  it('una orientación sin cuestiones de juicio humano es opaca', () => {
    const p = construir('orientar', baseProducto(contexto, mecanismo, { razones: ['r'], cuestionesJuicioHumano: [] }), {
      orientacion: { asunto: 'x', consideraciones: [], cuestionesReservadas: [], noVinculante: true },
    });
    expect(esOpaco(p)).toBe(true);
  });

  it('una abstención es comprensible (declara causa y faltante) y no opaca', () => {
    const p = abstener(contexto, mecanismo, 'evidencia_insuficiente', { faltante: ['dato X'] });
    expect(p.abstenido).toBe(true);
    expect(p.causaAbstencion).toBe('evidencia_insuficiente');
    expect(esOpaco(p)).toBe(false);
    expect(violaSoberania(p)).toBe(false);
  });

  it('clasifica las causas conceptuales frente a las técnicas', () => {
    expect(esCausaConceptual('evidencia_insuficiente')).toBe(true);
    expect(esCausaConceptual('timeout')).toBe(false);
    expect(esCausaConceptual('cancelacion')).toBe(false);
  });
});
