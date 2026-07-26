/**
 * Decidir ≠ ejecutar: el dominio/app de decisión NO importa módulos de operación ni
 * adaptadores de efecto, y no cruza red. (La capa `src/pg` compone la cadena de
 * migraciones y se exceptúa.)
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

const PROHIBIDOS = [
  '@soec/operacional',
  '@soec/canales',
  '@soec/canal-emulado',
  '@soec/marketing',
  '@soec/control',
  '@soec/medicion',
  '@soec/contenido',
  'fastify',
  'openai',
  '@anthropic-ai/sdk',
];
// El dominio/app (todo src salvo la capa pg de migraciones/proyección).
const ARCHIVOS = archivosTs(SRC).filter((a) => !a.replace(/\\/g, '/').includes('/pg/'));

describe('@soec/decision · decidir ≠ ejecutar', () => {
  it('el dominio/app no importa módulos de operación ni adaptadores de efecto', () => {
    for (const a of ARCHIVOS) {
      for (const imp of imports(readFileSync(a, 'utf8'))) {
        expect(PROHIBIDOS, `${a} importa ${imp}`).not.toContain(imp);
      }
    }
  });
  it('no cruza red (sin fetch)', () => {
    for (const a of ARCHIVOS)
      expect(readFileSync(a, 'utf8').includes('fetch('), `${a} usa fetch`).toBe(false);
  });
});
