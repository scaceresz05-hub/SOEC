/**
 * Neutralidad de la frontera (Directiva PCE, Art. 2/4/12) — GUARDARRAÍL, no análisis estático absoluto.
 *
 * @soec/adaptadores define CONTRATOS y adaptadores fake/grabados; NO contiene proveedores reales ni toca
 * red/entorno/reloj/aleatoriedad. Los adaptadores reales vivirán en su propia frontera (M4-C-B+), cada uno
 * con revisión y tests de no-filtración. Este test (misma técnica que M4-BH): elimina comentarios, prohíbe
 * primitivas de red/no-determinismo por forma de llamada, y prohíbe especificadores de SDK en imports.
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

function sinComentarios(txt: string): string {
  return txt.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

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

const SDKS_PROVEEDOR = ['openai', '@anthropic-ai', 'anthropic', 'gemini', 'googleapis', 'google-ads-api', 'hubspot', 'nodemailer', 'stripe', 'twilio', 'aws-sdk', '@aws-sdk', 'azure', 'gcp', 'meta-api'];

describe('@soec/adaptadores · neutralidad de arquitectura (guardarraíl)', () => {
  it('ningún archivo de src/ usa red / entorno / reloj / aleatoriedad en código', () => {
    for (const f of archivosTs(SRC)) {
      const codigo = sinComentarios(readFileSync(f, 'utf8'));
      for (const { re, que } of PATRONES_CODIGO) expect(re.test(codigo), `${f} usa "${que}"`).toBe(false);
    }
  });

  it('ningún archivo de src/ importa un SDK de proveedor', () => {
    for (const f of archivosTs(SRC)) {
      const codigo = sinComentarios(readFileSync(f, 'utf8'));
      const specs = [...codigo.matchAll(/(?:from|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
      for (const spec of specs) for (const sdk of SDKS_PROVEEDOR) expect(spec.includes(sdk), `${f} importa "${sdk}" (${spec})`).toBe(false);
    }
  });
});
