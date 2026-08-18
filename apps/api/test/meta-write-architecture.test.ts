/**
 * V2 PRE-REAL · ARQUITECTURA/seguridad del write path real (scan de fuente, obligatorio §8/§10).
 * Garantiza a nivel de CÓDIGO: el master switch se re-chequea en constructor Y en ejecutar; ningún módulo de
 * inteligencia importa el adapter real ni el transporte (no LLM→Meta directo); y el transporte no loggea.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(AQUI, '..', 'src', rel), 'utf8');

describe('write path real — master switch absoluto en código', () => {
  it('el adapter real re-chequea el master switch en constructor y en ejecutar', () => {
    const a = src('campana/meta-write-real-adapter.ts');
    // Dos guardas independientes que lanzan ModoRealBloqueadoError.
    expect(a.match(/leerMasterSwitch\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(a).toContain('ModoRealBloqueadoError');
    expect(a).toContain('if (!this.leerMasterSwitch())');
    // Exige la aprobación del Action Plane antes de tocar Meta.
    expect(a).toContain('s.guardApproved !== true');
  });

  it('la factory es fail-closed: autonomousReal!=true ⇒ dry-run', () => {
    const f = src('campana/meta-write-factory.ts');
    expect(f).toContain('if (!cfg.autonomousReal)');
    expect(f).toContain('MetaWriteDryRunAdapter');
    expect(f).toContain('fail-closed');
  });
});

describe('write path real — inteligencia no llama a Meta directo', () => {
  const inteligencia = [
    'campana/content-engine.ts', 'campana/content-policy.ts', 'campana/campaign-plan.ts',
    'autonomia/decision-engine.ts', 'autonomia/optimization-engine.ts', 'autonomia/performance.ts',
  ];
  it('ningún módulo de inteligencia importa el adapter real ni el transporte', () => {
    for (const m of inteligencia) {
      const s = src(m);
      expect(s).not.toContain('meta-write-real-adapter');
      expect(s).not.toContain('meta-write-transport');
      expect(s).not.toContain('RealGraphWriteTransport');
    }
  });
});

describe('write path real — sin fugas por log', () => {
  it('el transporte real no usa console.* (no loggea token/secreto/payload)', () => {
    const t = src('campana/meta-write-transport.ts');
    expect(t).not.toContain('console.');
  });
  it('el adapter real no usa console.*', () => {
    expect(src('campana/meta-write-real-adapter.ts')).not.toContain('console.');
  });
});
