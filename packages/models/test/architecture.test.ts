import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) salida.push(...archivosTs(p));
    else if (entry.name.endsWith('.ts')) salida.push(p);
  }
  return salida;
}

function importsDe(contenido: string): string[] {
  const re = /from\s+['"]([^'"]+)['"]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(contenido))) if (m[1]) out.push(m[1]);
  return out;
}

describe('Dependencias arquitectónicas del dominio de Modelos', () => {
  const archivos = archivosTs(SRC).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('ningún archivo del dominio depende del framework web ni del órgano de IA', () => {
    for (const { path, src } of archivos) {
      const imps = importsDe(src);
      expect(imps, `${path} no debe importar fastify`).not.toContain('fastify');
      expect(imps, `${path} no debe importar @soec/intelligence`).not.toContain('@soec/intelligence');
    }
  });

  it('la capa de dominio (src/domain) es pura: no importa infraestructura (pg) ni aplicación', () => {
    for (const { path, src } of archivos) {
      if (!path.includes(`${join('src', 'domain')}`)) continue;
      const imps = importsDe(src);
      for (const imp of imps) {
        expect(imp.includes('/pg'), `${path} importa infraestructura: ${imp}`).toBe(false);
        expect(imp === 'pg', `${path} importa pg`).toBe(false);
        expect(imp.includes('/app'), `${path} importa aplicación: ${imp}`).toBe(false);
      }
    }
  });

  it('la capa de aplicación (src/app) no depende de PostgreSQL directamente', () => {
    for (const { path, src } of archivos) {
      if (!path.includes(`${join('src', 'app')}`)) continue;
      const imps = importsDe(src);
      for (const imp of imps) {
        expect(imp === 'pg', `${path} importa pg`).toBe(false);
        expect(imp.includes('/pg'), `${path} importa el subpaquete pg: ${imp}`).toBe(false);
      }
    }
  });

  it('no implementa el ECE anticipadamente (sin integración de comprensión, #12)', () => {
    for (const { path, src } of archivos) {
      expect(/class\s+\w*ECE\w*/.test(src), `${path} no debe declarar el ECE`).toBe(false);
    }
  });
});
