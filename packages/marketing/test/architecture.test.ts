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

const PROHIBIDOS = ['@soec/models', '@soec/ece', '@soec/operaciones', '@soec/capacidades', 'fastify', 'openai', '@anthropic-ai/sdk', 'googleapis'];

describe('Dependencias arquitectónicas de marketing', () => {
  const archivos = archivosTs(SRC).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('no importa paquetes intelectuales ni SDK externos (dominio/aplicación)', () => {
    for (const { path, src } of archivos) {
      if (path.includes(join('src', 'pg'))) continue; // migrate-cli compone la cadena de migraciones
      for (const imp of imports(src)) expect(PROHIBIDOS, `${path} importa ${imp}`).not.toContain(imp);
    }
  });

  it('el planificador (domain/planner.ts) no importa adaptadores ni ejecuta efectos', () => {
    const planner = archivos.find((f) => f.path.endsWith(join('domain', 'planner.ts')));
    expect(planner).toBeDefined();
    for (const imp of imports(planner!.src)) {
      // Solo tipos de política; nunca adaptadores, servicios operacionales ni red.
      expect(imp.includes('adapter'), 'el planificador no importa adaptadores').toBe(false);
      expect(imp.includes('operational-service'), 'el planificador no importa el coordinador').toBe(false);
    }
    expect(/\b(fetch|axios|publicar\s*\()/.test(planner!.src)).toBe(false);
  });

  it('la ejecución pasa por el plano operacional único (OperationalService)', () => {
    const planning = archivos.find((f) => f.path.endsWith(join('app', 'planning-service.ts')));
    expect(imports(planning!.src).some((i) => i === '@soec/operacional')).toBe(true);
  });

  it('la capa de dominio es pura y no hay proveedor real ni efectos de red', () => {
    for (const { path, src } of archivos) {
      if (path.includes(join('src', 'domain'))) {
        for (const imp of imports(src)) expect(imp.includes('/pg'), `${path} importa pg`).toBe(false);
      }
      expect(/\b(nodemailer|axios)\b/.test(src), `${path} usa red real`).toBe(false);
    }
  });
});
