/**
 * Aislamiento (límite 1): el motor de Estrategia NO accede a MED/MDM/ECE, al event store
 * ni a los internals del Diagnóstico. Consume solo el tipo `ComprensionEvaluable`
 * (@soec/diagnostico) y `RubroKnowledgePort` (@soec/rubros). Sin efectos reales.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
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

const PERMITIDOS_SOEC = new Set(['@soec/rubros', '@soec/diagnostico']);
const ARCHIVOS = archivosTs(SRC);

describe('@soec/estrategia · aislamiento', () => {
  it('solo importa @soec/rubros y @soec/diagnostico (ni motor cognitivo, ni store, ni internals)', () => {
    for (const a of ARCHIVOS) {
      for (const imp of imports(readFileSync(a, 'utf8'))) {
        if (imp.startsWith('@soec/')) {
          expect(PERMITIDOS_SOEC.has(imp), `${a} importa ${imp}`).toBe(true);
        }
      }
    }
  });

  it('no importa persistencia ni adaptadores de efecto, ni cruza red', () => {
    const prohibidos = [
      'pg',
      'prisma',
      '@prisma/client',
      'fastify',
      '@soec/event-store',
      '@soec/models',
      '@soec/ece',
      '@soec/operaciones',
      '@soec/capacidades',
      '@soec/operacional',
      '@soec/canales',
    ];
    for (const a of ARCHIVOS) {
      const src = readFileSync(a, 'utf8');
      for (const imp of imports(src)) expect(prohibidos, `${a} importa ${imp}`).not.toContain(imp);
      expect(src.includes('fetch('), `${a} usa fetch`).toBe(false);
    }
  });
});
