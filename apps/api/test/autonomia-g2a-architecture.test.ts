/**
 * G2-A — tests de ARQUITECTURA/seguridad: el Reader jamás muta; el Executor real está bloqueado por
 * AUTONOMOUS_REAL; los secretos van por referencia (no en claro); separación Reader/Writer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GoogleAdsWriteAdapter, OperacionNoHabilitadaError } from '../src/autonomia-ads/google-ads-write-adapter';
import { WRITE_CREDENTIAL_REF, CONFINAMIENTO } from '../src/autonomia-ads/capacidad-negativa';

const AQUI = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(AQUI, '..', 'src', rel), 'utf8');

describe('G2-A arquitectura — Reader READ ONLY', () => {
  it('el Reader (google-ads-adapter) NUNCA llama googleAds:mutate ni construye mutaciones', () => {
    const reader = src('ingesta/google-ads-adapter.ts');
    expect(reader).toContain('googleAds:searchStream'); // sólo lectura
    expect(reader).not.toContain('googleAds:mutate');
    expect(reader).not.toContain('mutateOperations');
    expect(reader).not.toContain('campaignCriterionOperation');
  });

  it('el Reader NO importa el Write adapter (separación física)', () => {
    const reader = src('ingesta/google-ads-adapter.ts');
    expect(reader).not.toContain('google-ads-write-adapter');
    expect(reader).not.toContain('GoogleAdsWriteAdapter');
  });
});

describe('G2-A arquitectura — Write adapter bloqueado', () => {
  it('ejecutarReal está BLOQUEADO por AUTONOMOUS_REAL=false (lanza)', async () => {
    const w = new GoogleAdsWriteAdapter();
    const op = w.describirMutate({ actionType: 'ADD_NEGATIVE_KEYWORD', customerId: CONFINAMIENTO.customerId, campaignId: '24120966895', entityRef: 'x' });
    await expect(w.ejecutarReal(op)).rejects.toThrow(); // ModoRealBloqueado
    expect(GoogleAdsWriteAdapter.puedeEjecutarReal).toBe(false);
  });

  it('sólo soporta ADD_NEGATIVE_KEYWORD; rechaza otras operaciones y otros customerId', () => {
    const w = new GoogleAdsWriteAdapter();
    expect(w.soporta('ADD_NEGATIVE_KEYWORD')).toBe(true);
    expect(w.soporta('SET_BUDGET')).toBe(false);
    expect(w.soporta('SET_CPC')).toBe(false);
    expect(() => w.describirMutate({ actionType: 'SET_BUDGET', customerId: CONFINAMIENTO.customerId, campaignId: '1', entityRef: 'x' })).toThrow(OperacionNoHabilitadaError);
    expect(() => w.describirMutate({ actionType: 'ADD_NEGATIVE_KEYWORD', customerId: '9999999999', campaignId: '1', entityRef: 'x' })).toThrow(OperacionNoHabilitadaError);
  });
});

describe('G2-A arquitectura — secretos por referencia', () => {
  it('la credencial de escritura es una REFERENCIA opaca (env:), separada del Reader; nunca un valor', () => {
    expect(WRITE_CREDENTIAL_REF).toBe('env:GOOGLE_ADS_WRITE_REFRESH_TOKEN');
    expect(WRITE_CREDENTIAL_REF.startsWith('env:')).toBe(true);
    const w = new GoogleAdsWriteAdapter();
    expect(w.credentialRef).toBe(WRITE_CREDENTIAL_REF);
    // la descripción del mutate NO contiene ningún token/secreto
    const op = w.describirMutate({ actionType: 'ADD_NEGATIVE_KEYWORD', customerId: CONFINAMIENTO.customerId, campaignId: '24120966895', entityRef: 'x' });
    const s = JSON.stringify(op);
    expect(s).not.toMatch(/refresh|token|secret|1\/\/0|ya29/i);
  });
});
