/**
 * Neutralidad de la carcasa (Directiva PCE, Art. 2/4/12) — GUARDARRAÍL. El adaptador concreto NO importa
 * SDK, NO usa red/entorno/reloj/aleatoriedad y NO nombra un proveedor comercial. Misma técnica que M4-BH:
 * elimina comentarios antes de escanear.
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
const PATRONES: readonly { re: RegExp; que: string }[] = [
  { re: /\bfetch\s*\(/, que: 'fetch(' },
  { re: /\baxios\b/, que: 'axios' },
  { re: /node:https?\b/, que: 'node:http(s)' },
  { re: /\bprocess\s*\.\s*env\b/, que: 'process.env' },
  { re: /\bMath\s*\.\s*random\s*\(/, que: 'Math.random(' },
  { re: /\bDate\s*\.\s*now\s*\(/, que: 'Date.now(' },
  { re: /\bnew\s+Date\s*\(\s*\)/, que: 'new Date()' },
  { re: /\brequire\s*\(/, que: 'require(' },
  { re: /\bimport\s*\(/, que: 'import( dinámico' },
];
const SDKS = ['openai', '@anthropic-ai', 'anthropic', 'gemini', 'googleapis', 'hubspot', 'nodemailer', 'stripe', 'twilio', 'aws-sdk', '@aws-sdk', 'azure', 'gcp'];

describe('@soec/adaptador-generativo-externo · neutralidad', () => {
  it('sin red/entorno/reloj/aleatoriedad ni SDK de proveedor', () => {
    for (const f of archivosTs(SRC)) {
      const codigo = sinComentarios(readFileSync(f, 'utf8'));
      for (const { re, que } of PATRONES) expect(re.test(codigo), `${f} usa "${que}"`).toBe(false);
      const specs = [...codigo.matchAll(/(?:from|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
      for (const spec of specs) for (const sdk of SDKS) expect(spec.includes(sdk), `${f} importa "${sdk}"`).toBe(false);
    }
  });
});
