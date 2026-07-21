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

// Paquetes/tecnologías que el ECE NO debe consumir: es anterior a #13 y #14.
const PROHIBIDOS = ['@soec/intelligence', 'fastify', '@soec/operaciones', '@soec/capacidades', '@soec/api', '@soec/worker'];

describe('Dependencias arquitectónicas del ECE', () => {
  const archivos = archivosTs(SRC).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('el ECE no depende de operaciones, capacidades, IA ni UI', () => {
    for (const { path, src } of archivos) {
      for (const imp of imports(src)) {
        expect(PROHIBIDOS, `${path} importa ${imp}`).not.toContain(imp);
      }
    }
  });

  it('la capa de dominio (src/domain) es pura: no importa infraestructura ni aplicación', () => {
    for (const { path, src } of archivos) {
      if (!path.includes(join('src', 'domain'))) continue;
      for (const imp of imports(src)) {
        expect(imp.includes('/pg'), `${path} importa infraestructura: ${imp}`).toBe(false);
        expect(imp === 'pg', `${path} importa pg`).toBe(false);
        expect(imp.includes('/app'), `${path} importa aplicación: ${imp}`).toBe(false);
      }
    }
  });

  it('el ECE consume MED y MDM (dependencia legítima hacia @soec/models)', () => {
    const algunoUsaModels = archivos.some(({ src }) => imports(src).some((i) => i.startsWith('@soec/models')));
    expect(algunoUsaModels).toBe(true);
  });

  it('no introduce operaciones intelectuales (explicar/orientar/predecir/recomendar) como código de dominio', () => {
    for (const { path, src } of archivos) {
      // No deben existir funciones/métodos que nombren operaciones intelectuales.
      expect(/function\s+(explicar|orientar|predecir|recomendar|diagnosticar)\b/.test(src), `${path}`).toBe(false);
      expect(/class\s+\w*(Operacion|Capacidad|Recomendacion|Agente)\w*/.test(src), `${path}`).toBe(false);
    }
  });
});
