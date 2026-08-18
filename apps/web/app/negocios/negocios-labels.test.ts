/**
 * Regresión de etiquetado Google Ads en /negocios: se elimina la etiqueta ambigua "acumulado reciente" y se
 * usa trazabilidad real (fuente + período histórico + capturedAt/STALE via LineaAds).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(resolve(AQUI, 'page.tsx'), 'utf8');

describe('negocios · etiquetado Google Ads', () => {
  it('NO contiene la etiqueta ambigua "acumulado reciente"', () => {
    expect(page).not.toContain('acumulado reciente');
  });
  it('usa trazabilidad real: LineaAds con capturedAt / período / STALE', () => {
    expect(page).toContain('function LineaAds');
    expect(page).toContain('ads.capturedAt');
    expect(page).toContain('ads.period');
    expect(page).toContain('Último dato conocido');
    expect(page).toContain('histórico de la campaña');
  });
});
