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

// Las operaciones NO deben depender de capacidades, UI, SDK externos ni saltarse el ECE.
const PROHIBIDOS = [
  '@soec/capacidades',
  '@soec/api',
  '@soec/worker',
  'fastify',
  'openai',
  '@anthropic-ai/sdk',
  '@soec/models', // debe consumirse el ECE por su puerto, no los modelos directamente
];

describe('Dependencias arquitectónicas de las operaciones', () => {
  const archivos = archivosTs(SRC).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('no depende de capacidades, UI, SDK externos ni de los modelos directamente', () => {
    for (const { path, src } of archivos) {
      for (const imp of imports(src)) {
        expect(PROHIBIDOS, `${path} importa ${imp}`).not.toContain(imp);
        expect(imp.startsWith('@soec/models'), `${path} importa modelos: ${imp}`).toBe(false);
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

  it('consume el ECE por su puerto de lectura (@soec/ece)', () => {
    const usaEce = archivos.some(({ src }) => imports(src).some((i) => i.startsWith('@soec/ece')));
    expect(usaEce).toBe(true);
  });

  it('no incorpora un proveedor real de IA (solo mecanismos propios y simulados)', () => {
    for (const { path, src } of archivos) {
      expect(/import\s+.*from\s+['"]openai['"]/.test(src), path).toBe(false);
      expect(/@anthropic-ai/.test(src), path).toBe(false);
    }
  });

  it('no cierra el lazo: sin adaptadores de efectos externos', () => {
    for (const { path, src } of archivos) {
      expect(/class\s+\w*(Efecto|Accion|Ejecutor|Campaign|Sender)\w*/.test(src), path).toBe(false);
    }
  });
});
