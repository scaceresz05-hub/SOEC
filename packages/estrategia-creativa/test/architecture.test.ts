/**
 * Neutralidad (ADR 0019): el dominio NO depende de ningún proveedor externo. Este test falla si algún
 * archivo de src/ importa un SDK de IA/red o hace fetch/process.env. Los adaptadores reales, cuando
 * existan, vivirán detrás de puertos y fuera de este paquete.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const PROHIBIDOS = ['openai', '@anthropic-ai/sdk', 'googleapis', 'google-ads-api', 'nodemailer', 'axios', 'node-fetch', 'process.env'];

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivosTs(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('@soec/estrategia-creativa · neutralidad de arquitectura', () => {
  it('ningún archivo de src/ importa un SDK de proveedor ni usa red/env', () => {
    for (const f of archivosTs(SRC)) {
      const txt = readFileSync(f, 'utf8');
      for (const prohibido of PROHIBIDOS) {
        expect(txt.includes(prohibido), `${f} contiene "${prohibido}"`).toBe(false);
      }
    }
  });
});
