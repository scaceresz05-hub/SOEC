/**
 * Neutralidad (Directiva Maestra PCE, Art. 2/4/12): @soec/secretos no depende de ningún proveedor de
 * secretos, ni de red/entorno/reloj. Los adaptadores reales (env/vault/aws-sm/…) vivirán en su propia
 * frontera. Además, ningún archivo de src/ debe declarar un campo `valor` en un evento o payload: el
 * dominio nunca transporta el VALOR de un secreto. Este test falla ante SDKs, fetch/process.env o Date.now.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const PROHIBIDOS = ['openai', '@anthropic-ai/sdk', 'googleapis', 'google-ads-api', 'nodemailer', 'stripe', 'twilio', 'axios', 'node-fetch', 'process.env', 'Date.now'];

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivosTs(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('@soec/secretos · neutralidad de arquitectura', () => {
  it('ningún archivo de src/ importa un SDK de proveedor ni usa red/env/reloj', () => {
    for (const f of archivosTs(SRC)) {
      const txt = readFileSync(f, 'utf8');
      for (const prohibido of PROHIBIDOS) {
        expect(txt.includes(prohibido), `${f} contiene "${prohibido}"`).toBe(false);
      }
    }
  });

  it('sólo el holder opaco y el adaptador de frontera conocen un valor de secreto', () => {
    for (const f of archivosTs(SRC)) {
      const esFrontera = f.includes('secreto-resuelto') || join('adapters').length === 0 || f.includes(join('adapters'));
      if (esFrontera) continue;
      const txt = readFileSync(f, 'utf8');
      // El dominio/gobernanza jamás nombra un valor en claro: ni `valor:` en un payload ni acceso `.valor`.
      expect(/payload[^;]*\bvalor\b/.test(txt), `${f} referencia un valor en un payload`).toBe(false);
    }
  });
});
