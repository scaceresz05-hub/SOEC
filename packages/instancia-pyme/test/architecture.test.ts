import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...archivosTs(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}
function imports(src: string): string[] {
  const re = /from\s+['"]([^'"]+)['"]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) if (m[1]) out.push(m[1]);
  return out;
}

describe('Instanciación — sin excepciones arquitectónicas', () => {
  const archivos = archivosTs(SRC).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('no accede a tablas ni al event store: usa solo servicios públicos', () => {
    for (const { path, src } of archivos) {
      for (const imp of imports(src)) {
        expect(imp === 'pg', `${path} importa pg`).toBe(false);
        expect(imp.startsWith('@soec/event-store'), `${path} importa el event store`).toBe(false);
        expect(imp.includes('/pg'), `${path} importa un subpaquete pg: ${imp}`).toBe(false);
      }
    }
  });

  it('no ejecuta efectos externos (sin adaptadores de acción)', () => {
    for (const { path, src } of archivos) {
      expect(/class\s+\w*(Efecto|Accion|Ejecutor|Sender|Campaign)\w*/.test(src), path).toBe(false);
      expect(/\b(fetch|axios|nodemailer)\b/.test(src), `${path} referencia efectos externos`).toBe(false);
    }
  });

  it('no incorpora datos reales ni credenciales (todo sintético)', () => {
    for (const { path, src } of archivos) {
      expect(/password|api[_-]?key|secret|token/i.test(src), `${path} referencia credenciales`).toBe(false);
    }
  });
});
