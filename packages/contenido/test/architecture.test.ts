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

const PROHIBIDOS = ['@soec/models', '@soec/ece', '@soec/operaciones', '@soec/capacidades', 'fastify', 'openai', '@anthropic-ai/sdk', 'googleapis', 'nodemailer', 'axios'];

describe('Dependencias arquitectónicas de la fábrica de contenido', () => {
  const archivos = archivosTs(SRC).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('no importa paquetes intelectuales ni SDK de proveedores/canales', () => {
    for (const { path, src } of archivos) {
      if (path.includes(join('src', 'pg'))) continue; // migrate-cli compone la cadena de migraciones
      for (const imp of imports(src)) expect(PROHIBIDOS, `${path} importa ${imp}`).not.toContain(imp);
    }
  });

  it('el dominio es puro: no importa proveedores, /pg ni ejecuta efectos de red', () => {
    for (const { path, src } of archivos) {
      if (!path.includes(join('src', 'domain'))) continue;
      for (const imp of imports(src)) {
        expect(imp.includes('/pg'), `${path} importa pg`).toBe(false);
        expect(imp.includes('providers'), `${path} importa un proveedor`).toBe(false);
      }
    }
  });

  it('la fábrica no publica ni importa adaptadores de canal reales; el efecto pasa por el plano operacional', () => {
    const factory = archivos.find((f) => f.path.endsWith(join('app', 'factory-service.ts')));
    expect(factory).toBeDefined();
    for (const imp of imports(factory!.src)) {
      expect(imp.includes('adapter'), 'la fábrica no importa adaptadores').toBe(false);
      expect(imp === '@soec/operacional', 'la fábrica no ejecuta por el plano operacional directamente').toBe(false);
    }
    // Nadie en el paquete instancia un adaptador de canal ni publica directamente.
    for (const { path, src } of archivos) {
      expect(/AdaptadorSimulado|\.publicar\s*\(|new\s+\w*ChannelAdapter/.test(src), `${path} publica directamente`).toBe(false);
    }
  });

  it('ningún secreto es obligatorio y no hay efectos de red reales', () => {
    for (const { path, src } of archivos) {
      expect(/process\.env/.test(src), `${path} exige variables de entorno`).toBe(false);
      expect(/\b(fetch|axios|nodemailer|WebSocket)\s*\(/.test(src), `${path} usa red real`).toBe(false);
    }
  });
});
