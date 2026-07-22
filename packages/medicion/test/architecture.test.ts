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
const SDKS = ['openai', '@anthropic-ai/sdk', 'googleapis', 'nodemailer', 'axios', '@soec/models', '@soec/ece'];

describe('Dependencias arquitectónicas de medición', () => {
  const archivos = archivosTs(SRC).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('no importa SDKs de proveedor ni paquetes intelectuales', () => {
    for (const { path, src } of archivos) {
      if (path.includes(join('src', 'pg'))) continue;
      for (const imp of imports(src)) expect(SDKS, `${path} importa ${imp}`).not.toContain(imp);
    }
  });

  it('el proveedor emulado sigue AISLADO: ningún archivo de src lo importa', () => {
    for (const { path, src } of archivos) expect(imports(src), `${path} importa el emulador`).not.toContain('@soec/canal-emulado');
  });

  it('el dominio es puro: no importa /pg, adaptadores ni usa red; sin azar (fórmulas deterministas)', () => {
    for (const { path, src } of archivos) {
      if (!path.includes(join('src', 'domain'))) continue;
      for (const imp of imports(src)) expect(imp.includes('/pg'), `${path} importa pg`).toBe(false);
      expect(/\bfetch\s*\(/.test(src), `${path} usa fetch`).toBe(false);
      expect(/Math\.random/.test(src), `${path} usa azar`).toBe(false);
    }
  });

  it('la optimización NO modifica el plan directamente: usa el contrato público de marketing', () => {
    for (const { path, src } of archivos) {
      expect(/planStreamId|'plan:'|"plan:"/.test(src), `${path} accede al stream del plan`).toBe(false);
    }
    const opt = archivos.find((f) => f.path.endsWith(join('app', 'optimization-service.ts')))!;
    expect(imports(opt.src)).toContain('@soec/marketing');
  });

  it('la optimización NO salta la autorización: usa el motor operacional', () => {
    const opt = archivos.find((f) => f.path.endsWith(join('app', 'optimization-service.ts')))!;
    expect(imports(opt.src)).toContain('@soec/operacional');
    expect(/evaluarAutorizacion/.test(opt.src)).toBe(true);
  });

  it('la medición no publica ni gasta (no importa adaptadores de canal ni ejecuta efectos)', () => {
    for (const { path, src } of archivos) {
      for (const imp of imports(src)) expect(imp.includes('adapter'), `${path} importa un adaptador`).toBe(false);
      expect(/\.publicar\s*\(/.test(src), `${path} publica`).toBe(false);
    }
  });
});
