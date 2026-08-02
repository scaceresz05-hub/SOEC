/**
 * Neutralidad (Directiva Maestra PCE, Art. 2/12): el NÚCLEO de la PCE no depende de ningún proveedor
 * externo ni de red/entorno. Los SDKs reales vivirán, cuando existan (M4-C), en paquetes-frontera por
 * proveedor — jamás aquí. Este test falla si algún archivo de src/ importa un SDK o usa fetch/process.env.
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

describe('@soec/plataforma-capacidades · neutralidad de arquitectura', () => {
  it('ningún archivo de src/ importa un SDK de proveedor ni usa red/env/reloj', () => {
    for (const f of archivosTs(SRC)) {
      const txt = readFileSync(f, 'utf8');
      for (const prohibido of PROHIBIDOS) {
        expect(txt.includes(prohibido), `${f} contiene "${prohibido}"`).toBe(false);
      }
    }
  });
});
