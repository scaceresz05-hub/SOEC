/**
 * @soec/plataforma-capacidades · correcciones post-auditoría de M4-A:
 *  M4A-1 referencia opaca real (no admite secretos camuflados) · M4A-2 esConsumible (autoridad única) ·
 *  M4A-3 versionado idempotente · M4A-4 target de degradación · M4A-5 reemplazo gobernado.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import {
  CapacidadExternaInvalidaError,
  CapacidadesExternasService,
  ESQUEMAS_REF,
  esConsumible,
  esReferenciaSecreto,
  esIdentificadorLogico,
  pareceSecreto,
} from '../src/index';

const attr: Attribution = { source: 'c', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const O = '2026-08-01T00:00:00.000Z';
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('d'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const svc = () => new CapacidadesExternasService(new InMemoryEventStore());
const rej = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(CapacidadExternaInvalidaError);

describe('M4A-1 · referencia opaca real (Art. 4)', () => {
  it('detecta secreto embebido tras un esquema válido y valores con forma de secreto', () => {
    expect(esReferenciaSecreto('env:GEN_KEY_ORG_A')).toBe(true);
    expect(esReferenciaSecreto('vault://org-a/gen')).toBe(true);
    expect(esReferenciaSecreto('env:sk-REALSECRET-embebido-1234567890abcdef')).toBe(false); // secreto camuflado
    expect(esReferenciaSecreto('sk-abc123')).toBe(false); // sin esquema
    expect(esReferenciaSecreto('http:algo')).toBe(false); // esquema fuera de la allowlist
    expect(pareceSecreto('Bearer abc.def')).toBe(true);
    expect(pareceSecreto('token=xyz')).toBe(true);
    expect(esIdentificadorLogico('proveedor-logico-1')).toBe(true);
    expect(esIdentificadorLogico('sk-REALTOKEN-1234567890abcdefghij')).toBe(false);
  });
  it('configurar rechaza secretRef con forma de secreto y proveedorRef con secreto', async () => {
    const s = svc();
    await s.registrar(ctx(), 'g', 'generacion-contenido', 'SIMULAR', attr, O);
    await rej(s.configurar(ctx(), 'g', { proveedorRef: 'p1', secretRef: 'env:sk-REAL-1234567890abcdefghij', politicaDegradacion: 'SIMULAR' }, attr, O));
    await rej(s.configurar(ctx(), 'g', { proveedorRef: 'sk-REALTOKEN-1234567890abcdefghij', secretRef: 'env:OK', politicaDegradacion: 'SIMULAR' }, attr, O));
    await s.configurar(ctx(), 'g', { proveedorRef: 'p1', secretRef: 'vault://org-a/gen', politicaDegradacion: 'SIMULAR' }, attr, O); // válida
    expect((await s.cargar(ctx(), 'g')).secretRef).toBe('vault://org-a/gen');
  });

  it('R-1: rechaza tokens medianos/prefijos camuflados; permite referencias estructuradas', () => {
    for (const v of ['vault:tokenABCDEF1234567890abcdef', 'vault:secretABC1234567890XYZ', 'env:abcdefghijklmnopqrst1234', 'ref:BearerABCDEF1234567890', 'secretstore:apikeyABCDEF1234567890']) {
      expect(esReferenciaSecreto(v), `debe rechazar ${v}`).toBe(false);
    }
    for (const v of ['vault:org-a/generation/main', 'vault:org-123/generation/main', 'secretstore:capacidad-123', 'env:SOEC_GEN_PRIMARY', 'ref:integration-primary']) {
      expect(esReferenciaSecreto(v), `debe permitir ${v}`).toBe(true);
    }
  });

  it('R-2: esquema secretstore admitido sólo con referencia válida', () => {
    expect(esReferenciaSecreto('secretstore:capacidad-123')).toBe(true);
    expect(esReferenciaSecreto('secretstore:org-a/generation-primary')).toBe(true);
    expect(esReferenciaSecreto('secretstore:')).toBe(false); // path vacío
    expect(esReferenciaSecreto('secretstore:sk-1234567890abcdef')).toBe(false);
    expect(esReferenciaSecreto('secretstore:tokenABCDEF1234567890')).toBe(false);
    expect(esReferenciaSecreto('secretstore:api_key=x')).toBe(false); // '='
    expect(ESQUEMAS_REF).toContain('secretstore');
  });
});

describe('M4A-2 · esConsumible (autoridad única)', () => {
  it('sólo EN_USO + salud ≠ NO_CONFIABLE es consumible; devuelve degradación si no', async () => {
    const s = svc();
    await s.registrar(ctx(), 'g', 't', 'ABSTENER', attr, O);
    expect((await s.puedeConsumir(ctx(), 'g')).consumible).toBe(false); // REGISTRADA
    expect((await s.puedeConsumir(ctx(), 'g')).degradacion).toBe('ABSTENER');
    await s.configurar(ctx(), 'g', { proveedorRef: 'p1', secretRef: 'env:K', politicaDegradacion: 'ABSTENER' }, attr, O);
    await s.transicionar(ctx(), 'g', 'HABILITADA', {}, attr, O);
    await s.transicionar(ctx(), 'g', 'AUTORIZADA', { actorHumano: 'ana' }, attr, O);
    await s.transicionar(ctx(), 'g', 'EN_USO', { actorHumano: 'ana' }, attr, O);
    expect((await s.puedeConsumir(ctx(), 'g')).consumible).toBe(true);
    await s.registrarSalud(ctx(), 'g', 'DEGRADADA', attr, O);
    const deg = await s.puedeConsumir(ctx(), 'g');
    expect(deg.consumible).toBe(true);
    expect(deg.degradada).toBe(true);
    await s.registrarSalud(ctx(), 'g', 'NO_CONFIABLE', attr, O);
    expect((await s.puedeConsumir(ctx(), 'g')).consumible).toBe(false);
  });
  it('esConsumible es puro sobre el estado', () => {
    const v = esConsumible({ existe: true, terminada: false, estado: 'EN_USO', salud: 'SALUDABLE', modo: 'SIMULADA', politicaDegradacion: 'SIMULAR' } as never);
    expect(v.consumible).toBe(true);
  });
});

describe('M4A-3 · versionado idempotente (Art. 7)', () => {
  it('reconfigurar idéntico NO versiona; un cambio real sí', async () => {
    const s = svc();
    await s.registrar(ctx(), 'g', 't', 'SIMULAR', attr, O);
    await s.configurar(ctx(), 'g', { proveedorRef: 'p1', secretRef: 'env:K', politicaDegradacion: 'SIMULAR' }, attr, O);
    await s.configurar(ctx(), 'g', { proveedorRef: 'p1', secretRef: 'env:K', politicaDegradacion: 'SIMULAR' }, attr, O); // idéntico
    expect((await s.cargar(ctx(), 'g')).configVersion).toBe(1);
    await s.configurar(ctx(), 'g', { proveedorRef: 'p2', secretRef: 'env:K', politicaDegradacion: 'SIMULAR' }, attr, O); // cambio real
    expect((await s.cargar(ctx(), 'g')).configVersion).toBe(2);
  });
});

describe('M4A-4 · target de degradación (Art. 11)', () => {
  it('ALTERNATIVA exige alternativaCapacidadId (no la propia); CACHE exige cacheRef', async () => {
    const s = svc();
    await s.registrar(ctx(), 'g', 't', 'ALTERNATIVA', attr, O);
    await rej(s.configurar(ctx(), 'g', { proveedorRef: 'p1', secretRef: 'env:K', politicaDegradacion: 'ALTERNATIVA' }, attr, O)); // sin target
    await rej(s.configurar(ctx(), 'g', { proveedorRef: 'p1', secretRef: 'env:K', politicaDegradacion: 'ALTERNATIVA', alternativaCapacidadId: 'g' }, attr, O)); // ciclo propio
    await s.configurar(ctx(), 'g', { proveedorRef: 'p1', secretRef: 'env:K', politicaDegradacion: 'ALTERNATIVA', alternativaCapacidadId: 'g2' }, attr, O);
    expect((await s.cargar(ctx(), 'g')).alternativaCapacidadId).toBe('g2');
    await rej(s.configurar(ctx(), 'g', { proveedorRef: 'p1', secretRef: 'env:K', politicaDegradacion: 'CACHE' }, attr, O)); // CACHE sin cacheRef
  });
});

describe('M4A-5 · reemplazo gobernado', () => {
  const preparar = async (s: CapacidadesExternasService, id: string, tipo = 'generacion-contenido') => {
    await s.registrar(ctx(), id, tipo, 'SIMULAR', attr, O);
  };
  it('valida self/existencia/compatibilidad/reciprocidad; transicionar(REEMPLAZADA) está bloqueado', async () => {
    const s = svc();
    await preparar(s, 'a');
    await rej(s.transicionar(ctx(), 'a', 'REEMPLAZADA', {}, attr, O)); // debe usar reemplazar()
    await rej(s.reemplazar(ctx(), 'a', 'a', 'ana', attr, O)); // self
    await rej(s.reemplazar(ctx(), 'a', 'inexistente', 'ana', attr, O)); // no existe
    await preparar(s, 'b-otro-tipo', 'correo');
    await rej(s.reemplazar(ctx(), 'a', 'b-otro-tipo', 'ana', attr, O)); // tipo incompatible
    await preparar(s, 'b'); // mismo tipo
    await rej(s.reemplazar(ctx(), 'a', 'b', '', attr, O)); // sin actor humano
    const st = await s.reemplazar(ctx(), 'a', 'b', 'ana', attr, O);
    expect(st.estado).toBe('REEMPLAZADA');
    expect(st.reemplazadaPor).toBe('b');
    expect(st.terminada).toBe(true);
    // Reemplazo recíproco directo B→A rechazado.
    await rej(s.reemplazar(ctx(), 'b', 'a', 'ana', attr, O));
  });
});
