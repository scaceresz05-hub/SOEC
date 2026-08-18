/**
 * V2 PRE-REAL · META WRITE REAL ADAPTER — contract + adversarial + architectural.
 * Sin credenciales reales (FakeWriteTransport). Invariante central: con SOEC_AUTONOMOUS_REAL=false es
 * IMPOSIBLE que el adapter real haga una request; y con true, no toca Meta sin pasar TODOS los gates.
 */
import { describe, expect, it } from 'vitest';
import { MetaWriteRealAdapter, ModoRealBloqueadoError } from '../src/campana/meta-write-real-adapter';
import { seleccionarMetaWritePort } from '../src/campana/meta-write-factory';
import { FakeWriteTransport, guionExitoso, type TransportResponse } from '../src/campana/meta-write-transport';
import { InMemoryReconciliacionRepo } from '../src/campana/meta-write-reconciliation';
import { SCOPES_ESCRITURA_REQUERIDOS } from '../src/campana/write-capability';
import { ErrorEscrituraMeta } from '../src/campana/meta-write-errors';
import type { SolicitudEscrituraMeta } from '../src/campana/meta-write-port';

const SCOPES_OK = ['ads_management', 'pages_manage_posts', 'instagram_content_publish', 'pages_read_engagement'];
const sol = (over: Partial<SolicitudEscrituraMeta> = {}): SolicitudEscrituraMeta => ({ operacion: 'CREATE_CAMPAIGN', organizationId: 'org-a', assetId: 'act_1', idempotencyKey: 'k1', payload: { name: 'C1' }, mandateId: 'm-1', guardApproved: true, ...over });

function real(over: { transport?: FakeWriteTransport; grantedScopes?: readonly string[]; switch?: () => boolean; configReady?: boolean; recon?: InMemoryReconciliacionRepo } = {}): { adapter: MetaWriteRealAdapter; transport: FakeWriteTransport; recon: InMemoryReconciliacionRepo } {
  const transport = over.transport ?? new FakeWriteTransport(guionExitoso());
  const recon = over.recon ?? new InMemoryReconciliacionRepo();
  const adapter = new MetaWriteRealAdapter({ transport, reconRepo: recon, grantedScopes: over.grantedScopes ?? SCOPES_OK, configReady: over.configReady ?? true, leerMasterSwitch: over.switch ?? (() => true) });
  return { adapter, transport, recon };
}

describe('V2 pre-real · contract (Fake transport)', () => {
  it('createCampaign/adset/ad crean con status PAUSED y devuelven externalRef REAL', async () => {
    for (const op of ['CREATE_CAMPAIGN', 'CREATE_ADSET', 'CREATE_AD'] as const) {
      const { adapter, transport } = real();
      const r = await adapter.ejecutar(sol({ operacion: op, idempotencyKey: `k-${op}` }));
      expect(r.ok).toBe(true);
      expect(r.modo).toBe('REAL');
      expect(r.externalRef).toBeTruthy();
      expect(transport.llamadas[0]!.body['status']).toBe('PAUSED'); // se crea pausado
    }
  });
  it('uploadCreative, pause/resume, publishFacebook/Instagram enrutan al path correcto', async () => {
    const casos: Array<[SolicitudEscrituraMeta['operacion'], string]> = [
      ['UPLOAD_CREATIVE', 'act_1/adcreatives'], ['PAUSE_AD', 'act_1'], ['RESUME_AD', 'act_1'],
      ['PUBLISH_FACEBOOK', 'act_1/feed'], ['PUBLISH_INSTAGRAM', 'act_1/media'],
    ];
    for (const [op, path] of casos) {
      const { adapter, transport } = real();
      await adapter.ejecutar(sol({ operacion: op, idempotencyKey: `k-${op}` }));
      expect(transport.llamadas[0]!.path).toBe(path);
    }
  });
  it('clasifica errores de Graph sin reintentar ciegamente (matriz completa)', async () => {
    const casos: Array<[TransportResponse, string, boolean]> = [
      [{ status: 400, body: { error: { code: 190 } } }, 'AUTH', false], // token expirado/ inválido
      [{ status: 403, body: { error: { code: 10 } } }, 'SCOPE_MISSING', false],
      [{ status: 429, body: { error: { code: 4 } } }, 'RATE_LIMIT', true],
      [{ status: 400, body: { error: { code: 1487390 } } }, 'META_POLICY', false],
      [{ status: 400, body: { error: { code: 100, error_subcode: 1487056 } } }, 'INVALID_CREATIVE', false], // creative rechazado
      [{ status: 400, body: { error: { code: 100 } } }, 'INVALID_ASSET', false], // activo/objeto inválido
      [{ status: 500, body: { error: { code: 2, is_transient: true } } }, 'NETWORK', true],
      [{ status: 200, body: {} }, 'UNKNOWN', true], // 200 sin id ⇒ resultado no confirmable
    ];
    const { esReintentable } = await import('../src/campana/meta-write-errors');
    for (const [resp, clase, reint] of casos) {
      const { adapter } = real({ transport: new FakeWriteTransport(() => resp) });
      await expect(adapter.ejecutar(sol({ idempotencyKey: `e-${clase}` }))).rejects.toMatchObject({ clase });
      expect(esReintentable(clase as never)).toBe(reint); // retry sólo si es demostrablemente seguro
    }
  });
});

describe('V2 pre-real · master switch ABSOLUTO', () => {
  it('constructor lanza si el master switch está OFF (no se puede ni instanciar)', () => {
    const transport = new FakeWriteTransport(guionExitoso());
    expect(() => new MetaWriteRealAdapter({ transport, reconRepo: new InMemoryReconciliacionRepo(), grantedScopes: SCOPES_OK, configReady: true, leerMasterSwitch: () => false })).toThrow(ModoRealBloqueadoError);
    expect(transport.llamadas.length).toBe(0);
  });
  it('si el switch se apaga en runtime, ejecutar lanza y NO toca el transporte', async () => {
    let on = true;
    const { adapter, transport } = real({ switch: () => on });
    on = false;
    await expect(adapter.ejecutar(sol())).rejects.toThrow(ModoRealBloqueadoError);
    expect(transport.llamadas.length).toBe(0);
  });
  it('por defecto (env SOEC_AUTONOMOUS_REAL != true) el constructor lanza', () => {
    expect(() => new MetaWriteRealAdapter({ transport: new FakeWriteTransport(guionExitoso()), reconRepo: new InMemoryReconciliacionRepo(), grantedScopes: SCOPES_OK, configReady: true })).toThrow(ModoRealBloqueadoError);
  });
});

describe('V2 pre-real · factory fail-closed', () => {
  it('autonomousReal=false ⇒ SIEMPRE dry-run, sin importar config', () => {
    const s = seleccionarMetaWritePort({ autonomousReal: false, configReady: true, grantedScopes: SCOPES_OK });
    expect(s.modo).toBe('DRY_RUN');
    expect(s.port.esReal).toBe(false);
  });
  it('real solicitado pero config/scopes incompletos ⇒ fail-closed a dry-run', () => {
    expect(seleccionarMetaWritePort({ autonomousReal: true, configReady: false, grantedScopes: SCOPES_OK }).modo).toBe('DRY_RUN');
    expect(seleccionarMetaWritePort({ autonomousReal: true, configReady: true, grantedScopes: ['ads_read'] }).modo).toBe('DRY_RUN');
    expect(seleccionarMetaWritePort({ autonomousReal: true, configReady: true, grantedScopes: SCOPES_ESCRITURA_REQUERIDOS }).modo).toBe('DRY_RUN'); // sin real deps
  });
  it('todo listo + switch inyectado ON ⇒ port real', () => {
    const s = seleccionarMetaWritePort({ autonomousReal: true, configReady: true, grantedScopes: SCOPES_ESCRITURA_REQUERIDOS, real: { transport: new FakeWriteTransport(guionExitoso()), reconRepo: new InMemoryReconciliacionRepo(), leerMasterSwitch: () => true } });
    expect(s.modo).toBe('REAL');
    expect(s.port.esReal).toBe(true);
  });
});

describe('V2 pre-real · adversarial', () => {
  it('sin guardApproved ⇒ denegada, transporte NO llamado', async () => {
    const { adapter, transport } = real();
    const r = await adapter.ejecutar(sol({ guardApproved: false }));
    expect(r.denegada).toBe(true);
    expect(transport.llamadas.length).toBe(0);
  });
  it('scope faltante ⇒ SCOPE_MISSING, transporte NO llamado', async () => {
    const { adapter, transport } = real({ grantedScopes: ['ads_read'] });
    await expect(adapter.ejecutar(sol())).rejects.toMatchObject({ clase: 'SCOPE_MISSING' });
    expect(transport.llamadas.length).toBe(0);
  });
  it('activo ausente ⇒ denegada', async () => {
    const { adapter } = real();
    expect((await adapter.ejecutar(sol({ assetId: '' }))).denegada).toBe(true);
  });
  it('idempotencia: misma key ⇒ un solo request, mismo externalRef', async () => {
    const { adapter, transport } = real();
    const r1 = await adapter.ejecutar(sol({ idempotencyKey: 'dup' }));
    const r2 = await adapter.ejecutar(sol({ idempotencyKey: 'dup' }));
    expect(r2.externalRef).toBe(r1.externalRef);
    expect(transport.llamadas.length).toBe(1); // no recrea
  });
  it('provider timeout ⇒ AMBIGUOUS; retry NO recrea (CONFLICT)', async () => {
    const recon = new InMemoryReconciliacionRepo();
    const explota = new FakeWriteTransport(() => { throw new Error('timeout'); });
    const a1 = new MetaWriteRealAdapter({ transport: explota, reconRepo: recon, grantedScopes: SCOPES_OK, configReady: true, leerMasterSwitch: () => true });
    await expect(a1.ejecutar(sol({ idempotencyKey: 'amb' }))).rejects.toMatchObject({ clase: 'NETWORK' });
    expect((await recon.obtener('org-a', 'amb'))!.estado).toBe('AMBIGUOUS');
    // Retry con transporte bueno: no debe recrear (resultado previo desconocido).
    const bueno = new FakeWriteTransport(guionExitoso());
    const a2 = new MetaWriteRealAdapter({ transport: bueno, reconRepo: recon, grantedScopes: SCOPES_OK, configReady: true, leerMasterSwitch: () => true });
    await expect(a2.ejecutar(sol({ idempotencyKey: 'amb' }))).rejects.toMatchObject({ clase: 'CONFLICT' });
    expect(bueno.llamadas.length).toBe(0);
  });
  it('operación no permitida ⇒ denegada', async () => {
    const { adapter, transport } = real();
    const r = await adapter.ejecutar(sol({ operacion: 'INCREASE_AUTHORIZED_BUDGET' }));
    expect(r.denegada).toBe(true);
    expect(transport.llamadas.length).toBe(0);
  });
});
