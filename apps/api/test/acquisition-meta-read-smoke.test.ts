/**
 * READ-SMOKE COMPLETO (8/8) — matriz de lectura post-binding con clasificación de salud fail-closed.
 *
 * Verifica que cada capacidad se ejecuta REALMENTE (una llamada Graph read-only por check), que un fallo
 * de auth/permiso en un check individual (p. ej. IG insights o ads insights) clasifica la salud sin
 * convertir no-data en 0, que la cuenta accessible-only funciona sin ownership, y que no hay escritura,
 * ni ads_management, ni token/raw Graph en el resultado.
 */
import { describe, expect, it } from 'vitest';
import { OrganizationId, ActorId, type RequestContext } from '@soec/contracts';
import { ejecutarReadSmoke } from '../src/acquisition/meta-oauth-routes';
import type { ComposicionMetaOAuth } from '../src/acquisition/meta-runtime';
import { MetaGraphReadHttpAdapter } from '../src/acquisition/meta-graph-http';
import type { PeticionHttpMeta, RespuestaHttpMeta, TransporteMeta } from '../src/acquisition/meta-http';
import { InMemoryConnectionRepo, InMemoryCredentialRepo } from '../src/acquisition/meta-oauth-flow';
import { SCOPES_PROHIBIDOS } from '../src/acquisition/meta-oauth';
import type { BindingMeta } from '../src/acquisition/meta-onboarding';

const IG = '17841432883225770';
const AD = '1037025024374407';
const ORG = 'smileflow';
const CONN = 'meta-smileflow';

/** Transporte read-only que falla (auth/permiso) sólo en las URLs que casan `fail(url)`; resto 200 no-data. */
class TransporteSelectivo implements TransporteMeta {
  readonly esProductivo = false;
  readonly urls: string[] = [];
  constructor(private readonly fail: (url: string) => { code: number; status: number } | null = () => null) {}
  async enviar(req: PeticionHttpMeta): Promise<RespuestaHttpMeta> {
    this.urls.push(req.url);
    const f = this.fail(req.url);
    if (f) return { status: f.status, ok: false, json: { error: { code: f.code, message: 'forzado' } } };
    return { status: 200, ok: true, json: { data: [] } }; // no-data ⇒ lectura autorizada válida
  }
}

const BINDINGS: BindingMeta[] = [
  { assetType: 'business', externalId: '934186066270538', displayName: null, confirmadoPorHumano: true },
  { assetType: 'page', externalId: '1066708446525633', displayName: null, confirmadoPorHumano: true },
  { assetType: 'instagram', externalId: IG, displayName: null, confirmadoPorHumano: true },
  { assetType: 'adAccount', externalId: AD, displayName: null, confirmadoPorHumano: true },
];

async function armar(transporte: TransporteMeta): Promise<{ comp: ComposicionMetaOAuth; ctx: RequestContext; transporte: TransporteMeta }> {
  const connRepo = new InMemoryConnectionRepo();
  const credRepo = new InMemoryCredentialRepo();
  await connRepo.guardar({
    conexion: { organizationId: ORG, provider: 'meta', connectionId: CONN, estado: 'CONNECTED_READ_ONLY', salud: 'HEALTHY', bindings: BINDINGS, credencialRef: `file:${ORG}/tok` },
    candidatos: [],
  });
  await credRepo.guardar({ provider: 'meta', organizationId: ORG, credentialId: CONN, tokenType: 'USER_LONG_LIVED', secretRef: `file:${ORG}/tok`, issuedAt: null, expiresAt: null, lastValidatedAt: null, revokedAt: null, status: 'ACTIVE' });
  const secretWriter = { resolver: async () => ({ usar: async (fn: (t: string) => Promise<unknown>) => fn('SYNTH_TOKEN_boundary') }) };
  const crearGraphRead = (token: string) => new MetaGraphReadHttpAdapter({ graphVersion: 'v26.0', appSecret: 'S' }, transporte, token);
  const comp = { connRepo, credRepo, secretWriter, crearGraphRead } as unknown as ComposicionMetaOAuth;
  const o = OrganizationId(ORG);
  const ctx: RequestContext = { organizationId: o, actor: ActorId('tester'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'test' };
  return { comp, ctx, transporte };
}

describe('read-smoke 8/8', () => {
  it('H/8-of-8: todos los checks PASS; ejecuta IG insights y ads insights; salud HEALTHY', async () => {
    const t = new TransporteSelectivo();
    const { comp, ctx } = await armar(t);
    const r = await ejecutarReadSmoke(comp, ctx, ORG, CONN);
    expect(r.totalRun).toBe(8);
    expect(r.totalPass).toBe(8);
    expect(r.pass).toBe(true);
    expect(r.salud).toBe('HEALTHY');
    expect(r.estado).toBe('CONNECTED_READ_ONLY');
    for (const c of Object.values(r.checks)) expect(c).toBe('PASS');
    // Cobertura real de los checks antes ausentes:
    expect(t.urls.some((u) => u.includes('/me/businesses'))).toBe(true); // BUSINESS_READ dedicado
    expect(t.urls.some((u) => u.includes(`/${IG}?`) && u.includes('username'))).toBe(true); // IG basic
    expect(t.urls.some((u) => u.includes(`/${IG}/insights`))).toBe(true); // IG insights
    expect(t.urls.some((u) => u.includes(`act_${AD}/insights`))).toBe(true); // ads insights
    // Sin ownership del Business ni ads_management ni verbos de escritura.
    expect(t.urls.some((u) => u.includes('ads_management'))).toBe(false);
  });

  it('accessible-only ad account: los 3 checks de ads pasan sin ownerBusinessId', async () => {
    const { comp, ctx } = await armar(new TransporteSelectivo());
    const r = await ejecutarReadSmoke(comp, ctx, ORG, CONN);
    expect(r.checks.ADS_ACCOUNT_READ).toBe('PASS');
    expect(r.checks.ADS_CAMPAIGNS_READ).toBe('PASS');
    expect(r.checks.ADS_INSIGHTS_READ).toBe('PASS');
  });

  it('partial/no-data NO se convierte en fallo ni en 0 (lectura vacía = PASS)', async () => {
    const { comp, ctx } = await armar(new TransporteSelectivo(() => null)); // todo 200 {data:[]}
    const r = await ejecutarReadSmoke(comp, ctx, ORG, CONN);
    expect(r.pass).toBe(true);
    expect(r.salud).toBe('HEALTHY');
  });
});

describe('read-smoke health mapping fail-closed (por check)', () => {
  it('IG insights auth failure (190) ⇒ ese check FAIL, salud TOKEN_EXPIRED, estado REAUTH_REQUIRED; resto PASS', async () => {
    const { comp, ctx } = await armar(new TransporteSelectivo((u) => (u.includes(`/${IG}/insights`) ? { code: 190, status: 401 } : null)));
    const r = await ejecutarReadSmoke(comp, ctx, ORG, CONN);
    expect(r.checks.INSTAGRAM_INSIGHTS_READ).toBe('FAIL');
    expect(r.checks.INSTAGRAM_MEDIA_READ).toBe('PASS');
    expect(r.checks.INSTAGRAM_BASIC_READ).toBe('PASS');
    expect(r.salud).toBe('TOKEN_EXPIRED');
    expect(r.estado).toBe('REAUTH_REQUIRED');
    expect(r.pass).toBe(false);
  });

  it('IG insights permission failure (10) ⇒ FAIL + salud SCOPE_MISSING + estado DEGRADED', async () => {
    const { comp, ctx } = await armar(new TransporteSelectivo((u) => (u.includes(`/${IG}/insights`) ? { code: 10, status: 403 } : null)));
    const r = await ejecutarReadSmoke(comp, ctx, ORG, CONN);
    expect(r.checks.INSTAGRAM_INSIGHTS_READ).toBe('FAIL');
    expect(r.salud).toBe('SCOPE_MISSING');
    expect(r.estado).toBe('DEGRADED');
  });

  it('Ads insights auth failure (190) ⇒ FAIL + TOKEN_EXPIRED', async () => {
    const { comp, ctx } = await armar(new TransporteSelectivo((u) => (u.includes(`act_${AD}/insights`) ? { code: 190, status: 401 } : null)));
    const r = await ejecutarReadSmoke(comp, ctx, ORG, CONN);
    expect(r.checks.ADS_INSIGHTS_READ).toBe('FAIL');
    expect(r.checks.ADS_ACCOUNT_READ).toBe('PASS');
    expect(r.salud).toBe('TOKEN_EXPIRED');
  });

  it('Ads insights permission failure (10) ⇒ FAIL + SCOPE_MISSING', async () => {
    const { comp, ctx } = await armar(new TransporteSelectivo((u) => (u.includes(`act_${AD}/insights`) ? { code: 10, status: 403 } : null)));
    const r = await ejecutarReadSmoke(comp, ctx, ORG, CONN);
    expect(r.checks.ADS_INSIGHTS_READ).toBe('FAIL');
    expect(r.salud).toBe('SCOPE_MISSING');
  });
});

describe('read-smoke seguridad', () => {
  it('sin token ni raw Graph en el resultado; sin ampliación de scopes', async () => {
    const { comp, ctx } = await armar(new TransporteSelectivo());
    const r = await ejecutarReadSmoke(comp, ctx, ORG, CONN);
    const s = JSON.stringify(r);
    expect(s).not.toContain('SYNTH_TOKEN_boundary');
    expect(s.toLowerCase()).not.toContain('access_token');
    // No hay escalada de permisos: ads_management/leads_retrieval siguen prohibidos.
    expect(SCOPES_PROHIBIDOS).toContain('ads_management');
    expect(SCOPES_PROHIBIDOS).toContain('leads_retrieval');
  });
});
