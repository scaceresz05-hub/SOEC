/**
 * Aislamiento (límites): el paquete no crea persistencia durable ni efectos reales, y
 * no embebe conocimiento sectorial. El conocimiento del rubro entra solo por el puerto.
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

const ARCHIVOS = archivosTs(SRC);
// Ni persistencia durable, ni efectos externos, ni módulos ajenos al núcleo cognitivo.
const PROHIBIDOS = [
  'pg',
  'prisma',
  '@prisma/client',
  '@soec/event-store',
  '@soec/operacional',
  '@soec/canales',
  '@soec/canal-emulado',
  '@soec/marketing',
  '@soec/control',
  '@soec/piloto',
  'fastify',
];

describe('@soec/diagnostico · aislamiento', () => {
  it('no importa persistencia durable, adaptadores de efecto ni frameworks', () => {
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

  it('no embebe conocimiento sectorial (todo el conocimiento entra por el puerto)', () => {
    for (const a of ARCHIVOS) {
      const src = readFileSync(a, 'utf8');
      expect(/clinica|dental/i.test(src), `${a} embebe conocimiento del rubro`).toBe(false);
      expect(
        src.includes('crearBibliotecaClinicaDental'),
        `${a} usa datos concretos del rubro`,
      ).toBe(false);
    }
  });
});
