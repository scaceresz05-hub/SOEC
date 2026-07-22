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

// El Centro de Control NO es otra fuente de verdad: no importa los dominios operativos
// en tiempo de ejecución (la composición del modelo de lectura ocurre en la capa de app).
const PROHIBIDOS = ['@soec/marketing', '@soec/contenido', '@soec/canales', '@soec/medicion', '@soec/operacional', '@soec/models', '@soec/ece', 'openai', '@anthropic-ai/sdk', 'fastify'];

describe('Dependencias arquitectónicas del Centro de Control', () => {
  const archivos = archivosTs(SRC).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('el paquete no importa dominios operativos ni SDKs (la composición es en la app)', () => {
    for (const { path, src } of archivos) {
      if (path.includes(join('src', 'pg'))) continue; // migrate-cli compone la cadena de migraciones
      for (const imp of imports(src)) expect(PROHIBIDOS, `${path} importa ${imp}`).not.toContain(imp);
    }
  });

  it('el modelo de lectura es de TIPOS: no recalcula ni muta agregados ni usa red', () => {
    for (const { path, src } of archivos) {
      expect(/\bfetch\s*\(/.test(src), `${path} usa red`).toBe(false);
      // El control no accede a streams de otros dominios ni los muta.
      expect(/planStreamId|paqueteStreamId|pubStreamId|medStreamId/.test(src), `${path} accede a streams de otros dominios`).toBe(false);
    }
  });

  it('no expone habilitación del modo real ni efectos externos', () => {
    for (const { path, src } of archivos) {
      expect(/real_habilitado/.test(src) && !path.includes('summary'), `${path} habilita el modo real`).toBe(false);
    }
  });
});
