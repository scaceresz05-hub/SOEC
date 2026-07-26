/**
 * Pruebas arquitectónicas de @soec/rubros (criterios 1 y 2 del paso 1).
 * - No importa ningún `@soec/*` salvo `@soec/contracts`.
 * - No importa de `apps/*`, persistencia, Prisma, SDKs de IA ni frameworks HTTP.
 * - No cruza red (`fetch`).
 * - No contiene datos de instancia: «SmileFlow» no aparece en el código ejecutable.
 * - `package.json` no declara dependencias `@soec/*` fuera de `@soec/contracts`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const SRC = join(RAIZ, 'src');

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) out.push(...archivosTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function imports(src: string): string[] {
  const re = /from\s+['"]([^'"]+)['"]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const g = m[1];
    if (g) out.push(g);
  }
  return out;
}

const PROHIBIDOS_EXT = [
  'pg',
  'prisma',
  '@prisma/client',
  'fastify',
  'next',
  'openai',
  '@anthropic-ai/sdk',
  'ioredis',
  'redis',
];

const ARCHIVOS = archivosTs(SRC);

describe('@soec/rubros · aislamiento de dependencias', () => {
  it('no importa @soec/* salvo @soec/contracts, ni módulos prohibidos', () => {
    for (const archivo of ARCHIVOS) {
      const src = readFileSync(archivo, 'utf8');
      for (const imp of imports(src)) {
        if (imp.startsWith('@soec/')) {
          expect(imp, `${archivo} importa ${imp}`).toBe('@soec/contracts');
        }
        expect(PROHIBIDOS_EXT, `${archivo} importa ${imp}`).not.toContain(imp);
        expect(imp.includes('apps/'), `${archivo} importa de apps/: ${imp}`).toBe(false);
        expect(/\.\.\/\.\.\/\.\./.test(imp), `${archivo} escapa del paquete: ${imp}`).toBe(false);
      }
    }
  });

  it('no cruza red (sin fetch)', () => {
    for (const archivo of ARCHIVOS) {
      expect(readFileSync(archivo, 'utf8').includes('fetch('), `${archivo} usa fetch`).toBe(false);
    }
  });

  it('no contiene datos de instancia (SmileFlow no aparece en el código ejecutable)', () => {
    for (const archivo of ARCHIVOS) {
      expect(
        /smileflow/i.test(readFileSync(archivo, 'utf8')),
        `${archivo} menciona una instancia`,
      ).toBe(false);
    }
  });

  it('package.json no declara dependencias @soec/* fuera de @soec/contracts', () => {
    const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (dep.startsWith('@soec/')) expect(dep).toBe('@soec/contracts');
    }
  });
});
