/**
 * ACCESSIBLE AD ACCOUNT DISCOVERY — matriz adversarial (repo-only, sin Meta real).
 *
 * Verifica que SOEC descubre cuentas publicitarias ACCESIBLES por el token (me/adaccounts), distingue
 * BUSINESS_OWNED de USER_ACCESSIBLE, preserva ownerBusinessId=null sin falsearlo, deduplica owned+accessible
 * a una fila, mantiene el binding como acto humano explícito (nunca auto-bind), y no introduce escrituras
 * ni ads_management. Fixture objetivo: 1037025024374407 (ownerBusinessId null, accessible).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeTransporteMeta, type PeticionHttpMeta, type RespuestaHttpMeta, type TransporteMeta } from '../src/acquisition/meta-http';
import { MetaGraphReadHttpAdapter } from '../src/acquisition/meta-graph-http';
import { dedupCandidatos, type CandidatoActivo } from '../src/acquisition/meta-oauth';
import { aCandidatoDTO, confirmarBindingMeta, InMemoryConnectionRepo } from '../src/acquisition/meta-oauth-flow';
import { negociarCapacidades, puedeVincular, type ConexionMeta } from '../src/acquisition/meta-onboarding';
import { SCOPES_REQUERIDOS } from '../src/acquisition/meta-oauth';

const GCFG = { graphVersion: 'v26.0', appSecret: 'SECRET_APP' };
const graph = (t: TransporteMeta) => new MetaGraphReadHttpAdapter(GCFG, t, 'SYNTH_LONG_TOKEN');

/** Transporte que responde me/adaccounts con un payload arbitrario (owned/accessible/errores). */
class TransporteAdAccounts implements TransporteMeta {
  readonly esProductivo = false;
  readonly urls: string[] = [];
  constructor(private readonly payload: unknown) {}
  async enviar(req: PeticionHttpMeta): Promise<RespuestaHttpMeta> {
    this.urls.push(req.url);
    return { status: 200, ok: true, json: this.payload };
  }
}

const AD_ACCOUNT_ID = '1037025024374407';

describe('accessible ad account discovery', () => {
  it('B/C accessible-only: descubre 1037025024374407 con ownerBusinessId null y accessMode USER_ACCESSIBLE', async () => {
    const cands = await graph(new FakeTransporteMeta()).discoverAdAccounts();
    expect(cands).toHaveLength(1);
    const ad = cands[0]!;
    expect(ad.assetType).toBe('adAccount');
    expect(ad.externalId).toBe(AD_ACCOUNT_ID);
    expect(ad.ownerBusinessId).toBeNull(); // preservado, NO falseado con el Business
    expect(ad.accessMode).toBe('USER_ACCESSIBLE');
    expect(ad.provenance).toBe('GRAPH_OBSERVED');
  });

  it('A business-owned: si Graph reporta business, ownerBusinessId se conserva y accessMode BUSINESS_OWNED', async () => {
    const t = new TransporteAdAccounts({ data: [{ account_id: AD_ACCOUNT_ID, name: 'Caceres SC', business: { id: '934186066270538', name: 'SmileFlow' } }] });
    const cands = await graph(t).discoverAdAccounts();
    expect(cands[0]!.ownerBusinessId).toBe('934186066270538');
    expect(cands[0]!.accessMode).toBe('BUSINESS_OWNED');
  });

  it('F cuenta inaccesible (no aparece en me/adaccounts) ⇒ sin candidato', async () => {
    const t = new TransporteAdAccounts({ data: [] });
    expect(await graph(t).discoverAdAccounts()).toHaveLength(0);
  });

  it('me/adaccounts sólo pide ads_read (fields de lectura), nunca ads_management', async () => {
    const t = new TransporteAdAccounts({ data: [] });
    await graph(t).discoverAdAccounts();
    expect(t.urls.some((u) => u.includes('/me/adaccounts'))).toBe(true);
    expect(t.urls.some((u) => u.includes('ads_management'))).toBe(false);
  });

  it('reads de ad account normalizan a act_<id> (numérico ⇒ act_) e idempotente si ya trae act_', async () => {
    const t = new TransporteAdAccounts({ data: [] });
    const g = graph(t);
    await g.readAdAccount(AD_ACCOUNT_ID);
    await g.readCampaigns('act_' + AD_ACCOUNT_ID);
    expect(t.urls[0]).toContain(`/act_${AD_ACCOUNT_ID}?`);
    expect(t.urls[1]).toContain(`/act_${AD_ACCOUNT_ID}/campaigns`);
    expect(t.urls.some((u) => u.includes(`act_act_`))).toBe(false); // no doble prefijo
  });
});

describe('dedup owned + accessible', () => {
  const accessible: CandidatoActivo = { provider: 'meta', assetType: 'adAccount', externalId: AD_ACCOUNT_ID, displayName: 'Caceres SC', provenance: 'GRAPH_OBSERVED', ownerBusinessId: null, accessMode: 'USER_ACCESSIBLE' };
  const owned: CandidatoActivo = { ...accessible, ownerBusinessId: '934186066270538', accessMode: 'BUSINESS_OWNED' };

  it('G una sola fila por ID; gana la relación más informativa (owned)', () => {
    const out = dedupCandidatos([accessible, owned]);
    expect(out).toHaveLength(1);
    expect(out[0]!.ownerBusinessId).toBe('934186066270538');
    expect(out[0]!.accessMode).toBe('BUSINESS_OWNED');
  });

  it('G orden inverso: accessible no pisa a owned ya presente', () => {
    const out = dedupCandidatos([owned, accessible]);
    expect(out).toHaveLength(1);
    expect(out[0]!.ownerBusinessId).toBe('934186066270538');
  });

  it('no colapsa IDs distintos ni tipos distintos', () => {
    const otra: CandidatoActivo = { ...accessible, externalId: '999' };
    const page: CandidatoActivo = { provider: 'meta', assetType: 'page', externalId: AD_ACCOUNT_ID, displayName: null, provenance: 'GRAPH_OBSERVED' };
    expect(dedupCandidatos([accessible, otra, page])).toHaveLength(3);
  });
});

describe('binding gate (accessible-only sigue exigiendo confirmación humana)', () => {
  const accessible: CandidatoActivo = { provider: 'meta', assetType: 'adAccount', externalId: AD_ACCOUNT_ID, displayName: 'Caceres SC', provenance: 'GRAPH_OBSERVED', ownerBusinessId: null, accessMode: 'USER_ACCESSIBLE' };

  it('D accessible-only es bindingEligible y expone ownerBusinessId null + accessMode en el DTO', () => {
    const dto = aCandidatoDTO(accessible);
    expect(dto.bindingEligible).toBe(true);
    expect(dto.ownerBusinessId).toBeNull();
    expect(dto.accessMode).toBe('USER_ACCESSIBLE');
  });

  it('J binding por ID canónico con confirmación humana (no por nombre/Business)', () => {
    expect(puedeVincular(accessible, { organizationId: 'smileflow', assetType: 'adAccount', externalId: AD_ACCOUNT_ID, actorId: 'owner' })).toBe(true);
    expect(puedeVincular(accessible, { organizationId: 'smileflow', assetType: 'adAccount', externalId: '000', actorId: 'owner' })).toBe(false);
    expect(puedeVincular(accessible, { organizationId: 'smileflow', assetType: 'adAccount', externalId: AD_ACCOUNT_ID, actorId: '' })).toBe(false);
  });

  async function conexionConCandidato(cands: readonly CandidatoActivo[]): Promise<InMemoryConnectionRepo> {
    const repo = new InMemoryConnectionRepo();
    const conexion: ConexionMeta = { organizationId: 'smileflow', provider: 'meta', connectionId: 'meta-smileflow', estado: 'BINDING_PENDING', salud: 'HEALTHY', bindings: [], credencialRef: 'file:smileflow/x' };
    await repo.guardar({ conexion, candidatos: cands });
    return repo;
  }

  it('K/J accessible-only NO se auto-bindea: se vincula sólo por confirmación humana explícita', async () => {
    const repo = await conexionConCandidato([accessible]);
    const antes = await repo.obtener('smileflow', 'meta-smileflow');
    expect(antes!.conexion.estado).toBe('BINDING_PENDING');
    expect(antes!.conexion.bindings).toHaveLength(0);
    const r = await confirmarBindingMeta({ connRepo: repo, scopesEfectivos: SCOPES_REQUERIDOS }, 'smileflow', 'meta-smileflow', accessible, { organizationId: 'smileflow', assetType: 'adAccount', externalId: AD_ACCOUNT_ID, actorId: 'owner' });
    expect(r.rechazo).toBe('NONE');
    expect(r.estado).toBe('CONNECTED_READ_ONLY');
    expect(r.capacidades).toContain('CAN_READ_ADS');
  });

  it('I unknown ad account (no descubierto) ⇒ NOT_DISCOVERED', async () => {
    const repo = await conexionConCandidato([accessible]);
    const desconocido: CandidatoActivo = { ...accessible, externalId: '000000000000000' };
    const r = await confirmarBindingMeta({ connRepo: repo, scopesEfectivos: SCOPES_REQUERIDOS }, 'smileflow', 'meta-smileflow', desconocido, { organizationId: 'smileflow', assetType: 'adAccount', externalId: '000000000000000', actorId: 'owner' });
    expect(r.rechazo).toBe('NOT_DISCOVERED');
  });

  it('H/N cross-tenant: la cuenta descubierta para smileflow no entra en otra org (SC Topografía)', async () => {
    // La conexión de otra org no tiene esta cuenta como candidato ⇒ NOT_DISCOVERED (aislamiento por org).
    const repoOtra = new InMemoryConnectionRepo();
    await repoOtra.guardar({ conexion: { organizationId: 'sc-topografia', provider: 'meta', connectionId: 'meta-sc-topografia', estado: 'BINDING_PENDING', salud: 'HEALTHY', bindings: [], credencialRef: 'file:sc/x' }, candidatos: [] });
    const r = await confirmarBindingMeta({ connRepo: repoOtra, scopesEfectivos: SCOPES_REQUERIDOS }, 'sc-topografia', 'meta-sc-topografia', accessible, { organizationId: 'sc-topografia', assetType: 'adAccount', externalId: AD_ACCOUNT_ID, actorId: 'intruso' });
    expect(r.rechazo).toBe('NOT_DISCOVERED');
  });

  it('E ads_read faltante ⇒ sin capacidad CAN_READ_ADS aunque haya binding', () => {
    const bindings = [{ assetType: 'adAccount' as const, externalId: AD_ACCOUNT_ID, displayName: 'Caceres SC', confirmadoPorHumano: true }];
    const sinAdsRead = SCOPES_REQUERIDOS.filter((s) => s !== 'ads_read');
    expect(negociarCapacidades(sinAdsRead, bindings, 'CONNECTED_READ_ONLY')).not.toContain('CAN_READ_ADS');
    expect(negociarCapacidades(SCOPES_REQUERIDOS, bindings, 'CONNECTED_READ_ONLY')).toContain('CAN_READ_ADS');
  });
});

describe('L/M arquitectura: discovery de ad accounts es sólo lectura, sin ads_management', () => {
  it('el adapter de Graph no introduce verbos de escritura por el nuevo método', () => {
    const src = readFileSync(new URL('../src/acquisition/meta-graph-http.ts', import.meta.url), 'utf8');
    for (const verbo of ['create', 'update', 'publish', 'pause', 'delete', 'budget', 'assign', 'claim', 'move']) {
      expect(new RegExp(`(?<![.\\w])${verbo}\\s*\\(`, 'i').test(src)).toBe(false);
    }
    expect(src.includes('ads_management')).toBe(false);
    expect(src.includes('me/adaccounts')).toBe(true);
  });
});
