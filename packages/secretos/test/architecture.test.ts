/**
 * Neutralidad (Directiva Maestra PCE, Art. 2/4/12) — GUARDARRAÍL, no análisis estático absoluto (F-2, M4-BH).
 *
 * @soec/secretos no depende de ningún proveedor de secretos ni de red/entorno/reloj/aleatoriedad. Los
 * adaptadores reales (env/vault/aws-sm/…) vivirán en su propia frontera. Este test:
 *   1. elimina comentarios antes de escanear (para no tropezar con menciones legítimas de esquemas futuros);
 *   2. prohíbe primitivas de red / no-determinismo por forma de llamada;
 *   3. prohíbe especificadores de SDK de proveedor en imports estáticos, `require(...)` e `import(...)`.
 * NO afirma imposibilitar toda evasión (una construcción dinámica podría eludirlo); es una red de defensa
 * que obliga a que cualquier llamada real sea deliberada y visible en revisión. Los adaptadores sintéticos
 * locales están permitidos; las llamadas reales siguen prohibidas en este bloque.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivosTs(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Elimina comentarios de bloque y de línea para escanear sólo código ejecutable. */
function sinComentarios(txt: string): string {
  return txt.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

// Primitivas de red / no-determinismo (por forma de uso en CÓDIGO, ya sin comentarios).
const PATRONES_CODIGO: readonly { re: RegExp; que: string }[] = [
  { re: /\bfetch\s*\(/, que: 'fetch(' },
  { re: /\baxios\b/, que: 'axios' },
  { re: /XMLHttpRequest/, que: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, que: 'WebSocket' },
  { re: /node:https?\b/, que: 'node:http(s)' },
  { re: /\bhttps?\.(get|request|createServer)\s*\(/, que: 'http(s).get/request/createServer' },
  { re: /\bprocess\s*\.\s*env\b/, que: 'process.env' },
  { re: /\bMath\s*\.\s*random\s*\(/, que: 'Math.random(' },
  { re: /\brandomUUID\s*\(/, que: 'randomUUID(' },
  { re: /\bDate\s*\.\s*now\s*\(/, que: 'Date.now(' },
  { re: /\bnew\s+Date\s*\(\s*\)/, que: 'new Date()' },
  { re: /\brequire\s*\(/, que: 'require(' },
  { re: /\bimport\s*\(/, que: 'import( dinámico' },
];

// SDKs de proveedor: prohibidos como especificador de import/require literal.
const SDKS_PROVEEDOR = ['openai', '@anthropic-ai', 'anthropic', 'gemini', 'googleapis', 'google-ads-api', 'hubspot', 'nodemailer', 'stripe', 'twilio', 'aws-sdk', '@aws-sdk', 'azure', 'gcp', 'meta-api'];

describe('@soec/secretos · neutralidad de arquitectura (guardarraíl F-2)', () => {
  it('ningún archivo de src/ usa red / entorno / reloj / aleatoriedad en código', () => {
    for (const f of archivosTs(SRC)) {
      const codigo = sinComentarios(readFileSync(f, 'utf8'));
      for (const { re, que } of PATRONES_CODIGO) {
        expect(re.test(codigo), `${f} usa "${que}"`).toBe(false);
      }
    }
  });

  it('ningún archivo de src/ importa un SDK de proveedor (import/require/import())', () => {
    for (const f of archivosTs(SRC)) {
      const codigo = sinComentarios(readFileSync(f, 'utf8'));
      const especificadores = [...codigo.matchAll(/(?:from|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
      for (const spec of especificadores) {
        for (const sdk of SDKS_PROVEEDOR) {
          expect(spec.includes(sdk), `${f} importa el SDK de proveedor "${sdk}" (${spec})`).toBe(false);
        }
      }
    }
  });

  it('sólo el holder opaco y el adaptador de frontera conocen un valor de secreto', () => {
    for (const f of archivosTs(SRC)) {
      if (f.includes('secreto-resuelto') || f.includes(join('adapters'))) continue;
      const codigo = sinComentarios(readFileSync(f, 'utf8'));
      // El dominio/gobernanza jamás nombra un valor en claro en un payload.
      expect(/payload[^;]*\bvalor\b/.test(codigo), `${f} referencia un valor en un payload`).toBe(false);
    }
  });
});
