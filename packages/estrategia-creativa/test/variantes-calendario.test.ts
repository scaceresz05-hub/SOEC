/**
 * @soec/estrategia-creativa · variantes A/B (Tramo 4) y calendario editorial (Tramo 5).
 * A/B: control experimental (una variable, constantes compartidas, hipótesis obligatoria). Calendario:
 * no programar sin aprobación, sin solapes, reprogramación trazable, multi-tenant. Todo simulado.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { CalendarioEditorialService, EstrategiaCreativaInvalidaError, VariantesABService } from '../src/index';

const attr: Attribution = { source: 't', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'na' };
const ctx = (org = 'org-a'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
};
const O = '2026-07-31T00:00:00.000Z';

describe('Tramo 4 · variantes A/B con control experimental', () => {
  const ab = () => new VariantesABService(new InMemoryEventStore());
  const base = { hipotesisQuePrueba: 'la prueba social sube la conversión', elementosConstantes: ['gancho', 'cta', 'oferta'], criterioExito: 'CTR > control' };

  it('dos variantes comparten constantes y difieren en la variable declarada', async () => {
    const s = ab();
    await s.agregarVariante(ctx(), 'p1', { ...base, varianteId: 'A', elementoModificado: 'prueba_social', diferenciaControlada: 'con testimonio' }, attr, O);
    const st = await s.agregarVariante(ctx(), 'p1', { ...base, varianteId: 'B', elementoModificado: 'prueba_social', diferenciaControlada: 'sin testimonio' }, attr, O);
    expect(st.variantes).toHaveLength(2);
    expect(st.variantes.every((v) => v.elementosConstantes.join() === 'gancho,cta,oferta')).toBe(true);
  });

  it('variante sin hipótesis → error; constantes distintas (dos piezas) → error', async () => {
    const s = ab();
    await expect(s.agregarVariante(ctx(), 'p1', { ...base, hipotesisQuePrueba: '', varianteId: 'A', elementoModificado: 'cta', diferenciaControlada: 'x' }, attr, O)).rejects.toBeInstanceOf(EstrategiaCreativaInvalidaError);
    await s.agregarVariante(ctx(), 'p2', { ...base, varianteId: 'A', elementoModificado: 'cta', diferenciaControlada: 'x' }, attr, O);
    await expect(s.agregarVariante(ctx(), 'p2', { ...base, elementosConstantes: ['otro'], varianteId: 'B', elementoModificado: 'cta', diferenciaControlada: 'y' }, attr, O)).rejects.toBeInstanceOf(EstrategiaCreativaInvalidaError);
  });

  it('idempotente por varianteId; transición a GANADORA', async () => {
    const s = ab();
    await s.agregarVariante(ctx(), 'p1', { ...base, varianteId: 'A', elementoModificado: 'cta', diferenciaControlada: 'x' }, attr, O);
    await s.agregarVariante(ctx(), 'p1', { ...base, varianteId: 'A', elementoModificado: 'cta', diferenciaControlada: 'x' }, attr, O);
    const st = await s.transicionar(ctx(), 'p1', 'A', 'GANADORA', attr, O);
    expect(st.variantes).toHaveLength(1);
    expect(st.variantes[0]?.estado).toBe('GANADORA');
  });

  it('aislamiento multiempresa', async () => {
    const store = new InMemoryEventStore();
    const s = new VariantesABService(store);
    await s.agregarVariante(ctx('org-a'), 'p1', { ...base, varianteId: 'A', elementoModificado: 'cta', diferenciaControlada: 'x' }, attr, O);
    expect((await s.cargar(ctx('org-b'), 'p1')).existe).toBe(false);
  });
});

describe('Tramo 5 · calendario editorial', () => {
  const cal = () => new CalendarioEditorialService(new InMemoryEventStore());
  const entrada = (id: string, fechaHora: string) => ({ entradaId: id, fechaHora, canal: 'instagram', piezaId: 'p1', objetivo: 'leads', segmento: 'icp1' });

  it('crea, agrega entrada BORRADOR y rechaza fecha inválida', async () => {
    const s = cal();
    await s.crear(ctx(), 'prog1', 'America/Santiago', attr, O);
    const st = await s.agregarEntrada(ctx(), 'prog1', entrada('e1', '2026-08-01T12:00:00.000Z'), attr, O);
    expect(st.entradas[0]?.estado).toBe('BORRADOR');
    expect(st.entradas[0]?.naturaleza).toBe('SIMULADO');
    await expect(s.agregarEntrada(ctx(), 'prog1', entrada('e2', 'no-fecha'), attr, O)).rejects.toBeInstanceOf(EstrategiaCreativaInvalidaError);
  });

  it('no se programa contenido no aprobado; sí tras el flujo de aprobación', async () => {
    const s = cal();
    await s.crear(ctx(), 'prog1', 'UTC', attr, O);
    await s.agregarEntrada(ctx(), 'prog1', entrada('e1', '2026-08-01T12:00:00.000Z'), attr, O);
    await expect(s.transicionar(ctx(), 'prog1', 'e1', 'PROGRAMADA_SIMULADA', attr, O)).rejects.toBeInstanceOf(EstrategiaCreativaInvalidaError);
    await s.transicionar(ctx(), 'prog1', 'e1', 'PENDIENTE_APROBACION', attr, O);
    await s.transicionar(ctx(), 'prog1', 'e1', 'APROBADA', attr, O);
    const st = await s.transicionar(ctx(), 'prog1', 'e1', 'PROGRAMADA_SIMULADA', attr, O);
    expect(st.entradas[0]?.estado).toBe('PROGRAMADA_SIMULADA');
  });

  it('rechaza solape de canal en el mismo instante', async () => {
    const s = cal();
    await s.crear(ctx(), 'prog1', 'UTC', attr, O);
    const F = '2026-08-01T12:00:00.000Z';
    for (const id of ['e1', 'e2']) {
      await s.agregarEntrada(ctx(), 'prog1', entrada(id, F), attr, O);
      await s.transicionar(ctx(), 'prog1', id, 'PENDIENTE_APROBACION', attr, O);
      await s.transicionar(ctx(), 'prog1', id, 'APROBADA', attr, O);
    }
    await s.transicionar(ctx(), 'prog1', 'e1', 'PROGRAMADA_SIMULADA', attr, O);
    await expect(s.transicionar(ctx(), 'prog1', 'e2', 'PROGRAMADA_SIMULADA', attr, O)).rejects.toBeInstanceOf(EstrategiaCreativaInvalidaError);
  });

  it('reprogramación trazable (vuelve a APROBADA con nueva fecha; historial conservado)', async () => {
    const s = cal();
    await s.crear(ctx(), 'prog1', 'UTC', attr, O);
    await s.agregarEntrada(ctx(), 'prog1', entrada('e1', '2026-08-01T12:00:00.000Z'), attr, O);
    await s.transicionar(ctx(), 'prog1', 'e1', 'PENDIENTE_APROBACION', attr, O);
    await s.transicionar(ctx(), 'prog1', 'e1', 'APROBADA', attr, O);
    await s.transicionar(ctx(), 'prog1', 'e1', 'PROGRAMADA_SIMULADA', attr, O);
    const st = await s.reprogramar(ctx(), 'prog1', 'e1', '2026-08-02T15:00:00.000Z', attr, O);
    expect(st.entradas[0]?.estado).toBe('APROBADA');
    expect(st.entradas[0]?.fechaHora).toBe('2026-08-02T15:00:00.000Z');
  });
});
