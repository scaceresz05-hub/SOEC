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

// El plano operativo consume conocimiento por REFERENCIA (contratos públicos), no
// reconstruyendo productos: su dominio/aplicación no importa paquetes intelectuales.
const PROHIBIDOS_DOMINIO = ['@soec/models', '@soec/ece', '@soec/operaciones', '@soec/capacidades', 'fastify', 'openai', '@anthropic-ai/sdk'];

describe('Dependencias arquitectónicas del plano operativo', () => {
  const archivos = archivosTs(SRC).map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('el dominio y la aplicación no importan paquetes intelectuales ni SDK externos', () => {
    for (const { path, src } of archivos) {
      if (path.includes(`${join('src', 'pg')}`)) continue; // el migrate-cli compone la cadena de migraciones
      for (const imp of imports(src)) {
        expect(PROHIBIDOS_DOMINIO, `${path} importa ${imp}`).not.toContain(imp);
      }
    }
  });

  it('el efecto solo ocurre por adaptador simulado: no hay clientes reales de red', () => {
    for (const { path, src } of archivos) {
      expect(/\b(fetch|axios|nodemailer|googleapis)\b/.test(src), `${path} referencia red real`).toBe(false);
      // El tipo Efecto obliga a `simulado: true`; ningún adaptador produce efecto real en este bloque.
    }
  });

  it('la capa de dominio (src/domain) es pura: no importa infraestructura', () => {
    for (const { path, src } of archivos) {
      if (!path.includes(join('src', 'domain'))) continue;
      for (const imp of imports(src)) {
        expect(imp.includes('/pg'), `${path} importa infraestructura`).toBe(false);
        expect(imp === 'pg', `${path} importa pg`).toBe(false);
      }
    }
  });

  it('no existen adaptadores de efecto externo real (solo simulado)', () => {
    for (const { path, src } of archivos) {
      expect(/class\s+\w*(Real|Live|Produccion|Prod)\w*Adapter/i.test(src), path).toBe(false);
    }
  });
});
