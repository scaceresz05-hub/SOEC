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

const SDKS = ['openai', '@anthropic-ai/sdk', 'googleapis', 'nodemailer', 'axios', '@soec/models', '@soec/ece'];

describe('Dependencias arquitectónicas del plano de canales', () => {
  const archivos = archivosTs(SRC).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('ningún archivo importa un SDK de proveedor ni paquetes intelectuales', () => {
    for (const { path, src } of archivos) {
      if (path.includes(join('src', 'pg'))) continue;
      for (const imp of imports(src)) expect(SDKS, `${path} importa ${imp}`).not.toContain(imp);
    }
  });

  it('el proveedor emulado está AISLADO: ningún archivo de src lo importa (solo las pruebas)', () => {
    for (const { path, src } of archivos) {
      expect(imports(src), `${path} importa el emulador`).not.toContain('@soec/canal-emulado');
    }
  });

  it('el dominio es puro: no importa adaptadores, /pg, el emulador ni usa red', () => {
    for (const { path, src } of archivos) {
      if (!path.includes(join('src', 'domain'))) continue;
      for (const imp of imports(src)) {
        expect(imp.includes('/pg'), `${path} importa pg`).toBe(false);
        expect(imp.includes('adapters'), `${path} importa un adaptador`).toBe(false);
      }
      expect(/\bfetch\s*\(/.test(src), `${path} usa fetch`).toBe(false);
    }
  });

  it('la publicación NO salta la autorización: el servicio usa el motor operacional', () => {
    const svc = archivos.find((f) => f.path.endsWith(join('app', 'publication-service.ts')));
    expect(svc).toBeDefined();
    expect(imports(svc!.src)).toContain('@soec/operacional');
    expect(/evaluarAutorizacion/.test(svc!.src)).toBe(true);
  });

  it('el adaptador es reemplazable: existen al menos dos implementaciones de AdaptadorCanal', () => {
    const impls = archivos.filter((f) => /implements AdaptadorCanal/.test(f.src));
    expect(impls.length).toBeGreaterThanOrEqual(2);
  });

  it('ningún secreto es obligatorio y el token nunca se persiste en el agregado', () => {
    const agregado = archivos.find((f) => f.path.endsWith(join('domain', 'publication.ts')));
    // El agregado guarda credencialId (referencia), nunca un token.
    expect(/\btoken\b/.test(agregado!.src)).toBe(false);
    for (const { path, src } of archivos) {
      expect(/process\.env/.test(src), `${path} exige variables de entorno`).toBe(false);
    }
  });
});
