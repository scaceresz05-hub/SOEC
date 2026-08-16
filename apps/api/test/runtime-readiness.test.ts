/**
 * Readiness de producción (Railway) — invariantes estáticas del repo. No arranca servidores ni red.
 * Complementa los smokes de runtime (build + `node dist/server.js` + /health) que corren en los gates.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const leer = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const json = (rel: string): Record<string, unknown> => JSON.parse(leer(rel));

describe('runtime-readiness · @soec/api compilado (sin tsx en producción)', () => {
  const pkg = json('../package.json') as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};

  it('START_IS_COMPILED: start = node dist/server.js (no tsx)', () => {
    expect(scripts['start']).toBe('node dist/server.js');
    expect(scripts['start'] ?? '').not.toContain('tsx');
  });
  it('BUILD_EXISTS', () => {
    expect(scripts['build']).toBeTruthy();
    expect(leer('../scripts/build.mjs')).toContain('esbuild');
  });
  it('VAULT_SMOKE_PRESERVED', () => {
    expect(scripts['vault:smoke']).toBe('tsx src/acquisition/vault-smoke.cli.ts');
  });
  it('DEV_TOOLING_STILL_TSX (dev/migrate permitido)', () => {
    expect(scripts['dev'] ?? '').toContain('tsx');
    expect(scripts['migrate:prod'] ?? '').toContain('tsx');
  });
});

describe('runtime-readiness · API bind y health', () => {
  const server = leer('../src/server.ts');
  const app = leer('../src/app.ts');

  it('API_BINDS_PORT_AND_HOST: process.env.PORT + 0.0.0.0', () => {
    expect(server).toContain('process.env.PORT');
    expect(server).toContain("host: '0.0.0.0'");
  });
  it('HEALTH_ROUTE_SAFE: /health público, respuesta trivial, sin auth ni secretos', () => {
    expect(app).toContain("app.get('/health'");
    const linea = app.split('\n').find((l) => l.includes("app.get('/health'")) ?? '';
    expect(linea).toContain("status: 'ok'");
    expect(linea).not.toContain('preHandler');
    expect(linea).not.toContain('authenticate');
  });
});

describe('runtime-readiness · @soec/web puerto dinámico', () => {
  it('WEB_START_RESPECTS_PORT: next start sin puerto fijo', () => {
    const web = json('../../web/package.json') as { scripts?: Record<string, string> };
    const start = web.scripts?.['start'] ?? '';
    expect(start).toBe('next start');
    expect(start).not.toContain('3000');
  });
});

describe('runtime-readiness · aislamiento SSR Control / SmileFlow', () => {
  it('NO_CROSS_RUNTIME_REFERENCES en el runbook de producción', () => {
    const runbook = leer('../../../docs/runtime/RAILWAY-PRODUCTION.md');
    // El runbook nombra los proyectos ajenos SÓLO en la sección de invariante de aislamiento (prohibición),
    // por eso acá verificamos el contrato productivo real: package.json de api/web no los referencia.
    const apiPkg = leer('../package.json');
    const webPkg = leer('../../web/package.json');
    for (const prohibido of ['@ssr-control/', 'smileflow-clinic']) {
      expect(apiPkg).not.toContain(prohibido);
      expect(webPkg).not.toContain(prohibido);
    }
    expect(runbook).toContain('SOEC runtime'); // el invariante está documentado
  });
});

describe('runtime-readiness · sin secretos productivos en el repo', () => {
  it('NO_PLAINTEXT_SECRET_CONFIG: build script y runbook no contienen VAULT_TOKEN= ni DATABASE_URL con credencial real', () => {
    const build = leer('../scripts/build.mjs');
    const runbook = leer('../../../docs/runtime/RAILWAY-PRODUCTION.md');
    for (const fuente of [build, runbook]) {
      expect(fuente).not.toMatch(/VAULT_TOKEN\s*=\s*\S/);
      expect(fuente).not.toMatch(/postgres:\/\/[^\s`]*:[^\s`@]+@/); // sin URL con password embebida
    }
  });
});
