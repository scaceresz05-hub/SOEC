import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...archivosTs(p));
    else if (e.name.endsWith('.ts')) out.push(p);
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

// El piloto es GENÉRICO: no pertenece a marketing ni importa dominios operativos.
const PROHIBIDOS = ['@soec/marketing', '@soec/contenido', '@soec/canales', '@soec/medicion', '@soec/operacional', '@soec/models', '@soec/ece', 'openai', '@anthropic-ai/sdk', 'fastify'];

describe('Dependencias arquitectónicas de preparación de piloto', () => {
  const archivos = archivosTs(SRC).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('el piloto NO pertenece a marketing ni importa dominios operativos ni SDKs', () => {
    for (const { path, src } of archivos) {
      if (path.includes(join('src', 'pg'))) continue; // migrate-cli compone la cadena de migraciones
      for (const imp of imports(src)) expect(PROHIBIDOS, `${path} importa ${imp}`).not.toContain(imp);
    }
  });

  it('no existe token productivo ni habilitación real; no usa red', () => {
    for (const { path, src } of archivos) {
      expect(/\bfetch\s*\(/.test(src), `${path} usa red`).toBe(false);
      // Ninguna función retorna true para habilitar el modo real.
      expect(/realHabilitable\(\)\s*{\s*return true/.test(src), `${path} habilita real`).toBe(false);
      expect(/permitida:\s*true/.test(src) && path.includes('expediente'), `${path} permite activación`).toBe(false);
    }
  });

  it('el dominio es puro: no importa /pg', () => {
    for (const { path, src } of archivos) {
      if (!path.includes(join('src', 'domain'))) continue;
      for (const imp of imports(src)) expect(imp.includes('/pg'), `${path} importa pg`).toBe(false);
    }
  });
});
